// Cold-start + memory benchmark. Spawns each framework's app as a fresh Node
// process (so module load + decorator-metadata processing + JIT cold are all
// counted, the way a serverless cold start pays), times it, and reads retained
// heap after a GC. Reports the median over N runs, and the delta over a
// framework-free baseline.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
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

const results = {}
for (const [name, entry] of Object.entries(apps)) {
  const times = []
  const heaps = []
  // warmup
  execFileSync(process.execPath, ['--expose-gc', entry], {
    env: { ...process.env, MEASURE: '1' }
  })
  for (let i = 0; i < N; i++) {
    const t0 = performance.now()
    const out = execFileSync(process.execPath, ['--expose-gc', entry], {
      env: { ...process.env, MEASURE: '1' }
    }).toString()
    times.push(performance.now() - t0)
    try {
      heaps.push(JSON.parse(out).heap)
    } catch {
      /* ignore */
    }
  }
  results[name] = { ms: median(times), heap: median(heaps) || 0 }
  console.log(`  measured ${name}`)
}

const base = results.baseline
const rows = Object.entries(results)
  .filter(([name]) => name !== 'baseline')
  .map(([name, r]) => ({
    name,
    ms: r.ms,
    dms: r.ms - base.ms,
    heapMb: r.heap / 1024 / 1024,
    dHeapMb: (r.heap - base.heap) / 1024 / 1024
  }))
  .sort((a, b) => a.dms - b.dms)

const report = [
  `### Cold start + memory (median of ${N} fresh processes)`,
  '',
  `Baseline (Node + harness, no framework): ${base.ms.toFixed(1)} ms, ${(base.heap / 1024 / 1024).toFixed(1)} MB heap. The delta columns subtract it.`,
  '',
  '| framework | startup (ms) | Δ over baseline | heap (MB) | Δ heap |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...rows.map(
    (r) =>
      `| ${r.name} | ${r.ms.toFixed(1)} | +${r.dms.toFixed(1)} | ${r.heapMb.toFixed(1)} | +${r.dHeapMb.toFixed(1)} |`
  ),
  ''
].join('\n')

console.log('\n' + report)
writeFileSync(new URL('./COLDSTART.md', import.meta.url), report)
console.log('Wrote bench/COLDSTART.md')
