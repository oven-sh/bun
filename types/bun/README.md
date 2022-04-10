# Bun type definitions

This has type definitions for Bun.js APIs. The type definitions are merged into a single file and copied to [../../packages/bun-types/types.d.ts](../../packages/bun-types/types.d.ts).

## Adding a new file

1. Add it to [./index.d.ts](./index.d.ts)
2. Add it to [./paths.txt](./paths.txt)

## How to generate types.d.ts

[`./bundle.ts`](./bundle.ts) merges the types in this folder into a single file.

To run it:

```bash
bun ./bundle.ts ../../packages/bun-types
```
