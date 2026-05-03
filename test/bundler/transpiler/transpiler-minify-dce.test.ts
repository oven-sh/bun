import { describe, expect, test } from "bun:test";

describe("Bun.Transpiler", () => {
  describe("minifySyntax as top-level option", () => {
    test("if (false) is eliminated", () => {
      const t = new Bun.Transpiler({ minifySyntax: true, minifyWhitespace: true });
      expect(t.transformSync("if (false) { console.log('dead'); } console.log('alive');").trim()).toBe(
        'console.log("alive");',
      );
    });

    test("string === string comparison is folded and DCE'd", () => {
      const t = new Bun.Transpiler({ minifySyntax: true, minifyWhitespace: true });
      expect(t.transformSync('if ("a" === "b") { console.log("dead"); } console.log("alive");').trim()).toBe(
        'console.log("alive");',
      );
    });

    test("string === string in function with return", () => {
      const t = new Bun.Transpiler({ minifySyntax: true, minifyWhitespace: true });
      expect(t.transformSync('function f() { if ("a" === "b") return true; return false; }').trim()).toBe(
        "function f(){return!1}",
      );
    });

    test("boolean literals are minified", () => {
      const t = new Bun.Transpiler({ minifySyntax: true, minifyWhitespace: true });
      expect(t.transformSync("const x = true;").trim()).toBe("const x=!0;");
    });

    test("constant folding works", () => {
      const t = new Bun.Transpiler({ minifySyntax: true, minifyWhitespace: true });
      expect(t.transformSync("const x = 1 + 2;").trim()).toBe("const x=3;");
    });

    test("if (true) body is kept, wrapper removed", () => {
      const t = new Bun.Transpiler({ minifySyntax: true, minifyWhitespace: true });
      expect(t.transformSync('if (true) { console.log("alive"); }').trim()).toBe('console.log("alive");');
    });
  });

  describe("minifyIdentifiers as top-level option", () => {
    test("identifiers are minified", () => {
      const t = new Bun.Transpiler({ minifyIdentifiers: true });
      const result = t.transformSync("const longVariableName = 1; console.log(longVariableName);");
      expect(result).not.toContain("longVariableName");
    });
  });

  describe("minify: { syntax: true } still works", () => {
    test("if (false) is eliminated", () => {
      const t = new Bun.Transpiler({ minify: { syntax: true, whitespace: true } });
      expect(t.transformSync("if (false) { console.log('dead'); } console.log('alive');").trim()).toBe(
        'console.log("alive");',
      );
    });
  });
});

describe("cross-type strict equality folding", () => {
  test("number === string folds to false", () => {
    const t = new Bun.Transpiler({ minify: { syntax: true, whitespace: true } });
    const result = t.transformSync('if (42 === "b") console.log("DEAD"); console.log("alive");').trim();
    expect(result).not.toContain("DEAD");
    expect(result).toContain("alive");
  });

  test("boolean === string folds to false", () => {
    const t = new Bun.Transpiler({ minify: { syntax: true, whitespace: true } });
    const result = t.transformSync('if (true === "b") console.log("DEAD"); console.log("alive");').trim();
    expect(result).not.toContain("DEAD");
    expect(result).toContain("alive");
  });

  test("string === boolean folds to false", () => {
    const t = new Bun.Transpiler({ minify: { syntax: true, whitespace: true } });
    const result = t.transformSync('if ("a" === true) console.log("DEAD"); console.log("alive");').trim();
    expect(result).not.toContain("DEAD");
    expect(result).toContain("alive");
  });

  test("number !== string folds to true", () => {
    const t = new Bun.Transpiler({ minify: { syntax: true, whitespace: true } });
    const result = t.transformSync('if (42 !== "b") console.log("ALIVE");').trim();
    expect(result).toContain("ALIVE");
    expect(result).not.toContain("!==");
  });
});

describe("top-level flags override composite minify", () => {
  test("minify: true + minifyIdentifiers: false keeps identifiers", () => {
    const t = new Bun.Transpiler({ minify: true, minifyIdentifiers: false });
    const result = t.transformSync("const longVariableName = 1; console.log(longVariableName);");
    expect(result).toContain("longVariableName");
  });

  test("minify: true + minifySyntax: false skips syntax minification", () => {
    const t = new Bun.Transpiler({ minify: true, minifySyntax: false });
    const result = t.transformSync("const x = true;");
    expect(result).toContain("true");
    expect(result).not.toContain("!0");
  });
});
