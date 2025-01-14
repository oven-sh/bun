import assert from "node:assert";
assert.strictEqual(globalThis.preload, ["multi/preload1.ts", "multi/preload2.ts", "multi/preload3.ts"]);
