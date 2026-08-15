import { NextRequest, NextResponse } from 'next/server'
import { logger, serializeErr } from '@/lib/logger'
import { requireAuth, requireVerifiedEmail } from '@/lib/auth'
import { checkRateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/trusted-ip'
import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { requireSameOrigin } from '@/lib/csrf'

const STORAGE_DIR = path.join(process.cwd(), 'storage')
// FIELD-FIX (2026-07-27): was 5MB, bumped to 10MB. iPhone 14/15 default
// HEIC is ~5MB but the JPEG equivalent (after Most Compatible mode) is
// often 6-8MB; Samsung S23 main sensor photos run 7-12MB. The 5MB cap
// was rejecting the majority of agent photos in dry runs. 10MB still
// leaves room for the 30s statement timeout (single-image upload on
// 3G/4G Colombian cell rarely takes > 15s).
const MAX_SIZE = 10 * 1024 * 1024 // 10MB

// CRIT-24 fix (2026-07-22): the MIME type comes from the client
// (`Content-Type` part of the multipart upload). Trusting it allowed storing
// `<script>` HTML as `image/jpeg` and serving it from /storage/* (the file
// content was correct HTML even though Caddy served it with the attacker-
// chosen MIME). The headers X-Content-Type-Options: nosniff + Caddy's
// Content-Type header happened to prevent browser execution today, but
// any future change to MIME handling (e.g. serving by extension) would
// turn this into stored XSS. Validate content instead.
//
// We sniff the first 12 bytes of the uploaded buffer and require it to
// match the magic bytes of one of the whitelisted image formats. SVG is
// intentionally excluded (it can carry inline <script>); users can host
// vector art via Supabase or a future CDN.
type MagicCheck = (buf: Buffer) => boolean

const MAGIC_BYTES: Record<string, MagicCheck> = {
  'image/jpeg': (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  'image/png':  (buf) =>
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a,
  'image/gif':  (buf) =>
    buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38,
  // WebP: "RIFF" at 0, size (4 bytes) at 4, "WEBP" at 8.
  'image/webp': (buf) =>
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50,
}

const ALLOWED_TYPES = Object.keys(MAGIC_BYTES) // ['image/jpeg','image/png','image/gif','image/webp']

// Audit 2026-08-14 (M1): decompression-bomb dimensions decoder. Reads
// just the header (no full decode) for the 4 whitelisted formats. Returns
// { width, height } in pixels. We don't pull in `image-size` (~50KB+ for
// its full decoder list) — only 4 formats are allowed in.
//
// Format header layout (each is a few bytes into the file):
//   JPEG: SOF0/SOF2 marker at variable offset, segments iterated.
//   PNG:  bytes 16-23 = width (4) + height (4) big-endian.
//   GIF:  bytes 6-9 (logical screen) width/height little-endian.
//   WebP: VP8/VP8L/VP8X chunks hold the dims at known offsets.
function decodeImageDimensions(
  buf: Buffer,
  mime: string
): { width: number; height: number } {
  const fallback = { width: 0, height: 0 }
  try {
    if (mime === 'image/png') {
      // PNG: width at bytes 16-19, height at 20-23, big-endian.
      if (buf.length < 24) return fallback
      return {
        width: buf.readUInt32BE(16),
        height: buf.readUInt32BE(20),
      }
    }
    if (mime === 'image/gif') {
      // GIF87a/89a: logical screen width (LE u16) at bytes 6-7, height
      // at 8-9.
      if (buf.length < 10) return fallback
      return {
        width: buf.readUInt16LE(6),
        height: buf.readUInt16LE(8),
      }
    }
    if (mime === 'image/jpeg') {
      // Walk markers until we hit SOF0/SOF2 (0xC0/0xC2). Each segment
      // starts with 0xFF + marker byte; SOI (0xFFD8) is the first 2 bytes.
      // Segments with length have 2 bytes length following. Skip until SOF.
      if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return fallback
      let i = 2
      while (i < buf.length - 1) {
        if (buf[i] !== 0xff) return fallback
        const marker = buf[i + 1]
        // Standalone markers (no length): RST0-7, SOI, EOI, TEM
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
          i += 2
          continue
        }
        // SOF markers carry the dimensions
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3 ||
            (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) ||
            (marker >= 0xcd && marker <= 0xcf)) {
          if (i + 9 > buf.length) return fallback
          return {
            height: buf.readUInt16BE(i + 5),
            width: buf.readUInt16BE(i + 7),
          }
        }
        // Skip the segment using its 2-byte length field
        if (i + 4 > buf.length) return fallback
        const segLen = buf.readUInt16BE(i + 2)
        i += 2 + segLen
      }
      return fallback
    }
    if (mime === 'image/webp') {
      // WebP: RIFF....WEBP. Chunk fourcc at offset 12.
      //   VP8  (lossy):  3 bytes signature, then 7 bytes width/height LE.
      //   VP8L (lossless): 1 byte signature, then 4 bytes (LE) with dims.
      //   VP8X (extended): 1 byte signature, then 3-byte width-1, 3-byte
      //                    height-1 LE (each encoded 24-bit), then 2 flags.
      if (buf.length < 30) return fallback
      const fourcc = buf.toString('ascii', 12, 16)
      if (fourcc === 'VP8 ') {
        const w = buf.readUInt16LE(26) & 0x3fff
        const h = buf.readUInt16LE(28) & 0x3fff
        return { width: w, height: h }
      }
      if (fourcc === 'VP8L') {
        const b0 = buf[21]
        const b1 = buf[22]
        const b2 = buf[23]
        const b3 = buf[24]
        const w = 1 + (((b1 & 0x3f) << 8) | b0)
        const h = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
        return { width: w, height: h }
      }
      if (fourcc === 'VP8X') {
        const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16))
        const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16))
        return { width: w, height: h }
      }
    }
  } catch {
    // fall through
  }
  return fallback
}

