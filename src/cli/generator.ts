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

/** Run the full generation pipeline and write the manifest file. */
export function generateManifest(config: DiademConfig): GenerateResult {
  const files = collectFiles(config)
  const services: ServiceInfo[] = []
  for (const file of files) {
    services.push(...analyzeFile(file.fullPath, file.relPath))
  }

  const { sorted, cycles, duplicateTokens } = resolveAndSort(services)
  sorted.forEach((service, index) => {
    service.registrationOrder = index
  })

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

  const argExpr = (service: ServiceInfo): string => {
    const arity = service.dependencies.reduce(
      (max, d) => Math.max(max, d.paramIndex + 1),
      0
    )
    const args: string[] = Array.from({ length: arity }, () => 'undefined')
    for (const dep of service.resolvedDependencies) {
      if (dep.external) {
        args[dep.paramIndex] = dep.isOptional
          ? 'undefined'
          : externalDefault(dep.typeName)
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

/** Build a fully-wired, ready container. */
export function createContainer(): DiademContainer {
  const c = new DiademContainer()
${lines.join('\n')}
  c.setReady()
  return c
}
${accessorBlock}`
}
