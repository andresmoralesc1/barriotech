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

function matchesMagic(buf: Buffer, mime: string): boolean {
  const check = MAGIC_BYTES[mime]
  if (!check) return false
  return check(buf)
}

export async function POST(req: NextRequest) {
    const csrf = requireSameOrigin(req); if (csrf) return csrf
  // Rate limit BEFORE auth — uploads are expensive (disk I/O).
  // 20 uploads / hour / IP — generous for legit use, blocks storage abuse.
  const ip = getClientIp(req)
  const { allowed, retryAfter } = await checkRateLimit(ip, 'upload', 20, 60 * 60 * 1000)
  if (!allowed) {
    return NextResponse.json(
      { error: 'Demasiadas subidas. Intenta más tarde.', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
  }

  try {
    // P1-1 (audit 2026-07-27): require verified email before uploading
    // images (creating blob storage records). Photos are surfaced under
    // a vendor/product immediately.
    const auth = await requireVerifiedEmail(req)
    if (auth instanceof NextResponse) return auth
    const userId = auth.userId

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
