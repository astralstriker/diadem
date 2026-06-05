/** Every service in the benchmark graph exposes a deterministic value(). */
export interface Node {
  value(): number
}

export interface Framework {
  name: string
  /** Build the whole graph from scratch and return the root (cold path). */
  cold: () => Node | Promise<Node>
  /** Pre-build once, return a function that resolves the root (hot path). */
  makeHot: () => (() => Node) | Promise<() => Node>
}

/**
 * Expected value() of the root App for the shared 11-node graph. Each framework
 * must produce this, proving the graphs are equivalent.
 *
 * Config=1 Clock=2 Logger=5 Metrics=10 Db=22 Cache=43 UserRepo=91 OrderRepo=193
 * UserService=352 OrderService=1067 App=2448
 */
export const EXPECTED_VALUE = 2448
