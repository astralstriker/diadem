/**
 * Build-time DI manifest generator.
 *
 * Scans the configured source directories, finds DI-decorated classes via the
 * TypeScript AST, extracts each constructor's dependencies, resolves them
 * token-first, topologically sorts the graph, and emits a `service-manifest.ts`
 * conforming to Diadem's `ServiceManifestModule` contract — no runtime
 * reflection required.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import type { DiademConfig } from './config'

/** The published package name that generated files import from. */
const PACKAGE_NAME = '@devcraft-ts/diadem'

type Lifecycle =
  | 'dependency'
  | 'singleton'
  | 'factory'
  | 'lazy'
  | 'lazySingleton'

const LIFECYCLE_BY_DECORATOR: Record<string, Lifecycle> = {
  singleton: 'singleton',
  factory: 'factory',
  lazy: 'lazy',
  lazySingleton: 'lazySingleton',
  injectable: 'dependency'
}

interface RawDependency {
  paramName: string
  paramIndex: number
  typeName: string
  isOptional: boolean
  isReadonly: boolean
  isPrivate: boolean
}

interface ResolvedDependency extends RawDependency {
  implementingService?: string
  external?: boolean
}

/** Where a token (abstract class) can be imported from. */
type TokenModule =
  | { kind: 'file'; fullPath: string }
  | { kind: 'bare'; specifier: string }

interface ServiceInfo {
  className: string
  lifecycle: Lifecycle
  environment?: string
  token?: string
  tokenExported: boolean
  /** Resolved import source of the token, for the typed accessor surface. */
  tokenModule?: TokenModule
  fullPath: string
  filePath: string
  exported: boolean
  dependencies: RawDependency[]
  resolvedDependencies: ResolvedDependency[]
  registrationOrder: number
}

/** A required dependency that no registered service implements. */
export interface UnresolvedDependency {
  service: string
  paramName: string
  typeName: string
}

export interface GenerateResult {
  outFile: string
  serviceCount: number
  cycles: string[]
  externalDependencies: number
  /** Required (non-optional) dependencies with no implementing service. */
  unresolved: UnresolvedDependency[]
  /** Tokens declared by more than one service (ambiguous resolution). */
  duplicateTokens: string[]
}

const PRIMITIVE_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'Date',
  'Array',
  'Object',
  'any',
  'unknown',
  'void',
  'null',
  'undefined',
  'Promise',
  'RegExp',
  'Error',
  'Map',
  'Set'
])

/**
 * Scan the source and resolve the dependency graph (shared by the manifest
 * generator and the graph visualizer). Returns services in topological order
 * with their resolved dependencies, plus detected cycles and duplicate tokens.
 */
function analyzeGraph(config: DiademConfig): {
  services: ServiceInfo[]
  cycles: string[]
  duplicateTokens: string[]
} {
  const files = collectFiles(config)
  const services: ServiceInfo[] = []
  for (const file of files) {
    services.push(...analyzeFile(file.fullPath, file.relPath))
  }
  const { sorted, cycles, duplicateTokens } = resolveAndSort(services)
  sorted.forEach((service, index) => {
    service.registrationOrder = index
  })
  return { services: sorted, cycles, duplicateTokens }
}

/** Run the full generation pipeline and write the manifest file. */
export function generateManifest(config: DiademConfig): GenerateResult {
  const { services: sorted, cycles, duplicateTokens } = analyzeGraph(config)

  const outFile = resolve(config.rootDir, config.outFile)
  const content =
    config.emit === 'compiled'
      ? renderCompiled(sorted, config, outFile)
      : renderManifest(sorted, config, outFile)
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, content, 'utf8')

  const externalDependencies = sorted.reduce(
    (sum, s) => sum + s.resolvedDependencies.filter((d) => d.external).length,
    0
  )

  const unresolved: UnresolvedDependency[] = []
  for (const service of sorted) {
    for (const dep of service.resolvedDependencies) {
      if (dep.external && !dep.isOptional) {
        unresolved.push({
          service: service.className,
          paramName: dep.paramName,
          typeName: dep.typeName
        })
      }
    }
  }

  return {
    outFile,
    serviceCount: sorted.length,
    cycles,
    externalDependencies,
    unresolved,
    duplicateTokens
  }
}

// --- File collection -------------------------------------------------------

interface ScannedFile {
  fullPath: string
  relPath: string
}

