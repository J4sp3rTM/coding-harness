/**
 * Generate every derived branding artifact from `assets/branding/`.
 *
 * Sources of truth:
 * - `assets/branding/name.json`  — `{ name, shortName }`
 * - `assets/branding/logo.svg`   — the master logo (any SVG)
 *
 * Written artifacts (all committed, so builds work without running this):
 * - `apps/web/public/favicon.svg`          — verbatim copy of the master logo
 * - `apps/web/public/branding.json`        — served; the client may read it
 * - `apps/web/public/manifest.webmanifest` — name, short_name, icon roster
 * - `apps/web/index.html`                  — the `<title>` line
 * - `apps/web/public/icons/icon-{192,512}.png` — PWA raster icons
 * - `apps/desktop/build/icon.png`          — electron-builder derives
 *                                            .icns/.ico/platform PNGs from it
 *
 * The run is idempotent: with default branding inputs it produces zero diffs.
 * Plain ESM by the same policy as `apps/desktop/scripts/stage.mjs`.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const brandingDir = join(repoRoot, 'assets', 'branding')
const webPublic = join(repoRoot, 'apps', 'web', 'public')
const desktopBuild = join(repoRoot, 'apps', 'desktop', 'build')

const branding = JSON.parse(readFileSync(join(brandingDir, 'name.json'), 'utf8'))
if (typeof branding.name !== 'string' || branding.name.trim() === '') {
  throw new Error('assets/branding/name.json: "name" must be a non-empty string')
}
if (branding.shortName !== undefined && (typeof branding.shortName !== 'string' || branding.shortName.trim() === '')) {
  throw new Error('assets/branding/name.json: "shortName" must be a non-empty string when present')
}
const shortName = branding.shortName ?? branding.name

const logo = readFileSync(join(brandingDir, 'logo.svg'))

const write = (path, content) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  console.log(`wrote ${path}`)
}

/** Rasterize the master SVG at one square size; density keeps it vector-sharp. */
const rasterize = async (size) => {
  const density = Math.ceil(72 * (size / 50))
  return sharp(logo, { density }).resize(size, size).png({ compressionLevel: 9 }).toBuffer()
}

write(join(webPublic, 'favicon.svg'), logo)
write(join(webPublic, 'branding.json'), `${JSON.stringify({ name: branding.name, shortName }, null, 2)}\n`)

const manifest = {
  id: '/',
  name: branding.name,
  short_name: shortName,
  start_url: '/',
  scope: '/',
  display: 'fullscreen',
  icons: [
    { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  ],
}
write(join(webPublic, 'manifest.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`)

for (const size of [192, 512]) {
  write(join(webPublic, 'icons', `icon-${size}.png`), await rasterize(size))
}
// electron-builder converts this single 1024px source into .icns (macOS),
// .ico (Windows), and platform PNGs during packaging.
write(join(desktopBuild, 'icon.png'), await rasterize(1024))

const indexPath = join(repoRoot, 'apps', 'web', 'index.html')
const index = readFileSync(indexPath, 'utf8')
if (!/<title>.*<\/title>/.test(index)) throw new Error(`${indexPath}: no <title> line to project branding.name into`)
write(indexPath, index.replace(/<title>.*<\/title>/, `<title>${branding.name}</title>`))

const builderPath = join(repoRoot, 'apps', 'desktop', 'electron-builder.yml')
const builder = readFileSync(builderPath, 'utf8')
if (!/^productName: .*$/m.test(builder)) throw new Error(`${builderPath}: no productName line to project branding.name into`)
write(builderPath, builder.replace(/^productName: .*$/m, `productName: ${branding.name}`))

console.log(`branding: name="${branding.name}" shortName="${shortName}"`)
