import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The simplifier used to fold `![array]`, `!{obj}`, `typeof [array]`, etc. to a
// constant while discarding side effects inside the literal. It also inlined
// `Enum?.["A"]` to the member's constant value, dropping the optional chain.

describe("simplifier preserves side effects inside literals", () => {
  function transform(code: string): string {
    return new Bun.Transpiler({ loader: "js" }).transformSync(code);
  }

  function transformMin(code: string): string {
    return new Bun.Transpiler({ loader: "js", minify: { syntax: true } }).transformSync(code);
  }

  for (const min of [false, true]) {
    const label = min ? " (minify)" : "";
    const tx = min ? transformMin : transform;

    test(`![sideEffect()] keeps the call${label}`, () => {
      expect(tx("const r = ![sideEffect()];")).toContain("sideEffect()");
    });

    test(`!{x: sideEffect()} keeps the call${label}`, () => {
      expect(tx("const r = !{ x: sideEffect() };")).toContain("sideEffect()");
    });

    test(`!(class { static x = sideEffect(); }) keeps the call${label}`, () => {
      expect(tx("const r = !(class { static x = sideEffect(); });")).toContain("sideEffect()");
    });

    test(`!void sideEffect() keeps the call${label}`, () => {
      expect(tx("const r = !void sideEffect();")).toContain("sideEffect()");
    });

    test(`!![sideEffect()] keeps the call${label}`, () => {
      expect(tx("const r = !![sideEffect()];")).toContain("sideEffect()");
    });

    test(`typeof [sideEffect()] keeps the call${label}`, () => {
      expect(tx("const r = typeof [sideEffect()];")).toContain("sideEffect()");
    });

    test(`typeof {x: sideEffect()} keeps the call${label}`, () => {
      expect(tx("const r = typeof { x: sideEffect() };")).toContain("sideEffect()");
    });

    test(`typeof class { static x = sideEffect(); } keeps the call${label}`, () => {
      expect(tx("const r = typeof class { static x = sideEffect(); };")).toContain("sideEffect()");
    });

    test(`typeof [sideEffect()] === 'object' keeps the call${label}`, () => {
      expect(tx("const r = typeof [sideEffect()] === 'object';")).toContain("sideEffect()");
    });
  }

  test("pure literals still fold under !", () => {
    expect(transform("export const r = !null;").trim()).toBe("export const r = true;");
    expect(transform("export const r = !undefined;").trim()).toBe("export const r = true;");
    expect(transform("export const r = !0;").trim()).toBe("export const r = true;");
    expect(transform('export const r = !"x";').trim()).toBe("export const r = false;");
    expect(transform("export const r = !function(){};").trim()).toBe("export const r = false;");
  });

  test("typeof pure primitives still fold", () => {
    expect(transform("export const r = typeof null;").trim()).toBe('export const r = "object";');
    expect(transform("export const r = typeof 123;").trim()).toBe('export const r = "number";');
    expect(transform("export const r = typeof (() => {});").trim()).toBe('export const r = "function";');
  });

  test("side effects inside ![...] run at runtime", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `let n = 0; const fx = () => { n++; return 1 }; ` +
          `const a = ![fx()]; const b = !{ x: fx() }; const c = typeof [fx()]; ` +
          `console.log(n, a, b, c);`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("3 false false object\n");
    expect(exitCode).toBe(0);
  });
});

describe("enum optional-chain index is not inlined", () => {
  const transpiler = new Bun.Transpiler({ loader: "ts" });

  test("Foo?.['A'] keeps the optional-chain access", () => {
    const out = transpiler.transformSync(`enum Foo { A }\nexport let y = Foo?.["A"];`);
    expect(out).toContain(`Foo?.["A"]`);
  });

  test("Foo?.['A']() keeps the optional-chain call", () => {
    const out = transpiler.transformSync(`enum Foo { A }\nexport let y = Foo?.["A"]();`);
    expect(out).toContain(`let y = Foo?.["A"]();`);
  });

  test("Foo['A'] without optional chain is still inlined", () => {
    const out = transpiler.transformSync(`enum Foo { A }\nexport let y = Foo["A"];`);
    expect(out).toMatch(/let y = 0\b/);
  });
});