function collectFiles(config: DiademConfig): ScannedFile[] {
  const files: ScannedFile[] = []
  for (const dir of config.scanDirs) {
    const abs = resolve(config.rootDir, dir)
    if (!existsSync(abs)) {
      continue
    }
    walk(abs, dir, config, files)
  }
  return files
}

function walk(
  absDir: string,
  relDir: string,
  config: DiademConfig,
  out: ScannedFile[]
): void {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const fullPath = join(absDir, entry.name)
    const relPath = join(relDir, entry.name)
    if (entry.isDirectory()) {
      walk(fullPath, relPath, config, out)
    } else if (entry.isFile() && shouldScan(relPath, config)) {
      out.push({ fullPath, relPath })
    }
  }
}

function shouldScan(relPath: string, config: DiademConfig): boolean {
  const normalized = relPath.replace(/\\/g, '/')
  if (config.exclude.some((re) => re.test(normalized))) {
    return false
  }
  return config.include.some((re) => re.test(normalized))
}

// --- AST analysis ----------------------------------------------------------

function analyzeFile(fullPath: string, relPath: string): ServiceInfo[] {
  const source = ts.createSourceFile(
    fullPath,
    readFileSync(fullPath, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true
  )

  // Where each name in scope comes from — for resolving token import sources.
  const tokenSources = new Map<string, TokenModule>()
  const fileDir = dirname(fullPath)
  const exportedClasses = new Set<string>()

  ts.forEachChild(source, function collect(node) {
    // import { A, B } from '...'
    if (
      ts.isImportDeclaration(node) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text
      const module: TokenModule = specifier.startsWith('.')
        ? { kind: 'file', fullPath: resolve(fileDir, specifier) }
        : { kind: 'bare', specifier }
      for (const element of node.importClause.namedBindings.elements) {
        tokenSources.set(element.name.text, module)
      }
    }
    // Locally declared, exported abstract classes can serve as tokens.
    if (ts.isClassDeclaration(node) && node.name && isExported(node)) {
      exportedClasses.add(node.name.text)
      tokenSources.set(node.name.text, { kind: 'file', fullPath })
    }
    ts.forEachChild(node, collect)
  })

  const services: ServiceInfo[] = []
  ts.forEachChild(source, function visit(node) {
    if (ts.isClassDeclaration(node)) {
      const info = analyzeClass(node, fullPath, relPath, exportedClasses, tokenSources)
      if (info) {
        services.push(info)
      }
    }
    ts.forEachChild(node, visit)
  })

  return services
}

function analyzeClass(
  node: ts.ClassDeclaration,
  fullPath: string,
  relPath: string,
  exportedClasses: Set<string>,
  tokenSources: Map<string, TokenModule>
): ServiceInfo | null {
  if (!node.name) {
    return null
  }

  const decoratorInfo = findDIDecorator(node)
  if (!decoratorInfo) {
    return null
  }

  const dependencies = analyzeConstructor(node)
  const token = decoratorInfo.token

  return {
    className: node.name.text,
    lifecycle: decoratorInfo.lifecycle,
    environment: decoratorInfo.environment,
    token,
    tokenExported: !!token && exportedClasses.has(token),
    tokenModule: token ? tokenSources.get(token) : undefined,
    fullPath,
    filePath: relPath.replace(/\\/g, '/'),
    exported: isExported(node),
    dependencies,
    resolvedDependencies: [],
    registrationOrder: 0
  }
}

interface DecoratorInfo {
  lifecycle: Lifecycle
  token?: string
  environment?: string
}

function findDIDecorator(node: ts.ClassDeclaration): DecoratorInfo | null {
  const decorators = ts.canHaveDecorators(node)
    ? (ts.getDecorators(node) ?? [])
    : []

  for (const decorator of decorators) {
    const expr = decorator.expression
    let name = ''
    let args: ts.NodeArray<ts.Expression> | undefined

    if (ts.isCallExpression(expr)) {
      name = expr.expression.getText()
      args = expr.arguments
    } else if (ts.isIdentifier(expr)) {
      name = expr.getText()
    }

    const lifecycle = LIFECYCLE_BY_DECORATOR[name]
    if (!lifecycle) {
      continue
    }

    let token: string | undefined
    let environment: string | undefined
    if (args && args.length > 0 && ts.isIdentifier(args[0])) {
      token = args[0].getText()
    }
    if (args && args.length > 1 && ts.isStringLiteral(args[1])) {
      environment = args[1].text
    }

    return { lifecycle, token, environment }
  }

  return null
}

function analyzeConstructor(node: ts.ClassDeclaration): RawDependency[] {
  const ctor = node.members.find((m) => ts.isConstructorDeclaration(m)) as
    | ts.ConstructorDeclaration
    | undefined
  if (!ctor) {
    return []
  }

  const deps: RawDependency[] = []
  ctor.parameters.forEach((param, index) => {
    if (!param.type) {
      return
    }
    const typeName = extractTypeName(param.type)
    if (isPrimitive(typeName)) {
      return
    }

    const modifiers = ts.canHaveModifiers(param)
      ? (ts.getModifiers(param) ?? [])
      : []

    deps.push({
      paramName: param.name.getText(),
      paramIndex: index,
      typeName,
      isOptional: !!param.questionToken || !!param.initializer,
      isReadonly: modifiers.some(
        (m) => m.kind === ts.SyntaxKind.ReadonlyKeyword
      ),
      isPrivate: modifiers.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword)
    })
  })

  return deps
}

