import 'reflect-metadata' // must be first, for tsyringe / inversify
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bench } from 'tinybench'
import { diademCompiled, diademManifest } from './diadem'
import { inversify } from './inversify'
import { tsyringe } from './tsyringe'
import { typedInject } from './typedinject'
import { EXPECTED_VALUE, type Framework } from './types'
import { vanilla } from './vanilla'

const frameworks: Framework[] = [
  vanilla,
  diademCompiled,
  diademManifest,
  tsyringe,
  inversify,
  typedInject
]

async function verify(): Promise<void> {
  console.log('Verifying graphs are equivalent (value() must be ' + EXPECTED_VALUE + ')...')
  for (const f of frameworks) {
    const root = await f.cold()
    const v = root.value()
    if (v !== EXPECTED_VALUE) {
      throw new Error(`${f.name} produced value()=${v}, expected ${EXPECTED_VALUE}`)
    }
    console.log(`  ok  ${f.name}`)
  }
}

function table(title: string, bench: Bench): string {
  const rows = bench.tasks
    .map((t) => ({
      name: t.name.replace(/^(cold|hot): /, ''),
      hz: t.result?.hz ?? 0,
      rme: t.result?.rme ?? 0
    }))
    .sort((a, b) => b.hz - a.hz)
  const top = rows[0]?.hz || 1
  return [
    `### ${title}`,
    '',
    '| framework | ops/sec | relative | ±rme |',
    '| --- | ---: | ---: | ---: |',
    ...rows.map(
      (r) =>
        `| ${r.name} | ${Math.round(r.hz).toLocaleString('en-US')} | ${(r.hz / top).toFixed(2)}× | ${r.rme.toFixed(1)}% |`
    )
  ].join('\n')
}

async function main(): Promise<void> {
  await verify()

  const cold = new Bench({ time: 1000 })
  for (const f of frameworks) {
    cold.add(`cold: ${f.name}`, async () => {
      await f.cold()
    })
  }
  console.log('\nRunning COLD (build whole graph + resolve root)...')
  await cold.run()

  const hot = new Bench({ time: 1000 })
  for (const f of frameworks) {
    const resolve = await f.makeHot()
    hot.add(`hot: ${f.name}`, () => {
      resolve()
    })
  }
  console.log('Running HOT (resolve root from a prebuilt container)...')
  await hot.run()

  const report = [
    '# diadem benchmark',
    '',
    `\`${process.version}\` · ${process.platform}/${process.arch} · 11-service dependency graph`,
    '',
    '- **Cold** — build the entire graph from scratch and resolve the root. This is where build-time wiring wins.',
    '- **Hot** — resolve the root from an already-built container (cached lookup).',
    '',
    table('Cold: build + resolve', cold),
    '',
    table('Hot: resolve', hot),
    ''
  ].join('\n')

  console.log('\n' + report)
  writeFileSync(join(__dirname, '..', 'RESULTS.md'), report)
  console.log('\nWrote bench/RESULTS.md')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
