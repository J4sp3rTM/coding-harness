import { defineConfig } from 'tsdown'

/** Build the shared recorder as a separately published runtime subpath. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/invariant.js', 'lib/types/recorder.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
