# Screenshots manifest

Public-facing screenshots referenced from the main [`README.md`](../README.md).
Captured against production; some routes require auth and stay as TODOs.

- 🌐 **Production:** https://barriotech.com.co
- 🏠 **Local dev:** http://localhost:3000
- 📂 **Path in repo:** `docs/screenshots/`
- 🖼️ **Reference in README:** `![Caption](docs/screenshots/FILENAME.png)`

## Capture specs

- **Format:** PNG
- **Viewport:** 1280 × 800, devicePixelRatio = 2
- **File-size target:** < 500 KB each (use `pngquant --quality=65-85` if needed)
- **Sample data:** use demo dataset. No real users, no exact GPS coords of real vendors.

## ✅ Captured (public routes)

| # | Filename | Route | What it shows |
|---|----------|-------|----------------|
| 00 | `00-hero.png` | `/` | Landing — "El sabor de tu barrio, ahora en tu celular" |
| 01 | `01-onboarding.png` | `/onboarding` | 3-slide intro for new users |
| 02 | `02-login.png` | `/login` | Email + password sign-in |
| 03 | `03-role-select.png` | `/register` | Buyer / Seller role picker |
| 04 | `04-map-buyer.png` | `/map` | React-Leaflet map with active sellers + first-visit tour overlay |

## 🔒 Pending — auth-gated routes

These need a logged-in session. To capture them:

1. In a regular browser tab, log in to https://barriotech.com.co as a demo buyer/seller (start one in your DB if none exists).
2. From DevTools → Application → Cookies, copy the session cookies.
3. Run:

```bash
# Quick capture from the same host as the live demo, using the user-supplied cookies file.
# (paste cookies into /tmp/cookies.json first — see scripts/screenshots-auth.sh)
mkdir -p docs/screenshots
for spec in \
  "05-vendor-detail|/sellers/1" \
  "06-seller-dashboard|/seller" \
  "07-seller-edit|/seller/edit" \
  "08-settings|/settings"
do
  name="${spec%%|*}"; path="${spec##*|}"
  playwright screenshot \
    --browser=chromium \
    --viewport-size=1280,800 \
    --wait-for-timeout=4000 \
    "https://barriotech.com.co${path}" \
    "docs/screenshots/${name}.png"
done
```

> The runtime browser context doesn't share cookies with your everyday browser — pass them in with `--storage /tmp/cookies.json` (or sign in via the demo account right before each capture).

## One-liner to recapture everything

```bash
for spec in \
  "00-hero|/" \
  "01-onboarding|/onboarding" \
  "02-login|/login" \
  "03-role-select|/register" \
  "04-map-buyer|/map"
do
  name="${spec%%|*}"; path="${spec##*|}"
  playwright screenshot \
    --browser=chromium \
    --viewport-size=1280,800 \
    --wait-for-timeout=4000 \
    "https://barriotech.com.co${path}" \
    "docs/screenshots/${name}.png"
done
```
