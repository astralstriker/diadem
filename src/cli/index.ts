#!/usr/bin/env node
/**
 * `diadem` CLI — build-time manifest generation + graph visualization.
 *
 * Usage:
 *   diadem build [options]    Generate the manifest (or compiled wiring)
 *   diadem graph [options]    Write an interactive HTML dependency-graph viewer
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

import { spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import {
  loadConfig,
  type DiademConfig,
  type DiademConfigInput
} from './config'
import { generateGraph, generateManifest, renderGraph } from './generator'

interface ParsedArgs {
  command: string
  cwd: string
  failOnCycle: boolean
  strict: boolean
  serve: boolean
  watch: boolean
  port?: number
  help: boolean
  overrides: DiademConfigInput
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    command: 'build',
    cwd: process.cwd(),
    failOnCycle: false,
    strict: false,
    serve: false,
    watch: false,
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
    const raw = argv[i]
    // Accept both `--flag value` and `--flag=value`.
    const eq = raw.startsWith('--') ? raw.indexOf('=') : -1
    const arg = eq === -1 ? raw : raw.slice(0, eq)
    const inline = eq === -1 ? undefined : raw.slice(eq + 1)
    const next = (): string => {
      if (inline !== undefined) {
        return inline
      }
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
      case '--port':
        parsed.port = Number(next())
        break
      case '--serve':
        parsed.serve = true
        break
      case '--watch':
        parsed.watch = true
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
  diadem build [options]    Generate the service manifest (or compiled wiring)
  diadem graph [options]    Write an interactive HTML dependency-graph viewer

Options:
  --scan-dir <dir>     Directory to scan (repeatable). Default: src
  --out <file>         Output path. Default: build → src/generated/service-manifest.ts,
                       graph → diadem-graph.html
  --include <regex>    Filename include pattern (repeatable). Default: \\.ts$
  --exclude <regex>    Filename exclude pattern (repeatable).
  --env <name>         Environment to group by (repeatable). Default: development, production, test
  --emit <mode>        build: manifest (default) or compiled (straight-line wiring)
  --target-env <name>  For --emit=compiled, bake in a single environment
  --watch              build: rebuild when scanned source changes
  --serve              graph: serve on a local port instead of writing a file
  --port <n>           graph: port for --serve (default 4321)
  --cwd <dir>          Project root. Default: current directory
  --fail-on-cycle      build: exit non-zero if a dependency cycle is detected
  --strict             build: exit non-zero on cycles, ambiguous tokens, or required
                       dependencies with no implementing service
  -h, --help           Show this help

A diadem.config.json in the project root is merged under CLI flags.
`

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  try {
    spawn(cmd[0] as string, cmd[1] as string[], {
      stdio: 'ignore',
      detached: true
    }).unref()
  } catch {
    /* opening the browser is best-effort */
  }
}

function serveGraph(args: ParsedArgs): void {
  const config = loadConfig(args.cwd, args.overrides)
  const port = args.port ?? 4321

  const server = createServer((req, res) => {
    if (req.url && req.url !== '/' && req.url !== '/index.html') {
      res.writeHead(404).end('not found')
      return
    }
    try {
      // Re-analyze on every request, so editing a service and refreshing the
      // page shows the updated graph (no restart needed).
      const { html } = renderGraph(config)
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(error instanceof Error ? error.message : String(error))
    }
  })

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      process.stderr.write(
        `diadem: port ${port} is in use — try --port <n>\n`
      )
    } else {
      process.stderr.write(`diadem: ${error.message}\n`)
    }
    process.exit(1)
  })

  server.listen(port, () => {
    const url = `http://localhost:${port}`
    process.stdout.write(
      `diadem: serving dependency graph at ${url}\n` +
        `diadem: re-analyzes on each refresh · Ctrl+C to stop\n`
    )
    openBrowser(url)
  })
}

function runGraph(args: ParsedArgs): void {
  if (args.serve) {
    serveGraph(args)
    return
  }
  const config = loadConfig(args.cwd, args.overrides)
  const out = args.overrides.outFile ?? 'diadem-graph.html'
  const result = generateGraph(config, out)
  process.stdout.write(
    `diadem: wrote graph (${result.serviceCount} services, ${result.edgeCount} edges` +
      `${result.externalCount ? `, ${result.externalCount} external` : ''}) to ${result.outFile}\n`
  )
  if (result.cycles.length > 0) {
    process.stderr.write(
      `diadem: warning — dependency cycle(s) detected: ${result.cycles.join(', ')}\n`
    )
  }
}

/** Run one build, printing results. Returns true if it was a strict/cycle failure. */
function buildOnce(config: DiademConfig, args: ParsedArgs): boolean {
  const result = generateManifest(config)

  process.stdout.write(
    `diadem: wrote ${result.serviceCount} services to ${result.outFile}\n`
  )
  if (result.externalDependencies > 0) {
    process.stdout.write(
      `diadem: ${result.externalDependencies} external dependencies (not container-managed)\n`
    )
  }

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
  if (args.strict) {
    for (const dep of result.unresolved) {
      process.stderr.write(
        `diadem: error — ${dep.service} requires ${dep.typeName} (${dep.paramName}), but no service implements it\n`
      )
    }
  }

  const cycleViolation =
    result.cycles.length > 0 && (args.strict || args.failOnCycle)
  const strictViolation =
    args.strict &&
    (result.unresolved.length > 0 || result.duplicateTokens.length > 0)
  return cycleViolation || strictViolation
}

const activeWatchers: ReturnType<typeof watch>[] = []

function startWatch(config: DiademConfig, args: ParsedArgs): void {
  const outFile = resolve(config.rootDir, config.outFile)
  let timer: NodeJS.Timeout | undefined

  const rebuild = (): void => {
    timer = undefined
    try {
      buildOnce(config, args)
    } catch (error) {
      process.stderr.write(
        `diadem: ${error instanceof Error ? error.message : String(error)}\n`
      )
    }
  }

  const onChange = (filename: string | null, dirAbs: string): void => {
    if (filename) {
      if (!filename.endsWith('.ts')) {
        return
      }
      if (resolve(dirAbs, filename) === outFile) {
        return // ignore our own generated output
      }
    }
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(rebuild, 120) // debounce bursts of save events
  }

  for (const dir of config.scanDirs) {
    const abs = resolve(config.rootDir, dir)
    try {
      activeWatchers.push(
        watch(abs, { recursive: true }, (_event, filename) => {
          onChange(filename ? filename.toString() : null, abs)
        })
      )
    } catch (error) {
      process.stderr.write(
        `diadem: cannot watch ${dir}: ${error instanceof Error ? error.message : String(error)}\n`
      )
    }
  }

  process.stdout.write(
    `diadem: watching ${config.scanDirs.join(', ')} for changes · Ctrl+C to stop\n`
  )
}

function runBuild(args: ParsedArgs): void {
  const config = loadConfig(args.cwd, args.overrides)
  const failed = buildOnce(config, args)
  if (args.watch) {
    startWatch(config, args)
    return
  }
  if (failed) {
    process.exit(1)
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    process.stdout.write(HELP)
    return
  }

  if (args.command === 'graph') {
    runGraph(args)
    return
  }

  if (args.command !== 'build') {
    process.stderr.write(`Unknown command: ${args.command}\n\n${HELP}`)
    process.exit(1)
  }

  runBuild(args)
}

try {
  main()
} catch (error) {
  process.stderr.write(
    `diadem: ${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exit(1)
}
