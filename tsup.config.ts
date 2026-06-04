import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'setup/index': 'src/setup/index.ts',
    cli: 'src/cli/index.ts'
  },
  format: ['esm', 'cjs'],
  dts: { entry: { index: 'src/index.ts', 'setup/index': 'src/setup/index.ts' } },
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: true,
  // typescript is a peer dependency, only needed by the CLI generator.
  external: ['typescript'],
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' }
  }
})