function extractTypeName(typeNode: ts.TypeNode): string {
  const raw = ts.isTypeReferenceNode(typeNode)
    ? typeNode.typeName.getText()
    : typeNode.getText()
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/\[\]/g, '')
    .trim()
}

function isPrimitive(typeName: string): boolean {
  return (
    PRIMITIVE_TYPES.has(typeName) ||
    typeName.toLowerCase() === typeName ||
    typeName.includes('<')
  )
}

function isExported(node: ts.ClassDeclaration): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined
  return (
    modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false
  )
}

// --- Dependency resolution + topological sort ------------------------------

function resolveAndSort(services: ServiceInfo[]): {
  sorted: ServiceInfo[]
  cycles: string[]
  duplicateTokens: string[]
} {
  const serviceByName = new Map<string, ServiceInfo>()
  const tokenToImpl = new Map<string, string>()
  const duplicateTokens = new Set<string>()

  for (const service of services) {
    serviceByName.set(service.className, service)
    if (service.token) {
      if (tokenToImpl.has(service.token)) {
        duplicateTokens.add(service.token)
      } else {
        tokenToImpl.set(service.token, service.className)
      }
    }
  }

  const resolveByHeuristic = (typeName: string): string | undefined => {
    const direct = serviceByName.get(typeName)
    if (direct) {
      return direct.className
    }
    if (typeName.startsWith('I')) {
      const stripped = typeName.slice(1)
      if (serviceByName.has(stripped)) {
        return stripped
      }
      const suffixed = services.find(
        (s) =>
          (s.className.endsWith('Service') ||
            s.className.endsWith('Repository')) &&
          s.className.includes(stripped)
      )
      if (suffixed) {
        return suffixed.className
      }
    }
    return undefined
  }

  for (const service of services) {
    service.resolvedDependencies = service.dependencies.map((dep) => {
      const implementingService =
        tokenToImpl.get(dep.typeName) ?? resolveByHeuristic(dep.typeName)
      return implementingService
        ? { ...dep, implementingService }
        : { ...dep, external: true }
    })
  }

  const { sorted, cycles } = topologicalSort(services, serviceByName)
  return { sorted, cycles, duplicateTokens: [...duplicateTokens] }
}

function topologicalSort(
  services: ServiceInfo[],
  serviceByName: Map<string, ServiceInfo>
): { sorted: ServiceInfo[]; cycles: string[] } {
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const sorted: ServiceInfo[] = []
  const cycles: string[] = []

  const visit = (name: string): void => {
    if (visited.has(name)) {
      return
    }
    if (visiting.has(name)) {
      cycles.push(name)
      return
    }
    const service = serviceByName.get(name)
    if (!service) {
      return
    }
    visiting.add(name)
    for (const dep of service.resolvedDependencies) {
      if (dep.implementingService && !dep.external) {
        visit(dep.implementingService)
      }
    }
    visiting.delete(name)
    visited.add(name)
    sorted.push(service)
  }

  for (const service of services) {
    visit(service.className)
  }

  return { sorted, cycles }
}

// --- Emit ------------------------------------------------------------------

function importPathFor(outFile: string, serviceFullPath: string): string {
  let rel = relative(dirname(outFile), serviceFullPath)
    .replace(/\\/g, '/')
    .replace(/\.ts$/, '')
  if (!rel.startsWith('.')) {
    rel = `./${rel}`
  }
  return rel
}

