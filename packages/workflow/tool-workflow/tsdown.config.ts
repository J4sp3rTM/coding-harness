import { defineConfig } from 'tsdown'

/** Build the shared recorder and steering forwarder as separately published runtime subpaths. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/invariant.js', 'lib/types/recorder.js', 'lib/types/steering.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
