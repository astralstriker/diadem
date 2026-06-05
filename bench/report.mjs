import 'reflect-metadata' // first, for in-process tsyringe / inversify (scaling)
import { writeFileSync } from 'node:fs'
import { bundleSection } from './bundlesize.mjs'
import { coldStartSection } from './coldstart.mjs'
import { scalingSection } from './scaling.mjs'

const { coreBenchSections } = await import('./dist/run.js')

const header = `# diadem benchmark results

\`${process.version}\` · ${process.platform}/${process.arch}

Compares \`@devcraft-ts/diadem\` against tsyringe, inversify, typed-inject, and
hand-written wiring. Most metrics use an 11-service graph; the last grows the
graph to measure scaling. Every framework implements the same graph and a
\`value()\` checksum verifies equivalence. Microbenchmarks on one machine — run
\`npm run report\` on your own hardware. See README.md for methodology.`

const sections = [
  header,
  '## Bundle size — *frontend / edge*',
  await bundleSection(),
  '## Cold start + memory — *serverless*',
  await coldStartSection(),
  '## Cold build + hot resolve',
  await coreBenchSections(),
  '## Scaling — build time vs graph size',
  await scalingSection()
]

writeFileSync(new URL('./RESULTS.md', import.meta.url), sections.join('\n\n') + '\n')
console.log('Wrote bench/RESULTS.md')
