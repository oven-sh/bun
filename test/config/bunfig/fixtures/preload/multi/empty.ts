// `bun --config=bunfig.empty.toml run index.ts`
import assert from "node:assert";
assert.strictEqual(globalThis.preload, undefined);
