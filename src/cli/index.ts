#!/usr/bin/env node
/**
 * `diadem` CLI — build-time manifest generation.
 *
 * Usage:
 *   diadem build [options]
 *
 * Options:
 *   --scan-dir <dir>      Directory to scan (repeatable). Default: src
 *   --out <file>          Output manifest path. Default: src/generated/service-manifest.ts
 *   --include <regex>     Filename include pattern (repeatable). Default: \.ts$
 *   --exclude <regex>     Filename exclude pattern (repeatable).
 *   --env <name>          Environment to group by (repeatable). Default: development, production, test
 *   --cwd <dir>           Project root. Default: current directory
 *   --fail-on-cycle       Exit non-zero if a dependency cycle is detected
 *   -h, --help            Show this help
 *
 * Config file: a `diadem.config.json` in the project root is merged under CLI flags.
 */

import { loadConfig, type DiademConfigInput } from './config'
import { generateManifest } from './generator'

interface ParsedArgs {
  command: string
  cwd: string
  failOnCycle: boolean
  strict: boolean
  help: boolean
  overrides: DiademConfigInput
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: 'build',
    cwd: process.cwd(),
    failOnCycle: false,
    strict: false,
    help: false,
    overrides: {}
  }
  const scanDirs: string[] = []
  const include: string[] = []
  const exclude: string[] = []
  const environments: string[] = []

  let i = 0
  if (argv[i] && !argv[i].startsWith('-')) {
    parsed.command = argv[i]
    i++
  }

  for (; i < argv.length; i++) {
    const arg = argv[i]
    const next = (): string => {
      const value = argv[++i]
      if (value === undefined) {
        throw new Error(`Missing value for ${arg}`)
      }
      return value
    }
    switch (arg) {
      case '--scan-dir':
        scanDirs.push(next())
        break
      case '--out':
        parsed.overrides.outFile = next()
        break
      case '--include':
        include.push(next())
        break
      case '--exclude':
        exclude.push(next())
        break
      case '--env':
        environments.push(next())
        break
      case '--cwd':
        parsed.cwd = next()
        break
      case '--emit': {
        const mode = next()
        if (mode !== 'manifest' && mode !== 'compiled') {
          throw new Error(`Invalid --emit value: ${mode} (expected manifest|compiled)`)
        }
        parsed.overrides.emit = mode
        break
      }
      case '--target-env':
        parsed.overrides.targetEnv = next()
        break
      case '--fail-on-cycle':
        parsed.failOnCycle = true
        break
      case '--strict':
        parsed.strict = true
        break
      case '-h':
      case '--help':
        parsed.help = true
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  if (scanDirs.length) parsed.overrides.scanDirs = scanDirs
  if (include.length) parsed.overrides.include = include
  if (exclude.length) parsed.overrides.exclude = exclude
  if (environments.length) parsed.overrides.environments = environments

  return parsed
}

const HELP = `diadem — build-time DI manifest generator

Usage:
  diadem build [options]

Options:
  --scan-dir <dir>     Directory to scan (repeatable). Default: src
  --out <file>         Output manifest path. Default: src/generated/service-manifest.ts
  --include <regex>    Filename include pattern (repeatable). Default: \\.ts$
  --exclude <regex>    Filename exclude pattern (repeatable).
  --env <name>         Environment to group by (repeatable). Default: development, production, test
  --emit <mode>        Output mode: manifest (default) or compiled (straight-line wiring)
  --target-env <name>  For --emit=compiled, bake in a single environment
  --cwd <dir>          Project root. Default: current directory
  --fail-on-cycle      Exit non-zero if a dependency cycle is detected
  --strict             Exit non-zero on cycles, ambiguous tokens, or required
                       dependencies with no implementing service
  -h, --help           Show this help

A diadem.config.json in the project root is merged under CLI flags.
`

function main(): void {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    process.stdout.write(HELP)
    return
  }

  if (args.command !== 'build') {
    process.stderr.write(`Unknown command: ${args.command}\n\n${HELP}`)
    process.exit(1)
  }

  const config = loadConfig(args.cwd, args.overrides)
  const result = generateManifest(config)

  process.stdout.write(
    `diadem: wrote ${result.serviceCount} services to ${result.outFile}\n`
  )
  if (result.externalDependencies > 0) {
    process.stdout.write(
      `diadem: ${result.externalDependencies} external dependencies (not container-managed)\n`
    )
  }

  // Always surface ambiguity/cycles as warnings.
  for (const token of result.duplicateTokens) {
    process.stderr.write(
      `diadem: warning — token ${token} is declared by more than one service (ambiguous)\n`
    )
  }
  if (result.cycles.length > 0) {
    process.stderr.write(
      `diadem: warning — dependency cycle(s) detected: ${result.cycles.join(', ')}\n`
    )
  }

  // Decide whether to fail the build.
  const cycleViolation = result.cycles.length > 0 && (args.strict || args.failOnCycle)
  const strictViolation =
    args.strict &&
    (result.unresolved.length > 0 || result.duplicateTokens.length > 0)

  if (args.strict) {
    for (const dep of result.unresolved) {
      process.stderr.write(
        `diadem: error — ${dep.service} requires ${dep.typeName} (${dep.paramName}), but no service implements it\n`
      )
    }
  }

  if (cycleViolation || strictViolation) {
    process.exit(1)
  }
}

try {
  main()
} catch (error) {
  process.stderr.write(
    `diadem: ${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exit(1)
}