function groupByEnvironment(
  services: ServiceInfo[],
  environments: string[]
): Record<string, ServiceInfo[]> {
  const groups: Record<string, ServiceInfo[]> = { all: [] }
  for (const env of environments) {
    groups[env] = []
  }
  for (const service of services) {
    groups.all.push(service)
    if (service.environment) {
      groups[service.environment]?.push(service)
    } else {
      for (const env of environments) {
        groups[env].push(service)
      }
    }
  }
  return groups
}

function toEntry(service: ServiceInfo, outFile: string): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    className: service.className,
    importPath: importPathFor(outFile, service.fullPath),
    lifecycle: service.lifecycle,
    exported: service.exported,
    filePath: service.filePath,
    registrationOrder: service.registrationOrder,
    dependencies: service.dependencies,
    resolvedDependencies: service.resolvedDependencies
  }
  if (service.environment) {
    entry.environment = service.environment
  }
  return entry
}

function renderManifest(
  services: ServiceInfo[],
  config: DiademConfig,
  outFile: string
): string {
  const byEnv = groupByEnvironment(services, config.environments)

  // Static imports grouped by (computed) import path.
  const importsByPath = new Map<string, Set<string>>()
  for (const service of services) {
    const path = importPathFor(outFile, service.fullPath)
    const names = importsByPath.get(path) ?? new Set<string>()
    names.add(service.className)
    if (
      service.token &&
      service.token !== service.className &&
      service.tokenExported
    ) {
      names.add(service.token)
    }
    importsByPath.set(path, names)
  }

  const staticImports = [...importsByPath.keys()]
    .sort()
    .map((path) => {
      const names = [...(importsByPath.get(path) ?? [])].sort()
      return names.length === 1
        ? `import { ${names[0]} } from '${path}'`
        : `import {\n  ${names.join(',\n  ')}\n} from '${path}'`
    })
    .join('\n')

  const serviceClassMapping = services
    .map((s) => `  ${s.className}`)
    .join(',\n')

  const envEntries = ['all', ...config.environments]
    .map(
      (env) =>
        `  ${env}: ${JSON.stringify(byEnv[env].map((s) => toEntry(s, outFile)), null, 2)} as ServiceManifestEntry[]`
    )
    .join(',\n')

  const lifecycleCounts = (
    ['dependency', 'singleton', 'factory', 'lazy', 'lazySingleton'] as const
  )
    .map((lc) => `    ${lc}: ${services.filter((s) => s.lifecycle === lc).length}`)
    .join(',\n')

  const totalDependencies = services.reduce(
    (sum, s) => sum + s.dependencies.length,
    0
  )
  const externalDependencies = services.reduce(
    (sum, s) => sum + s.resolvedDependencies.filter((d) => d.external).length,
    0
  )
  const maxDepth = services.reduce(
    (max, s) => Math.max(max, s.dependencies.length),
    0
  )

  return `/**
 * Auto-generated by \`diadem build\`. DO NOT EDIT MANUALLY.
 *
 * Total services: ${services.length}
 */

/* eslint-disable */

import type {
  ImportedService,
  ServiceManifestEntry
} from '${PACKAGE_NAME}'

${staticImports}

export const SERVICE_MANIFEST: ServiceManifestEntry[] = ${JSON.stringify(
    services.map((s) => toEntry(s, outFile)),
    null,
    2
  )} as ServiceManifestEntry[]

export const SERVICES_BY_ENVIRONMENT = {
${envEntries}
}

export const SERVICE_CLASSES = {
${serviceClassMapping}
} as const

export function getServicesForEnvironment(
  environment?: string
): ServiceManifestEntry[] {
  if (!environment || environment === 'all') {
    return SERVICE_MANIFEST
  }
  return (
    SERVICES_BY_ENVIRONMENT[
      environment as keyof typeof SERVICES_BY_ENVIRONMENT
    ] ?? []
  )
}

export async function importService(entry: ServiceManifestEntry) {
  const serviceClass =
    SERVICE_CLASSES[entry.className as keyof typeof SERVICE_CLASSES]
  if (!serviceClass) {
    throw new Error(\`Service \${entry.className} not found in manifest.\`)
  }
  return serviceClass
}

export async function importAllServices(
  entries: ServiceManifestEntry[]
): Promise<ImportedService[]> {
  const ordered = [...entries].sort(
    (a, b) => a.registrationOrder - b.registrationOrder
  )
  const results: ImportedService[] = []
  for (const entry of ordered) {
    const serviceClass =
      SERVICE_CLASSES[entry.className as keyof typeof SERVICE_CLASSES]
    if (serviceClass) {
      results.push({ entry, serviceClass })
    }
  }
  return results
}

export const MANIFEST_STATS = {
  totalServices: ${services.length},
  environments: [${config.environments.map((e) => `'${e}'`).join(', ')}],
  lifecycles: {
${lifecycleCounts}
  },
  dependencyAnalysis: {
    servicesWithDependencies: ${services.filter((s) => s.dependencies.length > 0).length},
    totalDependencies: ${totalDependencies},
    externalDependencies: ${externalDependencies},
    maxDependencyDepth: ${maxDepth}
  }
}
`
}

