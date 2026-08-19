import { defineConfig } from 'tsdown'

/**
 * The dsh CLI ships the `bin` referenced by package.json `bin`, plus the
 * profile boot as its own named entry: the desktop shell composes the same
 * profile tree in Electron's main process and imports it through the
 * `./profile-boot` export, which needs a stable filename rather than a
 * code-split chunk. The root tsdown builds only `lib/types/index.js`, so this
 * override names both. Declarations come from `tsc -b` (dts: false).
 */
export default defineConfig({
  entry: ['lib/types/bin.js', 'lib/types/profile-boot.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
