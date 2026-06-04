// `...args: any[]` is the idiomatic constructor-type signature: it is the only
// form that accepts a class with *any* constructor parameters. The element type
// is intentionally `any` here, and constrained to these two aliases.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type AbstractConstructor<T = unknown> = abstract new (
  ...args: any[]
) => T
export type ConcreteConstructor<T = unknown> = new (...args: any[]) => T
/* eslint-enable @typescript-eslint/no-explicit-any */
