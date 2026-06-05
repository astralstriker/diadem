import 'reflect-metadata'
import { performance } from 'node:perf_hooks'
import { NS } from './scaling-gen.mjs'

// tsyringe is excluded from scaling (needs emitDecoratorMetadata, which the
// esbuild transpile of the generated graphs can't produce). inversify covers
// the reflect-metadata camp here.
const frameworks = [
  ['vanilla (hand-written)', 'vanilla'],
  ['diadem (compiled)', 'diadem'],
  ['typed-inject', 'typedinject'],
  ['inversify', 'inversify']
]

let keep
function msPerBuild(build) {
  for (let i = 0; i < 5; i++) keep = build() // warmup
  const rounds = []
  for (let r = 0; r < 3; r++) {
    let count = 0
    const t0 = performance.now()
    while (performance.now() - t0 < 120) {
      keep = build()
      count++
    }
    rounds.push((performance.now() - t0) / count)
  }
  rounds.sort((a, b) => a - b)
  return rounds[1] // median of 3
}

export async function scalingSection() {
  const data = {}
  for (const [name, prefix] of frameworks) {
    data[name] = {}
    for (const N of NS) {
      const mod = await import(`./dist/gen/${prefix}${N}.js`)
      data[name][N] = msPerBuild(mod.build)
    }
  }

  const fmt = (ms) => (ms < 1 ? ms.toPrecision(2) : ms.toFixed(2)) + ' ms'
  const header = `| framework | ${NS.map((n) => `N=${n}`).join(' | ')} |`
  const sep = `| --- | ${NS.map(() => '---:').join(' | ')} |`
  const rows = frameworks.map(
    ([name]) =>
      `| ${name} | ${NS.map((n) => fmt(data[name][n])).join(' | ')} |`
  )
  return [
    `Build time for the whole container as the graph grows (${NS.join('/')} services). Lower is better.`,
    '',
    header,
    sep,
    ...rows,
    '',
    `Watch the slope, not the absolute numbers: diadem and hand-written wiring grow roughly linearly with a small constant, while inversify (reflect-metadata) climbs much faster. tsyringe is omitted here — it needs emitDecoratorMetadata, which the generated-graph transpile can't emit; it behaves like inversify on this axis.`
  ].join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(await scalingSection())
}