// --- Emit (compiled wiring) ------------------------------------------------

const EAGER_LIFECYCLES: ReadonlySet<Lifecycle> = new Set([
  'singleton',
  'dependency',
  'lazySingleton'
])

function localName(className: string): string {
  return `_${className}`
}

function externalDefault(typeName: string): string {
  switch (typeName) {
    case 'string':
      return "''"
    case 'number':
      return '0'
    case 'boolean':
      return 'false'
    default:
      return 'undefined'
  }
}

/**
 * Emit a straight-line `createContainer()` instead of an interpreted manifest.
 * Services are constructed in topological order with direct local-variable
 * references — no manifest array, no resolver loop, no per-dependency lookups
 * during construction. One environment is baked in (config.targetEnv) so there
 * is zero runtime branching.
 *
 * Note: in compiled mode `lazySingleton` is treated as eager (its instance is
 * needed up front to be referenced by dependents), and runtime mock/override
 * registration is not available — use the manifest emit for dev/test if you
 * need that dynamism.
 */
function renderCompiled(
  allServices: ServiceInfo[],
  config: DiademConfig,
  outFile: string
): string {
  const target = config.targetEnv
  const services = allServices.filter(
    (s) => !target || !s.environment || s.environment === target
  )
  const selected = new Set(services.map((s) => s.className))
  const eager = new Map<string, boolean>()
  for (const s of services) {
    eager.set(s.className, EAGER_LIFECYCLES.has(s.lifecycle))
  }

  const classNames = new Set(services.map((s) => s.className))

  // Group imports by computed path (impl classes + token classes).
  const importsByPath = new Map<string, Set<string>>()
  const addImport = (path: string, name: string): void => {
    const names = importsByPath.get(path) ?? new Set<string>()
    names.add(name)
    importsByPath.set(path, names)
  }
  for (const service of services) {
    addImport(importPathFor(outFile, service.fullPath), service.className)
  }

  // Services exposed in the type-safe accessor surface: those with a uniquely
  // named, importable token. (Duplicate or unlocatable tokens are skipped, as
  // are tokens whose name collides with a different service class.)
  const tokenCount = new Map<string, number>()
  for (const s of services) {
    if (s.token) {
      tokenCount.set(s.token, (tokenCount.get(s.token) ?? 0) + 1)
    }
  }
  const tokenPath = (m: TokenModule): string =>
    m.kind === 'file' ? importPathFor(outFile, m.fullPath) : m.specifier
  const typed = services.filter(
    (s): s is ServiceInfo & { token: string; tokenModule: TokenModule } =>
      !!s.token &&
      !!s.tokenModule &&
      tokenCount.get(s.token) === 1 &&
      (s.token === s.className || !classNames.has(s.token))
  )
  for (const s of typed) {
    addImport(tokenPath(s.tokenModule), s.token)
  }

  const serviceImports = [...importsByPath.keys()]
    .sort()
    .map((path) => {
      const names = [...(importsByPath.get(path) ?? [])].sort()
      return names.length === 1
        ? `import { ${names[0]} } from '${path}'`
        : `import {\n  ${names.join(',\n  ')}\n} from '${path}'`
    })
    .join('\n')

  let needsRequireExternal = false
  const argExpr = (service: ServiceInfo): string => {
    const arity = service.dependencies.reduce(
      (max, d) => Math.max(max, d.paramIndex + 1),
      0
    )
    const args: string[] = Array.from({ length: arity }, () => 'undefined')
    for (const dep of service.resolvedDependencies) {
      if (dep.external) {
        if (dep.isOptional) {
          args[dep.paramIndex] = 'undefined'
        } else {
          // A required external the container can't construct. Use a primitive
          // default if there is one; otherwise emit a fail-fast throw rather
          // than silently passing `undefined` (which would crash later).
          const prim = externalDefault(dep.typeName)
          if (prim !== 'undefined') {
            args[dep.paramIndex] = prim
          } else {
            needsRequireExternal = true
            args[dep.paramIndex] =
              `requireExternal(${JSON.stringify(service.className)}, ` +
              `${JSON.stringify(dep.paramName)}, ${JSON.stringify(dep.typeName)})`
          }
        }
        continue
      }
      const impl = dep.implementingService
      if (impl && selected.has(impl)) {
        args[dep.paramIndex] = eager.get(impl)
          ? localName(impl)
          : `c.resolve(token(${impl}))`
      } else {
        args[dep.paramIndex] = 'undefined'
      }
    }
    return args.join(', ')
  }

  const lines: string[] = []
  for (const service of services) {
    const cls = service.className
    if (eager.get(cls)) {
      lines.push(`  const ${localName(cls)} = new ${cls}(${argExpr(service)})`)
      lines.push(`  c.register(token(${cls}), ${localName(cls)})`)
    } else {
      lines.push(
        `  c.registerFactory(token(${cls}), () => new ${cls}(${argExpr(service)}))`
      )
    }
  }

  const targetComment = target
    ? `environment: ${target}`
    : 'environment: all'

  const requireExternalHelper = needsRequireExternal
    ? `
function requireExternal(service: any, param: any, type: any): never {
  throw new Error(
    'diadem: ' + service + ' requires an external "' + type + '" (' + param + ') that the ' +
    'container cannot construct. Make the parameter optional, give it a primitive default, ' +
    'or wrap the dependency in a @singleton service.'
  )
}
`
    : ''

  const accessorBlock =
    typed.length === 0
      ? ''
      : `
/**
 * Type-safe accessor surface. Only registered tokens are present, each typed to
 * its token — resolving an unregistered token is a compile error.
 */
export interface DiademServices {
${typed.map((s) => `  ${s.token}: ${s.token}`).join('\n')}
}

export function createServices(): DiademServices & {
  readonly container: DiademContainer
  dispose: () => Promise<void>
} {
  const container = createContainer()
  return {
    container,
    dispose: () => container.dispose(),
${typed
  .map(
    (s) =>
      `    get ${s.token}(): ${s.token} {\n      return container.resolve(${s.token})\n    }`
  )
  .join(',\n')}
  }
}
`

  return `/**
 * Auto-generated by \`diadem build --emit=compiled\`. DO NOT EDIT MANUALLY.
 *
 * Straight-line wiring (${targetComment}). Total services: ${services.length}.
 */

/* eslint-disable */

import { DiademContainer, getDIMetadata } from '${PACKAGE_NAME}'

${serviceImports}

function token(cls: any): any {
  const meta = getDIMetadata(cls)
  if (!meta) {
    throw new Error('diadem: missing DI metadata for ' + cls.name)
  }
  return meta.token
}
${requireExternalHelper}
/** Build a fully-wired, ready container. */
export function createContainer(): DiademContainer {
  const c = new DiademContainer()
${lines.join('\n')}
  c.setReady()
  return c
}
${accessorBlock}`
}

