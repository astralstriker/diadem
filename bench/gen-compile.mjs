// Transpile the generated scaling graphs (src/gen) with esbuild instead of tsc.
// They're machine-generated and measured at runtime only, so type-checking them
// is pure cost (and the large-N typed-inject / diadem files OOM tsc). esbuild
// transpiles any size instantly. Note: esbuild can't emit decorator metadata,
// so the scaling set uses frameworks that don't need it (inversify uses explicit
// @inject; tsyringe — which needs emitDecoratorMetadata — is excluded from scaling).
import { build } from 'esbuild'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      walk(p, acc)
    } else if (p.endsWith('.ts')) {
      acc.push(p)
    }
  }
  return acc
}

await build({
  entryPoints: walk('src/gen'),
  outdir: 'dist/gen',
  outbase: 'src/gen',
  format: 'cjs',
  platform: 'node',
  bundle: false,
  logLevel: 'error',
  tsconfigRaw: {
    compilerOptions: {
      experimentalDecorators: true,
      useDefineForClassFields: false
    }
  }
})
console.log('Transpiled src/gen → dist/gen (esbuild)')
