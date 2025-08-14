import { describe, expect, test } from "bun:test";

// Regression tests for issue #15310
// CSS import attributes should be preserved in transpiler output
describe("transpiler preserves web standard import attributes - issue #15310", () => {
  test("CSS import attributes should be preserved", () => {
    const transpiler = new Bun.Transpiler({ loader: "js" });

    const input = `import reset from "./reset.css" with { type: "css" };
console.log(reset);
document.adoptedStyleSheets = [reset];`;

    const result = transpiler.transformSync(input, "js");

    // CSS import attributes should be preserved (web standard)
    expect(result).toContain('with { type: "css" }');
    expect(result).toContain('import reset from "./reset.css" with { type: "css" };');
  });

  test("JSON import attributes should be preserved", () => {
    const transpiler = new Bun.Transpiler({ loader: "js" });

    const input = `import data from "./data.json" with { type: "json" };
console.log(data);`;

    const result = transpiler.transformSync(input, "js");

    // JSON import attributes should be preserved (web standard)
    expect(result).toContain('with { type: "json" }');
    expect(result).toContain('import data from "./data.json" with { type: "json" };');
  });

  test("Bun-specific import attributes should not be preserved in transpiler", () => {
    const transpiler = new Bun.Transpiler({ loader: "js" });

    const input = `import data from "./data.toml" with { type: "toml" };
console.log(data);`;

    const result = transpiler.transformSync(input, "js");

    // TOML imports are Bun-specific and should not be preserved in transpiler mode
    expect(result).not.toContain('with { type: "toml" }');
    expect(result).toContain('import data from "./data.toml";');
  });

  test("Multiple standard import attributes work correctly", () => {
    const transpiler = new Bun.Transpiler({ loader: "js" });

    const input = `import styles from "./styles.css" with { type: "css" };
import config from "./config.json" with { type: "json" };
import utils from "./utils.toml" with { type: "toml" };
document.adoptedStyleSheets = [styles];
console.log(config, utils);`;

    const result = transpiler.transformSync(input, "js");

    // Standard attributes preserved
    expect(result).toContain('with { type: "css" }');
    expect(result).toContain('with { type: "json" }');

    // Bun-specific attributes stripped
    expect(result).not.toContain('with { type: "toml" }');

    // All imports still present
    expect(result).toContain('import styles from "./styles.css"');
    expect(result).toContain('import config from "./config.json"');
    expect(result).toContain('import utils from "./utils.toml"');
  });
});
