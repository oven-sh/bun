import { describe, expect, test } from "bun:test";

// Tests for WebAssembly import attributes support
// Ensures bun supports standard "webassembly" import attributes per ES spec
describe("WebAssembly import attributes support", () => {
  test("WebAssembly import attributes should be preserved", () => {
    const transpiler = new Bun.Transpiler({ loader: "js" });

    const input = `import module from "./module.wasm" with { type: "webassembly" };
console.log(module);`;

    const result = transpiler.transformSync(input, "js");

    // WebAssembly import attributes should be preserved (web standard)
    expect(result).toContain('with { type: "webassembly" }');
    expect(result).toContain('import module from "./module.wasm" with { type: "webassembly" };');
  });

  test("Legacy 'wasm' type should still work but output standard 'webassembly'", () => {
    const transpiler = new Bun.Transpiler({ loader: "js" });

    const input = `import module from "./module.wasm" with { type: "wasm" };
console.log(module);`;

    const result = transpiler.transformSync(input, "js");

    // Should normalize to standard webassembly attribute
    expect(result).toContain('with { type: "webassembly" }');
    expect(result).not.toContain('with { type: "wasm" }');
  });

  test("WebAssembly with other web standard attributes", () => {
    const transpiler = new Bun.Transpiler({ loader: "js" });

    const input = `import styles from "./styles.css" with { type: "css" };
import config from "./config.json" with { type: "json" };
import wasmModule from "./module.wasm" with { type: "webassembly" };
document.adoptedStyleSheets = [styles];
console.log(config, wasmModule);`;

    const result = transpiler.transformSync(input, "js");

    // All web standard attributes preserved
    expect(result).toContain('with { type: "css" }');
    expect(result).toContain('with { type: "json" }');
    expect(result).toContain('with { type: "webassembly" }');

    // All imports still present
    expect(result).toContain('import styles from "./styles.css"');
    expect(result).toContain('import config from "./config.json"');
    expect(result).toContain('import wasmModule from "./module.wasm"');
  });

  test("WebAssembly vs Bun-specific attributes behavior", () => {
    const transpiler = new Bun.Transpiler({ loader: "js" });

    const input = `import wasmModule from "./module.wasm" with { type: "webassembly" };
import data from "./data.toml" with { type: "toml" };
console.log(wasmModule, data);`;

    const result = transpiler.transformSync(input, "js");

    // WebAssembly is web standard - should be preserved
    expect(result).toContain('with { type: "webassembly" }');
    // TOML is Bun-specific - should be stripped in transpiler mode
    expect(result).not.toContain('with { type: "toml" }');

    // Both imports still present
    expect(result).toContain('import wasmModule from "./module.wasm"');
    expect(result).toContain('import data from "./data.toml"');
  });

  test("Multiple WebAssembly imports work correctly", () => {
    const transpiler = new Bun.Transpiler({ loader: "js" });

    const input = `import mathModule from "./math.wasm" with { type: "webassembly" };
import cryptoModule from "./crypto.wasm" with { type: "webassembly" };
import imageModule from "./image.wasm" with { type: "webassembly" };
console.log(mathModule, cryptoModule, imageModule);`;

    const result = transpiler.transformSync(input, "js");

    // All WebAssembly imports should preserve attributes
    const wasmMatches = result.match(/with \{ type: "webassembly" \}/g);
    expect(wasmMatches).toHaveLength(3);

    expect(result).toContain('import mathModule from "./math.wasm" with { type: "webassembly" };');
    expect(result).toContain('import cryptoModule from "./crypto.wasm" with { type: "webassembly" };');
    expect(result).toContain('import imageModule from "./image.wasm" with { type: "webassembly" };');
  });
});