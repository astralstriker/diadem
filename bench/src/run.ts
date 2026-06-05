import 'reflect-metadata' // must be first, for tsyringe / inversify
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
  for (const f of frameworks) {
    const root = await f.cold()
    if (root.value() !== EXPECTED_VALUE) {
      throw new Error(
        `${f.name} produced value()=${root.value()}, expected ${EXPECTED_VALUE}`
      )
    }
  }
}

function table(title: string, bench: Bench): string {
  const rows = bench.tasks
    .map((t) => ({
      name: t.name.replace(/^(cold|hot): /, ''),
      hz: t.result?.hz ?? 0
    }))
    .sort((a, b) => b.hz - a.hz)
  const top = rows[0]?.hz || 1
  return [
    `### ${title}`,
    '',
    '| framework | ops/sec | relative |',
    '| --- | ---: | ---: |',
    ...rows.map(
      (r) =>
        `| ${r.name} | ${Math.round(r.hz).toLocaleString('en-US')} | ${(r.hz / top).toFixed(2)}× |`
    )
  ].join('\n')
}

/** Cold build + hot resolve sections, as markdown. */
export async function coreBenchSections(): Promise<string> {
  await verify()

  const cold = new Bench({ time: 1000 })
  for (const f of frameworks) {
    cold.add(`cold: ${f.name}`, async () => {
      await f.cold()
    })
  }
  await cold.run()

  const hot = new Bench({ time: 1000 })
  for (const f of frameworks) {
    const resolve = await f.makeHot()
    hot.add(`hot: ${f.name}`, () => {
      resolve()
    })
  }
  await hot.run()

  return [
    table('Cold build — build the whole container, in-process', cold),
    '',
    table('Hot resolve — *noise floor; see notes*', hot),
    '',
    '> At ~25M ops/sec the hot numbers are dominated by call/loop overhead, not the lookup. Treat the fast group (vanilla, typed-inject, both diadem modes) as tied; only the reflect-metadata containers are distinguishable.'
  ].join('\n')
}

if (require.main === module) {
  coreBenchSections()
    .then((s) => {
      console.log(s)
    })
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
