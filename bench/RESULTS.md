# diadem benchmark

`v24.15.0` · linux/x64 · 11-service dependency graph

- **Cold** — build the entire graph from scratch and resolve the root. This is where build-time wiring wins.
- **Hot** — resolve the root from an already-built container (cached lookup).

### Cold: build + resolve

| framework | ops/sec | relative | ±rme |
| --- | ---: | ---: | ---: |
| vanilla (hand-written) | 6,816,075 | 1.00× | 1.7% |
| diadem (compiled) | 1,228,703 | 0.18× | 0.2% |
| typed-inject | 667,466 | 0.10× | 2.2% |
| tsyringe | 375,348 | 0.06× | 0.4% |
| diadem (manifest) | 82,535 | 0.01× | 0.2% |
| inversify | 23,768 | 0.00× | 1.1% |

### Hot: resolve

| framework | ops/sec | relative | ±rme |
| --- | ---: | ---: | ---: |
| vanilla (hand-written) | 28,773,258 | 1.00× | 0.0% |
| typed-inject | 26,583,453 | 0.92× | 0.0% |
| diadem (compiled) | 23,501,152 | 0.82× | 0.0% |
| diadem (manifest) | 22,200,080 | 0.77× | 0.0% |
| tsyringe | 10,383,615 | 0.36× | 0.1% |
| inversify | 1,874,237 | 0.07× | 0.2% |
