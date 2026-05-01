import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/14789
test("#14789 Bun.Transpiler with JSX should not eliminate bare JSX expressions", () => {
  const transpiler = new Bun.Transpiler({ loader: "jsx" });

  // A bare JSX expression statement should be preserved, not eliminated
  const result = transpiler.transformSync("<div>first</div>");
  expect(result).toContain("jsxDEV");

  // Assigned JSX should also still work
  const assigned = transpiler.transformSync("const x = <div>first</div>");
  expect(assigned).toContain("jsxDEV");

  // Exported JSX should also still work
  const exported = transpiler.transformSync("export default <div>first</div>");
  expect(exported).toContain("jsxDEV");

  // Even with explicit DCE, JSX should be preserved (tree shaking is not enabled)
  const withDCE = new Bun.Transpiler({ loader: "jsx", deadCodeElimination: true });
  const dceResult = withDCE.transformSync("<div>first</div>");
  expect(dceResult).toContain("jsxDEV");
});
