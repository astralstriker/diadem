import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** What the generator emits. */
export type EmitMode = 'manifest' | 'compiled'

/** Resolved generator configuration (regexes compiled, paths absolute-ready). */
export interface DiademConfig {
  rootDir: string
  scanDirs: string[]
  include: RegExp[]
  exclude: RegExp[]
  outFile: string
  environments: string[]
  /** 'manifest' (data, interpreted at runtime) or 'compiled' (straight-line wiring). */
  emit: EmitMode
  /** For `emit: 'compiled'`, bake in a single environment (else wire all). */
  targetEnv?: string
}

/** User-facing config (from `diadem.config.json` or CLI flags). */
export interface DiademConfigInput {
  scanDirs?: string[]
  include?: string[]
  exclude?: string[]
  outFile?: string
  environments?: string[]
  emit?: EmitMode
  targetEnv?: string
}

const DEFAULTS = {
  scanDirs: ['src'],
  // Default: every .ts file. The AST pass keeps only DI-decorated classes, so
  // `include` is purely an optional performance narrowing (e.g. ['Service\\.ts$']).
  include: ['\\.ts$'],
  exclude: [
    '\\.test\\.ts$',
    '\\.spec\\.ts$',
    '\\.d\\.ts$',
    'node_modules',
    '/dist/',
    '/build/',
    '/generated/'
  ],
  outFile: 'src/generated/service-manifest.ts',
  environments: ['development', 'production', 'test'],
  emit: 'manifest' as EmitMode,
  targetEnv: undefined as string | undefined
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Partial<T>
}

/**
 * Build a resolved config from defaults, an optional `diadem.config.json` in
 * `rootDir`, and CLI overrides (highest precedence).
 */
export function loadConfig(
  rootDir: string,
  overrides: DiademConfigInput = {}
): DiademConfig {
  let fileConfig: DiademConfigInput = {}
  const configPath = resolve(rootDir, 'diadem.config.json')
  if (existsSync(configPath)) {
    fileConfig = JSON.parse(
      readFileSync(configPath, 'utf8')
    ) as DiademConfigInput
  }

  const merged = {
    ...DEFAULTS,
    ...stripUndefined(fileConfig),
    ...stripUndefined(overrides)
  }

  return {
    rootDir,
    scanDirs: merged.scanDirs,
    include: merged.include.map((p) => new RegExp(p)),
    exclude: merged.exclude.map((p) => new RegExp(p)),
    outFile: merged.outFile,
    environments: merged.environments,
    emit: merged.emit,
    targetEnv: merged.targetEnv
  }
}