// --- Graph visualizer ------------------------------------------------------

export interface GraphResult {
  outFile: string
  serviceCount: number
  edgeCount: number
  externalCount: number
  cycles: string[]
}

interface CyElement {
  data: Record<string, string | number>
}

interface GraphData {
  elements: CyElement[]
  stats: {
    services: number
    edges: number
    externals: number
    cycles: number
  }
  environments: string[]
  cycles: string[]
}

/** A rendered graph: the HTML plus summary counts (no file written). */
export interface RenderedGraph {
  html: string
  serviceCount: number
  edgeCount: number
  externalCount: number
  cycles: string[]
}

/**
 * Analyze the source and produce the interactive HTML graph as a string.
 * Used by both `generateGraph` (writes a file) and the `--serve` mode (which
 * re-renders on each request).
 */
export function renderGraph(config: DiademConfig): RenderedGraph {
  const { services, cycles } = analyzeGraph(config)
  const cycleSet = new Set(cycles)
  const nodes: CyElement[] = []
  const edges: CyElement[] = []
  const externals = new Set<string>()
  const envs = new Set<string>()

  for (const s of services) {
    if (s.environment) {
      envs.add(s.environment)
    }
    nodes.push({
      data: {
        id: s.className,
        label: s.className,
        lifecycle: s.lifecycle,
        env: s.environment ?? '',
        file: s.filePath,
        token: s.token ?? '',
        cycle: cycleSet.has(s.className) ? 1 : 0
      }
    })
    for (const dep of s.resolvedDependencies) {
      if (dep.implementingService) {
        edges.push({
          data: {
            id: `${s.className}->${dep.implementingService}#${dep.paramIndex}`,
            source: s.className,
            target: dep.implementingService,
            optional: dep.isOptional ? 1 : 0,
            kind: 'internal'
          }
        })
      } else if (dep.external) {
        externals.add(dep.typeName)
        edges.push({
          data: {
            id: `${s.className}->ext:${dep.typeName}#${dep.paramIndex}`,
            source: s.className,
            target: `ext:${dep.typeName}`,
            optional: dep.isOptional ? 1 : 0,
            kind: 'external'
          }
        })
      }
    }
  }
  for (const t of externals) {
    nodes.push({
      data: {
        id: `ext:${t}`,
        label: t,
        lifecycle: 'external',
        env: '',
        file: '',
        token: '',
        cycle: 0
      }
    })
  }

  const data: GraphData = {
    elements: [...nodes, ...edges],
    stats: {
      services: services.length,
      edges: edges.length,
      externals: externals.size,
      cycles: cycles.length
    },
    environments: [...envs].sort(),
    cycles
  }

  return {
    html: renderGraphHtml(data),
    serviceCount: services.length,
    edgeCount: edges.length,
    externalCount: externals.size,
    cycles
  }
}

