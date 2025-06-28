import { expect, test } from "bun:test";
const node_js_shim = require("./abort-controller-fixture");

test("AbortController from abort-controller fixture works when used with ESM -> CJS -> ESM", () => {
  expect(node_js_shim.AbortController).toBe(AbortController);
});

test("AbortController from abort-controller fixture works when used with ESM -> ESM", async () => {
  delete require.cache["abort-controller"];
  const node_js_shim = await import("abort-controller");
  expect(node_js_shim.AbortController).toBe(AbortController);
});
