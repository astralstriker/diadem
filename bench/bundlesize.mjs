// Bundle-size benchmark. Bundles each framework's "app" (build + resolve the
// 11-service graph) with esbuild (minified, tree-shaken) and reports raw +
// gzipped bytes. Bundles the tsc-COMPILED .js so reflect-metadata's emitted
// design:paramtypes arrays are counted fairly.
import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'

const apps = {
  'vanilla (hand-written)': 'dist/apps/vanilla.js',
  'diadem (compiled)': 'dist/apps/diadem.js',
  'typed-inject': 'dist/apps/typedinject.js',
  'tsyringe': 'dist/apps/tsyringe.js',
  'inversify': 'dist/apps/inversify.js'
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB'

export async function bundleSection() {
  const rows = []
  for (const [name, entry] of Object.entries(apps)) {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'node',
      write: false,
      legalComments: 'none',
      logLevel: 'silent'
    })
    const raw = result.outputFiles.reduce((s, f) => s + f.contents.length, 0)
    const gz = result.outputFiles.reduce(
      (s, f) => s + gzipSync(f.contents).length,
      0
    )
    rows.push({ name, raw, gz })
  }
  rows.sort((a, b) => a.gz - b.gz)
  const min = rows[0].gz
  return [
    'A minimal app (build the graph, resolve the root), bundled + minified by esbuild.',
    '',
    '| framework | minified | gzipped | vs smallest |',
    '| --- | ---: | ---: | ---: |',
    ...rows.map(
      (r) =>
        `| ${r.name} | ${kb(r.raw)} | ${kb(r.gz)} | ${(r.gz / min).toFixed(1)}× |`
    )
  ].join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(await bundleSection())
}