function matchesMagic(buf: Buffer, mime: string): boolean {
  const check = MAGIC_BYTES[mime]
  if (!check) return false
  return check(buf)
}

export async function POST(req: NextRequest) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  // Per-IP rate limit FIRST (before auth). Cheap anti-spam layer:
  // blocks storage abuse from unidentified IPs without needing an
  // authenticated user. 30/hr is generous for legit use.
  // Audit 2026-08-14 (M4): Colombian mobile carriers CGNAT many users
  // behind one IP, so the per-IP limit (BEFORE this audit) was busting
  // legitimate users. We now ALSO apply a per-user limit after auth.
  const ip = getClientIp(req)
  const ipLimit = await checkRateLimit(ip, 'upload_ip', 30, 60 * 60 * 1000)
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas subidas desde esta IP. Intenta más tarde.', retryAfter: ipLimit.retryAfter },
      { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfter) } }
    )
  }

  try {
    // P1-1 (audit 2026-07-27): require verified email before uploading
    // images (creating blob storage records). Photos are surfaced under
    // a vendor/product immediately.
    //
    // Audit 2026-08-14: previous code used requireAuth, not
    // requireVerifiedEmail — the comment was a lie. A freshly-registered
    // unverified user could upload to /storage. Also added role gate
    // since a buyer with verified email shouldn't be writing to blob
    // storage either.
    const auth = await requireVerifiedEmail(req)
    if (auth instanceof NextResponse) return auth
    if (auth.role !== 'seller' && auth.role !== 'service') {
      return NextResponse.json({ error: 'Prohibido' }, { status: 403 })
    }
    const userId = auth.userId

    // Per-user rate limit (post-auth). Companion to the per-IP cap
    // above: catches the case where many users share one IP (CGNAT)
    // and one genuine user is hammering. 30/hr is generous — a seller
    // with 6 products updating photos every other day stays well under.
    const userLimit = await checkRateLimit(userId, 'upload_user', 30, 60 * 60 * 1000)
    if (!userLimit.allowed) {
      return NextResponse.json(
        { error: 'Has subido demasiadas imágenes hoy. Intenta más tarde.', retryAfter: userLimit.retryAfter },
        { status: 429, headers: { 'Retry-After': String(userLimit.retryAfter) } }
      )
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const rawFolder = (formData.get('folder') as string || 'misc').replace(/[^a-z0-9_-]/gi, '')

    // Defense in depth: the regex above strips slashes and dots, but we still
    // reject '..', empty strings, and anything that smells like a separator
    // before we hit the filesystem. Cheap to compute, prevents the filename
    // sanitizer from leaking a path separator through legitimate-looking input
    // like '..' (regex collapses to '' or '..' depending on which chars hit).
    if (!rawFolder || rawFolder === '..' || rawFolder === '.' || rawFolder.includes('/') || rawFolder.includes('\\')) {
      return NextResponse.json({ error: 'folder inválido' }, { status: 400 })
    }
    const folder = rawFolder

    if (!file) {
      return NextResponse.json({ error: 'No se envió archivo' }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      // Match the cap in the JSDoc above. Keep this string in sync
      // with components/ui/ImageUpload.tsx — both ends tell the user
      // the same number.
      return NextResponse.json({ error: 'Máximo 10MB' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Tipo de archivo no permitido' }, { status: 400 })
    }

    // CRIT-24: read the bytes BEFORE writing to disk. The MIME check above
    // trusts the client's `Content-Type`, which an attacker controls. We
    // verify magic bytes against the same whitelist before persisting — if
    // the content isn't actually an image, we 400 and never write anything.
    const buffer = Buffer.from(await file.arrayBuffer())
    if (!matchesMagic(buffer, file.type)) {
      logger.warn(
        { mime: file.type, name: file.name, size: file.size, ip },
        '[upload] Rejected: client-declared MIME does not match content magic bytes'
      )
      return NextResponse.json(
        { error: 'El contenido del archivo no coincide con el tipo declarado' },
        { status: 400 }
      )
    }

    // Audit 2026-08-14 (M1): decompression-bomb guard. A small file
    // (10MB) can decode to 30GB+ in RAM and crash the Node process. Cap
    // the decoded dimensions. 8000px is well above any sane upload
    // (iPhone 15 Pro Max is 8000×6000; 12K is 12288×...; Barcelona's
    // displays top out at 4K). Past this we're a victim of pixel-count
    // multiplication attacks on the decoder.
    const MAX_DIM = 8000
    const dims = decodeImageDimensions(buffer, file.type)
    if (dims.width > MAX_DIM || dims.height > MAX_DIM) {
      logger.warn(
        { mime: file.type, name: file.name, w: dims.width, h: dims.height, ip },
        '[upload] Rejected: image dimensions exceed cap'
      )
      return NextResponse.json(
        { error: `Imagen demasiado grande (${dims.width}×${dims.height}, máx ${MAX_DIM}px en cada lado)` },
        { status: 400 }
      )
    }

    // Whitelist the extension from a known-safe set so the client can't
    // rename 'evil.html' to 'evil.jpg' to bypass the MIME check.
    const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'] as const
    const rawExt = path.extname(file.name || '').toLowerCase()
    const ext = ALLOWED_EXTS.includes(rawExt as any) ? rawExt : '.jpg'
    const uuid = randomUUID()
    const filename = `${uuid}${ext}`
    const subdir = path.join(STORAGE_DIR, folder)
    const filepath = path.join(subdir, filename)

    if (!existsSync(subdir)) {
      await mkdir(subdir, { recursive: true })
    }

    await writeFile(filepath, buffer)

    const url = `/storage/${folder}/${filename}`
    return NextResponse.json({ url }, { status: 201 })
  } catch (err) {
    logger.error(serializeErr(err), 'Upload error:')
    return NextResponse.json({ error: 'Error interno al subir' }, { status: 500 })
  }
}
