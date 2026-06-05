// Shared sink/report for the per-framework "app" entries. The value() is used
// so the build can't be tree-shaken away; when MEASURE is set, it reports
// retained heap (after a GC) for the cold-start / memory benchmark.
export function report(value: number): void {
  ;(globalThis as { __sink?: number }).__sink = value
  if (process.env.MEASURE) {
    const gc = (globalThis as { gc?: () => void }).gc
    if (gc) {
      gc()
    }
    process.stdout.write(
      JSON.stringify({ value, heap: process.memoryUsage().heapUsed })
    )
  }
}
