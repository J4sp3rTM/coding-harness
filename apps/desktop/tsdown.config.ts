import { defineConfig } from 'tsdown'

/**
 * The desktop shell ships one entry: the Electron main module named by
 * package.json `main`.
 *
 * `electron` is external on purpose. In the main process that specifier is
 * resolved by the Electron runtime itself; the npm package of the same name is
 * only an installer stub that reads `path.txt` relative to `__dirname`, so
 * bundling it inlines the stub and the app fails to boot. Declarations come
 * from `tsc -b` (dts: false), matching every package.
 */
export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  external: ['electron'],
  fixedExtension: false,
  dts: false,
  clean: false,
})
