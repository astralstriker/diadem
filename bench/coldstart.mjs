// Cold-start + memory benchmark. Spawns each framework's app as a fresh Node
// process (so module load + decorator-metadata processing + JIT cold are all
// counted, like a serverless cold start), times it, and reads retained heap
// after a GC. Reports the median over N runs, delta over a framework-free
// baseline.
import { execFileSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'

const apps = {
  baseline: 'dist/apps/baseline.js',
  'vanilla (hand-written)': 'dist/apps/vanilla.js',
  'diadem (compiled)': 'dist/apps/diadem.js',
  'typed-inject': 'dist/apps/typedinject.js',
  'tsyringe': 'dist/apps/tsyringe.js',
  'inversify': 'dist/apps/inversify.js'
}

const N = 31
const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]

function run(entry) {
  return execFileSync(process.execPath, ['--expose-gc', entry], {
    env: { ...process.env, MEASURE: '1' }
  }).toString()
}

export async function coldStartSection() {
  const results = {}
  for (const [name, entry] of Object.entries(apps)) {
    const times = []
    const heaps = []
    run(entry) // warmup
    for (let i = 0; i < N; i++) {
      const t0 = performance.now()
      const out = run(entry)
      times.push(performance.now() - t0)
      try {
        heaps.push(JSON.parse(out).heap)
      } catch {
        /* ignore */
      }
    }
    results[name] = { ms: median(times), heap: median(heaps) || 0 }
  }

  const base = results.baseline
  const rows = Object.entries(results)
    .filter(([name]) => name !== 'baseline')
    .map(([name, r]) => ({
      name,
      ms: r.ms,
      dms: r.ms - base.ms,
      dHeapMb: (r.heap - base.heap) / 1024 / 1024
    }))
    .sort((a, b) => a.dms - b.dms)

  return [
    `Median of ${N} fresh Node processes. Baseline (Node + harness, no framework): ${base.ms.toFixed(1)} ms, ${(base.heap / 1024 / 1024).toFixed(1)} MB heap; deltas subtract it.`,
    '',
    '| framework | startup (ms) | Δ over baseline | Δ heap |',
    '| --- | ---: | ---: | ---: |',
    ...rows.map(
      (r) =>
        `| ${r.name} | ${r.ms.toFixed(1)} | +${r.dms.toFixed(1)} ms | +${r.dHeapMb.toFixed(1)} MB |`
    )
  ].join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(await coldStartSection())
}