/**
 * Analyze the source and write a self-contained interactive HTML graph file.
 */
export function generateGraph(
  config: DiademConfig,
  graphOut: string
): GraphResult {
  const rendered = renderGraph(config)
  const outFile = resolve(config.rootDir, graphOut)
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, rendered.html, 'utf8')
  return {
    outFile,
    serviceCount: rendered.serviceCount,
    edgeCount: rendered.edgeCount,
    externalCount: rendered.externalCount,
    cycles: rendered.cycles
  }
}

function renderGraphHtml(data: GraphData): string {
  // Escape </ so a class name can never break out of the <script> tag.
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>diadem · dependency graph</title>
<script src="https://unpkg.com/cytoscape@3.30.2/dist/cytoscape.min.js"></script>
<script src="https://unpkg.com/dagre@0.8.5/dist/dagre.min.js"></script>
<script src="https://unpkg.com/cytoscape-dagre@2.5.0/cytoscape-dagre.js"></script>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; color: #111; }
  header { padding: 10px 16px; border-bottom: 1px solid #e5e7eb; display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  header h1 { font-size: 15px; margin: 0; font-weight: 700; }
  header .stats { color: #6b7280; }
  header .cycle-warn { color: #b91c1c; font-weight: 600; }
  select { font: inherit; padding: 2px 6px; }
  main { display: flex; height: calc(100vh - 49px); }
  #cy { flex: 1; height: 100%; background: #fafafa; }
  aside { width: 300px; border-left: 1px solid #e5e7eb; padding: 14px 16px; overflow: auto; }
  aside h2 { font-size: 14px; margin: 0 0 8px; }
  aside .meta { color: #6b7280; margin-bottom: 10px; word-break: break-all; }
  aside ul { margin: 4px 0 12px; padding-left: 18px; }
  .legend { display: flex; gap: 12px; flex-wrap: wrap; color: #374151; }
  .legend span::before { content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
  .lg-singleton::before { background: #3b82f6; }
  .lg-lazy::before { background: #10b981; }
  .lg-lazysingleton::before { background: #8b5cf6; }
  .lg-external::before { background: #9ca3af; }
</style>
</head>
<body>
<header>
  <h1>diadem</h1>
  <span class="stats" id="stats"></span>
  <span class="cycle-warn" id="cyclewarn"></span>
  <label>env: <select id="env"></select></label>
  <span class="legend">
    <span class="lg-singleton">singleton</span>
    <span class="lg-lazysingleton">lazySingleton</span>
    <span class="lg-lazy">lazy / factory</span>
    <span class="lg-external">external</span>
  </span>
</header>
<main>
  <div id="cy"></div>
  <aside id="panel"></aside>
</main>
<script>
var DATA = ${json};
var DEFAULT_PANEL = '<h2>Dependency graph</h2><div class="meta">Click a node to inspect it. Arrows point from a service to what it depends on. Red border = part of a cycle.</div>';

var s = DATA.stats;
document.getElementById('stats').textContent =
  s.services + ' services · ' + s.edges + ' edges · ' + s.externals + ' external';
if (s.cycles > 0) {
  document.getElementById('cyclewarn').textContent = '⚠ ' + s.cycles + ' cycle(s): ' + DATA.cycles.join(', ');
}

var sel = document.getElementById('env');
var optAll = document.createElement('option');
optAll.value = 'all'; optAll.textContent = 'all';
sel.appendChild(optAll);
DATA.environments.forEach(function (e) {
  var o = document.createElement('option');
  o.value = e; o.textContent = e;
  sel.appendChild(o);
});

var cy = cytoscape({
  container: document.getElementById('cy'),
  elements: DATA.elements,
  style: [
    { selector: 'node', style: { 'label': 'data(label)', 'font-size': 10, 'text-valign': 'center', 'text-halign': 'center', 'color': '#fff', 'width': 'label', 'height': 22, 'padding': '8px', 'shape': 'round-rectangle', 'background-color': '#3b82f6', 'border-width': 1, 'border-color': '#1e3a8a' } },
    { selector: 'node[lifecycle="lazySingleton"]', style: { 'background-color': '#8b5cf6', 'border-color': '#5b21b6' } },
    { selector: 'node[lifecycle="lazy"]', style: { 'background-color': '#10b981', 'border-color': '#065f46' } },
    { selector: 'node[lifecycle="factory"]', style: { 'background-color': '#10b981', 'border-color': '#065f46' } },
    { selector: 'node[lifecycle="external"]', style: { 'background-color': '#9ca3af', 'border-color': '#4b5563', 'border-style': 'dashed', 'color': '#111' } },
    { selector: 'node[cycle=1]', style: { 'border-color': '#dc2626', 'border-width': 3 } },
    { selector: 'edge', style: { 'width': 1.5, 'line-color': '#cbd5e1', 'target-arrow-color': '#cbd5e1', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'arrow-scale': 0.9 } },
    { selector: 'edge[optional=1]', style: { 'line-style': 'dashed' } },
    { selector: 'edge[kind="external"]', style: { 'line-color': '#e5e7eb', 'line-style': 'dashed', 'target-arrow-color': '#e5e7eb' } },
    { selector: '.faded', style: { 'opacity': 0.12 } }
  ],
  layout: { name: 'dagre', rankDir: 'TB', nodeSep: 22, rankSep: 55 }
});

var panel = document.getElementById('panel');
panel.innerHTML = DEFAULT_PANEL;

function list(arr) {
  if (!arr.length) return '<ul><li style="color:#9ca3af">none</li></ul>';
  return '<ul>' + arr.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
}

cy.on('tap', 'node', function (evt) {
  var n = evt.target;
  var d = n.data();
  var deps = n.outgoers('node').map(function (x) { return x.data('label'); });
  var dependents = n.incomers('node').map(function (x) { return x.data('label'); });
  var html = '<h2>' + d.label + '</h2>';
  html += '<div class="meta">';
  html += 'lifecycle: <b>' + d.lifecycle + '</b><br>';
  if (d.token) html += 'token: ' + d.token + '<br>';
  if (d.env) html += 'env: ' + d.env + '<br>';
  if (d.file) html += 'file: ' + d.file;
  html += '</div>';
  html += '<b>depends on</b>' + list(deps);
  html += '<b>used by</b>' + list(dependents);
  panel.innerHTML = html;
  cy.elements().addClass('faded');
  n.closedNeighborhood().removeClass('faded');
});

cy.on('tap', function (e) {
  if (e.target === cy) {
    cy.elements().removeClass('faded');
    panel.innerHTML = DEFAULT_PANEL;
  }
});

sel.addEventListener('change', function () {
  var v = sel.value;
  cy.nodes().forEach(function (n) {
    var env = n.data('env');
    var hide = v !== 'all' && env && env !== v;
    n.style('display', hide ? 'none' : 'element');
  });
  cy.layout({ name: 'dagre', rankDir: 'TB', nodeSep: 22, rankSep: 55 }).run();
});
</script>
</body>
</html>
`
}
