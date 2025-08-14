import { test, expect } from "bun:test";

test("CSS import with type attribute should be preserved in transpiler - issue #15310", () => {
  const transpiler = new Bun.Transpiler({ loader: "js" });
  
  const input = `import reset from "./reset.css" with { type: "css" };
console.log(reset);
document.adoptedStyleSheets = [reset];`;
  
  const result = transpiler.transformSync(input, "js");
  
  // The CSS import attribute should be preserved
  expect(result).toContain('with { type: "css" }');
  expect(result).toContain('import reset from "./reset.css" with { type: "css" };');
});

test("JSON import with type attribute should be preserved in transpiler", () => {
  const transpiler = new Bun.Transpiler({ loader: "js" });
  
  const input = `import data from "./data.json" with { type: "json" };
console.log(data);`;
  
  const result = transpiler.transformSync(input, "js");
  
  // The JSON import attribute should be preserved  
  expect(result).toContain('with { type: "json" }');
  expect(result).toContain('import data from "./data.json" with { type: "json" };');
});

test("Bun-specific import attributes should only be preserved on Bun platform", () => {
  const transpiler = new Bun.Transpiler({ loader: "js" });
  
  const input = `import data from "./data.toml" with { type: "toml" };
console.log(data);`;
  
  const result = transpiler.transformSync(input, "js");
  
  // TOML imports are Bun-specific and should not be preserved in transpiler mode
  // (when is_bun_platform is false)
  expect(result).not.toContain('with { type: "toml" }');
  expect(result).toContain('import data from "./data.toml";');
});