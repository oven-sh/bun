import { expect, test } from "bun:test";
import { tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/27709
// sideEffects field in project's own package.json should not cause the bundler
// to tree-shake away entry point re-exports.

test("sideEffects array does not drop entry point re-exports", async () => {
  using dir = tempDir("issue-27709", {
    "a.ts": `
import { createContext, createElement, useContext } from "react"
const Ctx = createContext(null)
function Root({ children }) {
  return createElement(Ctx.Provider, { value: {} }, createElement("div", null, children))
}
function Trigger({ children }) {
  const ctx = useContext(Ctx)
  return createElement("button", null, children)
}
export const A = { Root, Trigger }
`,
    "b.ts": `
import { createContext, createElement, useContext } from "react"
const Ctx = createContext(null)
function Root({ children }) {
  return createElement(Ctx.Provider, { value: {} }, createElement("div", null, children))
}
function Trigger({ children }) {
  const ctx = useContext(Ctx)
  return createElement("button", null, children)
}
export const B = { Root, Trigger }
`,
    "index.ts": `
export { A } from "./a.js"
export { B } from "./b.js"
`,
    "package.json": JSON.stringify({
      name: "test",
      type: "module",
      sideEffects: ["./dist/index.js"],
    }),
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/index.ts`],
    outdir: `${dir}/out`,
    format: "esm",
    external: ["react"],
    minify: true,
  });

  expect(result.success).toBe(true);
  expect(result.outputs.length).toBeGreaterThan(0);

  const output = await result.outputs[0].text();

  // The output must contain the actual function bodies, not just dangling references
  expect(output).toContain("createContext");
  expect(output).toContain("createElement");
});

test("sideEffects false does not drop entry point re-exports", async () => {
  using dir = tempDir("issue-27709-false", {
    "a.ts": `export const A = "alpha";`,
    "b.ts": `export const B = "beta";`,
    "index.ts": `
export { A } from "./a.js"
export { B } from "./b.js"
`,
    "package.json": JSON.stringify({
      name: "test",
      type: "module",
      sideEffects: false,
    }),
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/index.ts`],
    outdir: `${dir}/out`,
    format: "esm",
    minify: true,
  });

  expect(result.success).toBe(true);

  const output = await result.outputs[0].text();

  // Both exported values must be present in the output
  expect(output).toContain("alpha");
  expect(output).toContain("beta");
});
