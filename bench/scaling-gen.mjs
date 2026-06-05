// Generates an N-service graph for each framework into src/gen/, so we can
// measure how build cost scales with graph size. Each service i depends on
// services [i-1, i-2] (a chain with fan-in 2); the root is service N-1.
// Generated files are // @ts-nocheck (machine-generated, measured at runtime).
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const NS = [10, 30, 100, 300]
const GEN = 'src/gen'

// Each service depends on the previous one plus the shared leaf S0. Fan-in 2,
// but the number of root→leaf paths stays linear (not fibonacci as [i-1, i-2]
// would be), so plan-walking resolvers like inversify don't blow up at large N.
const deps = (i) => (i === 0 ? [] : i === 1 ? [0] : [i - 1, 0])
const range = (n) => Array.from({ length: n }, (_, i) => i)
const head = '// @ts-nocheck\n'

function vanilla(N) {
  const classes = range(N).map((i) => {
    const ps = deps(i)
      .map((d, k) => `public a${k}: S${d}`)
      .join(', ')
    return `class S${i} {${ps ? ` constructor(${ps}) {}` : ''}}`
  })
  const news = range(N).map(
    (i) => `  const s${i} = new S${i}(${deps(i).map((d) => `s${d}`).join(', ')})`
  )
  return `${head}${classes.join('\n')}
export const N = ${N}
export function build() {
${news.join('\n')}
  return s${N - 1}
}
`
}

function tsyringe(N) {
  const classes = range(N).map((i) => {
    const ps = deps(i)
      .map((d, k) => `public a${k}: S${d}`)
      .join(', ')
    return `@injectable() class S${i} {${ps ? ` constructor(${ps}) {}` : ''}}`
  })
  return `${head}import { container, injectable } from 'tsyringe'
${classes.join('\n')}
const ALL = [${range(N).map((i) => `S${i}`).join(', ')}]
export const N = ${N}
export function build() {
  const c = container.createChildContainer()
  for (const X of ALL) c.registerSingleton(X)
  return c.resolve(S${N - 1})
}
`
}

function inversify(N) {
  const classes = range(N).map((i) => {
    const ps = deps(i)
      .map((d, k) => `@inject(S${d}) public a${k}: S${d}`)
      .join(', ')
    return `@injectable() class S${i} {${ps ? ` constructor(${ps}) {}` : ''}}`
  })
  return `${head}import { Container, inject, injectable } from 'inversify'
${classes.join('\n')}
const ALL = [${range(N).map((i) => `S${i}`).join(', ')}]
export const N = ${N}
export function build() {
  const c = new Container()
  for (const X of ALL) c.bind(X).toSelf().inSingletonScope()
  return c.get(S${N - 1})
}
`
}

function typedinject(N) {
  const classes = range(N).map((i) => {
    const tokens = deps(i).map((d) => `'s${d}'`).join(', ')
    const ps = deps(i)
      .map((d, k) => `public a${k}: S${d}`)
      .join(', ')
    return `class S${i} { static inject = [${tokens}] as const;${ps ? ` constructor(${ps}) {}` : ''}}`
  })
  // Use an `any` accumulator: chaining N provideClass() calls builds a recursive
  // generic that blows up tsc's type-checker at large N. Runtime is identical.
  const provides = range(N)
    .map((i) => `  inj = inj.provideClass('s${i}', S${i}, Scope.Singleton)`)
    .join('\n')
  return `${head}import { createInjector, Scope } from 'typed-inject'
${classes.join('\n')}
export const N = ${N}
export function build() {
  let inj: any = createInjector()
${provides}
  return inj.resolve('s${N - 1}')
}
`
}

function diademServices(N) {
  const out = [`${head}import { singleton } from '@devcraft-ts/diadem'`]
  for (const i of range(N)) {
    const ps = deps(i)
      .map((d, k) => `private a${k}: I${d}`)
      .join(', ')
    out.push(`export abstract class I${i} {}`)
    out.push(
      `@singleton(I${i}) export class S${i} extends I${i} {${ps ? ` constructor(${ps}) { super() }` : ''}}`
    )
  }
  return out.join('\n') + '\n'
}

function diademWrapper(N) {
  return `${head}import { createContainer } from './diadem${N}/container'
import { I${N - 1} } from './diadem${N}/services'
export const N = ${N}
export function build() {
  return createContainer().resolve(I${N - 1})
}
`
}

export function generateScaling() {
  rmSync(GEN, { recursive: true, force: true })
  mkdirSync(GEN, { recursive: true })

  for (const N of NS) {
    // tsyringe is excluded from scaling: it needs emitDecoratorMetadata, which
    // the esbuild transpile of src/gen can't produce.
    writeFileSync(join(GEN, `vanilla${N}.ts`), vanilla(N))
    writeFileSync(join(GEN, `inversify${N}.ts`), inversify(N))
    writeFileSync(join(GEN, `typedinject${N}.ts`), typedinject(N))

    const dir = join(GEN, `diadem${N}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'services.ts'), diademServices(N))
    writeFileSync(join(GEN, `diadem${N}.ts`), diademWrapper(N))

    // diadem build → compiled container for this graph
    execFileSync(
      process.execPath,
      [
        '../dist/cli.js',
        'build',
        '--cwd',
        '.',
        '--scan-dir',
        `src/gen/diadem${N}`,
        '--emit',
        'compiled',
        '--out',
        `src/gen/diadem${N}/container.ts`,
        '--target-env',
        'production'
      ],
      { stdio: 'ignore' }
    )
  }
  console.log(`Generated scaling graphs for N = ${NS.join(', ')}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateScaling()
}
