// The tests of Decimal that build executables. By the name of this file, CI builds a few at a time, and with the Bun that
// has no debug information (buildsManyExecutables in scripts/runner.node.ts).
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isHardened, locksEnvironment } from "../aot/hardened";
import { unsupported } from "../aot/harness/compiler";
import { raiseDefaultTimeout } from "../aot/harness/default-timeout";
import "../aot/harness/real-executables";
import { canTrim, getMappedSegments } from "./compile-trim-features";

raiseDefaultTimeout(120_000);

const env = { ...bunEnv, BUN_JSC_useDecimal: "1", NO_COLOR: "1" };
const { BUN_JSC_useDecimal: _, ...off } = env;

async function spawn(cmd: string[], cwd: string, variables: Record<string, string | undefined> = env) {
  await using proc = Bun.spawn({ cmd, cwd, env: variables, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const executable = isWindows ? "program.exe" : "program";

async function compile(flags: string[], cwd: string, variables: typeof off, entry = "main.js") {
  const cmd = [bunExe(), "build", "--compile", ...flags, entry, "--outfile", executable];
  const { stderr, exitCode } = await spawn(cmd, cwd, variables);
  expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
}

async function compileAndRun(
  flags: string[],
  sources: Record<string, string>,
  variables: typeof off,
  variablesOfRun: typeof off = off,
) {
  using dir = tempDir("decimal-executable", sources);
  await compile(flags, String(dir), variables);
  return await spawn([path.join(String(dir), executable)], String(dir), variablesOfRun);
}

// macOS is slow to start a new executable, also for the files that run beside this one. There what asks the compiler alone
// runs in place, and what asks it about --trim is left to the other systems.
async function runCompiled(sources: Record<string, string>, variables: typeof off, entry = "main.js") {
  using dir = tempDir("decimal-executable", sources);
  if (isMacOS) {
    const result = await spawn([bunExe(), "--debug-aot", entry], String(dir), variables);
    return { ...result, stderr: result.exitCode ? result.stderr : "" };
  }
  await compile(["--aot"], String(dir), variables, entry);
  return await spawn([path.join(String(dir), executable)], String(dir), off);
}
const asksWhatIsTrimmed = !unsupported && canTrim && !isMacOS;

describe.concurrent("an executable", () => {
  test("has Decimal without the variable", async () => {
    const sources = { "main.js": `console.log(new Decimal("0.1").add(new Decimal("0.2")).toString());` };
    const result = await compileAndRun(["--bytecode", "--format=esm"], sources, env);
    expect(result).toEqual({ stdout: "0.3\n", stderr: "", exitCode: 0 });
  });

  test("hands it on to an executable that it builds", async () => {
    const sources = {
      "main.js": `
        const outfile = process.cwd() + "/inner" + (process.platform === "win32" ? ".exe" : "");
        await Bun.build({ entrypoints: [process.cwd() + "/inner.js"], compile: { outfile, executablePath: ${JSON.stringify(bunExe())} } });
        console.write(Bun.spawnSync([outfile]).stdout);
      `,
      "inner.js": `console.log(typeof Decimal);`,
    };
    expect(await compileAndRun([], sources, env)).toEqual({ stdout: "function\n", stderr: "", exitCode: 0 });
  });

  test("leaves the last word to the variable", async () => {
    const sources = { "main.js": `console.log(typeof Decimal);` };
    const result = await compileAndRun([], sources, env, { ...off, BUN_JSC_useDecimal: "0" });
    expect(result).toEqual({ stdout: "undefined\n", stderr: "", exitCode: 0 });
  });

  test("that was built without it has none", async () => {
    const result = await compileAndRun(["--compile-jit-policy=2"], { "main.js": "console.log(typeof Decimal);" }, off);
    expect(result).toEqual({ stdout: "undefined\n", stderr: "", exitCode: 0 });
  });

  test.skipIf(!!unsupported).concurrent.each([
    ["an alias", `const D = Decimal; console.log(["1.50"].map(text => new D(text)).join());`],
    [
      "a method added",
      `Decimal.prototype.half = function () { return this.divide(new Decimal(2)); }; console.log(String(new Decimal(3).half()));`,
    ],
    [
      "an accessor handed over",
      `console.log(new Decimal("1.45").add(new Decimal("0.01")).toFixed({ get digits() { return 1; } }));`,
    ],
    ["a polyfill", `globalThis.Decimal ??= function () {}; console.log([1.5].map(x => new Decimal(x)).join());`],
  ])("--aot knows that the global is there: %s", async (_, source) => {
    expect(await runCompiled({ "main.js": source }, env)).toEqual({ stdout: "1.5\n", stderr: "", exitCode: 0 });
  });

  test.skipIf(!!unsupported).each([[[]], [["--aot-references", "wide"]], ...(canTrim ? [[["--trim"]]] : [])])(
    "--aot %j computes with Decimals in place, and calls what is none",
    async flags => {
      const source = `
        class Line {
          constructor(price, quantity) { this.price = price; this.quantity = quantity; }
          total() { return this.price.multiply(new Decimal(this.quantity)); }
        }
        function invoice(lines, parts) {
          let sum = new Decimal(0);
          const texts = [];
          for (const line of lines) {
            const total = line.total();
            sum = total.greaterThan(new Decimal(500)) ? sum.add(total.multiply(new Decimal(95)).divide(new Decimal(100)).round(2)) : sum.add(total);
            if (line.quantity === 9) texts.push(total.toFixed({ digits: 1 }), total.negate());
          }
          Bun.gc(true);
          return [sum, sum.divide(parts).round(2, "ceil"), texts.length, texts.at(-2), texts.at(-1)].join();
        }
        const lines = Array.from({ length: 20000 }, (_, i) => new Line(new Decimal((i * 7919 % 100003) + "e-2"), 1 + i % 9));
        console.log(invoice(lines, new Decimal(7)));
        class Free extends Decimal {}
        Object.assign(Free.prototype, { ["multi" + "ply"]: () => new Decimal(0) });
        console.log(invoice([new Line(new Free(5), 9)], new Decimal(1)));
        try { invoice(lines, 7); } catch (error) { console.log(error.name); }
        Reflect.set(Decimal.prototype, "round", () => new Decimal(1));
        console.log(invoice(lines.slice(0, 20), new Decimal(7)));
      `;
      const result = await compileAndRun(["--aot", ...flags], { "main.js": source }, env);
      expect(result).toEqual({
        stdout: [
          "47532015.16,6790287.88,4444,4634.5,-4634.46",
          "0,0,2,0.0,-0",
          "TypeError",
          "1221.11,1,4,3115.8,-3115.8",
          "",
        ].join("\n"),
        stderr: "",
        exitCode: 0,
      });
    },
  );

  test.skipIf(!!unsupported)("--aot leaves alone what was kept of a running total", async () => {
    const totals = `
        declare const Decimal: any;
        const step = new Decimal("1.25");
        function* sums(limit: number): Generator<number, number, any> {
          let sum = 0;
          for (let i = 0; i < limit; i++) sum += Number(yield sum) || 1;
          return sum;
        }
        function besideGenerator(held: any, total: any) {
          const kept: any[] = [];
          for (let round = 0; round < 4; round++) {
            kept.push(total);
            const it = sums(round);
            held.y = held.inner.z;
            while (true) {
              if (it.next(held.x++).done) break;
              total = total.add(step);
            }
          }
          return [...kept, total].join();
        }
        console.log(besideGenerator(JSON.parse('{"x":3,"y":2,"inner":{"z":3}}'), new Decimal(1)));
        console.log(besideGenerator({ x: 1, y: 2, inner: { z: 1 } }, new Decimal(2)));

        class Settings { static text = "ab".repeat(2); }
        function besideReads(at: number, total: any) {
          const kept: any[] = [], seen: number[] = [];
          for (let round = 0; round < 3; round++) {
            kept.push(total);
            for (let i = 0; i < 8; i++) {
              seen.push(Settings.text.length);
              if (i === at % 8) {
                total = total.add(step);
                "x".replace(/x/, () => (Settings.text = "b"));
              }
              seen.push(Settings.text.indexOf("b"));
            }
          }
          return [...kept, total].join() + " " + seen.slice(0, 6).join("");
        }
        const unseen: any = new Map([["read", besideReads]]);
        console.log(unseen.get("read")(1, new Decimal(3)));
      `;
    const sources = { "main.js": `import "./totals.ts";`, "totals.ts": totals };
    expect(await runCompiled(sources, env)).toEqual({
      stdout: "1,1,2.25,4.75,8.5\n2,2,3.25,5.75,9.5\n3,4.25,5.5,6.75 414010\n",
      stderr: "",
      exitCode: 0,
    });
  });

  const polyfilled = {
    "main.js": `
      const D = globalThis.Decimal ?? class { toString() { return "polyfill"; } };
      console.log(["1.50"].map(text => new D(text)).join(), Object.getOwnPropertyNames(globalThis).includes("Decimal"));
    `,
  };

  test.skipIf(!!unsupported || locksEnvironment).concurrent.each([
    ["add the global", off, env, "polyfill false\n"],
    ["take the global away", env, { ...off, BUN_JSC_useDecimal: "0" }, "1.5 true\n"],
  ])("--aot: the variable of the run does not %s", async (_, variables, variablesOfRun, stdout) => {
    const result = await compileAndRun(["--aot"], polyfilled, variables, variablesOfRun);
    expect(result).toEqual({ stdout, stderr: "", exitCode: 0 });
  });

  test
    .skipIf(!!unsupported)
    .concurrent.each([
      [{ BUN_JSC_USEDECIMAL: "1", ...off }, "1.5 true\n"],
      ...(isWindows ? [] : [[{ ...env, BUN_JSC_USEDECIMAL: "0" }, "1.5 true\n"] as const]),
      ...(isWindows ? [] : [[{ BUN_JSC_USEDECIMAL: "0", ...env }, "polyfill false\n"] as const]),
    ])("--aot takes the first variable of that name in any case, like the engine: %#", async (variables, stdout) => {
    expect(await runCompiled(polyfilled, variables)).toEqual({ stdout, stderr: "", exitCode: 0 });
  });

  test.skipIf(!!unsupported)("--aot declares the global for TypeScript, but not without the variable", async () => {
    const sources = { "main.ts": `console.log(String(new Decimal("1.50")));` };
    expect(await runCompiled(sources, env, "main.ts")).toEqual({ stdout: "1.5\n", stderr: "", exitCode: 0 });
    using dir = tempDir("decimal-executable", sources);
    const cmd = [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable];
    const { stderr, exitCode } = await spawn(cmd, String(dir), off);
    expect(stderr).toContain("Cannot find name 'Decimal'");
    expect(exitCode).toBe(1);
  });

  test.skipIf(!!unsupported || !canTrim)("--aot --trim keeps what toLocaleString() needs", async () => {
    const sources = { "main.js": `console.log(new Decimal("1234.5").toLocaleString("en-US"));` };
    const result = await compileAndRun(["--aot", "--trim"], sources, env);
    expect(result).toEqual({ stdout: "1,234.5\n", stderr: "", exitCode: 0 });
  });

  test.skipIf(!asksWhatIsTrimmed).concurrent.each([
    ["an array", `[new Decimal("1234.5")].toLocaleString("de")`],
    ["a subclass", `new (class extends Decimal { text() { return super.toLocaleString("de"); } })("1234.5").text()`],
  ])("--aot --trim keeps it for %s", async (_, expression) => {
    const result = await compileAndRun(["--aot", "--trim"], { "main.js": `console.log(${expression});` }, env);
    expect(result).toEqual({ stdout: "1.234,5\n", stderr: "", exitCode: 0 });
  });

  async function trimmed(source: string, variables: typeof off) {
    using dir = tempDir("decimal-executable", { "main.js": source });
    await compile(["--aot", "--trim"], String(dir), variables);
    const file = path.join(String(dir), executable);
    expect(await spawn([file], String(dir), off)).toEqual({ stdout: "1.5\n", stderr: "", exitCode: 0 });
    return getMappedSegments(readFileSync(file)).reduce((sum, segment) => sum + segment.length, 0);
  }

  test.skipIf(!asksWhatIsTrimmed).concurrent.each([
    ["class", `globalThis.NAME = class { constructor(text) { this.text = text; } };`],
    ["function", `globalThis.NAME ??= function (text) { "use strict"; this.text = text; };`],
  ])("--aot --trim without the variable removes as much beside a global %s of that name", async (_, definition) => {
    const source = definition + `console.log(new NAME("1.5").text);`;
    const [decimal, other] = await Promise.all(
      ["Decimal", "Decimax"].map(name => trimmed(source.replaceAll("NAME", name), off)),
    );
    expect(Math.abs(decimal - other)).toBeLessThan(65_536);
  });

  test.skipIf(!asksWhatIsTrimmed).concurrent.each([
    ["by its name", `console.log(new Decimal("0.5").add(new Decimal(1)).toFixed({ digits: 1 }));`],
    [
      "off a global object that was handed over",
      `function find() { return this; } const root = find.call(globalThis); console.log("Decimal" in root && String(new root.Decimal("1.5")));`,
    ],
  ])("--aot --trim keeps nothing of Bun for Decimal %s", async (_, source) => {
    const [decimal, text] = await Promise.all([trimmed(source, env), trimmed(`console.log("1.5");`, env)]);
    expect(decimal - text).toBeLessThan(1_000_000);
  });
});

test.skipIf(!!unsupported || isHardened).concurrent.each([
  ["function", env],
  ["undefined", off],
])(
  "a program that is compiled and run in place has the globals that it was compiled for: %s",
  async (expected, variables) => {
    using dir = tempDir("decimal-in-place", { "main.js": "console.log(typeof Decimal);" });
    const { stdout, exitCode } = await spawn([bunExe(), "--debug-aot", "main.js"], String(dir), variables);
    expect({ stdout, exitCode }).toEqual({ stdout: expected + "\n", exitCode: 0 });
  },
);

// The workers of --parallel find the values of .env in their environment, and the compiler did not.
test.skipIf(!!unsupported || isHardened).concurrent.each([
  ["function", env, ""],
  ["undefined", off, "BUN_JSC_useDecimal=1"],
])("bun test --aot has the globals that it compiled for: %s", async (expected, variables, dotEnv) => {
  const test = `
    import { expect, test } from "bun:test";
    test("typeof", () => expect(typeof Decimal).toBe("${expected}"));
  `;
  using dir = tempDir("decimal-test", { ".env": dotEnv, "a.test.js": test, "b.test.js": test });
  const { stderr, exitCode } = await spawn([bunExe(), "test", "--aot", "--parallel=2"], String(dir), variables);
  expect(stderr).toContain(" 2 pass");
  expect(exitCode).toBe(0);
});

test.concurrent.each([
  ["StructuredClone", "Operators", "1.5 TypeError 3"],
  ["ToJSON", "Operators", 'DataCloneError "1.5" 3'],
])("an executable keeps BUN_JSC_useDecimal%s and %s, and no other option", async (first, second, expected) => {
  const source = `
    const x = new Decimal("1.5");
    const outcome = f => { try { return String(f()); } catch (error) { return error.name; } };
    console.write([() => structuredClone(x), () => JSON.stringify(x), () => x + x].map(outcome).join(" "));
  `;
  const variables = { ...env, ["BUN_JSC_useDecimal" + first]: "1", ["BUN_JSC_useDecimal" + second]: "1" };
  const result = await compileAndRun(["--bytecode", "--format=esm"], { "main.js": source }, variables);
  expect(result).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
});

// Compiled code has no operators, so == would compare identity where bun run compares values.
test.skipIf(!!unsupported).concurrent.each([
  ["--aot", ["build", "--compile", "--aot", "main.js"]],
  ["bun compile", ["compile", "main.js"]],
  ["compile.aot", ["build.js"]],
])("%s refuses BUN_JSC_useDecimalOperators", async (subject, command) => {
  using dir = tempDir("decimal-executable", {
    "main.js": "console.log(new Decimal(1) == new Decimal(1));",
    "build.js": `await Bun.build({ entrypoints: ["main.js"], compile: { aot: true, outfile: "program" } });`,
  });
  const variables = { ...env, BUN_JSC_useDecimalOperators: "1" };
  const { stderr, exitCode } = await spawn([bunExe(), ...command], String(dir), variables);
  expect(stderr).toContain(`${subject} doesn't support BUN_JSC_useDecimalOperators`);
  expect(exitCode).toBe(1);
});

test.skipIf(!!unsupported || locksEnvironment).concurrent.each([
  ["ToJSON", "StructuredClone", 'DataCloneError "1.5" false false'],
  ["StructuredClone", "ToJSON", "1.5 TypeError false false"],
])("an --aot executable keeps %s, and takes neither %s nor Operators from the run", async (built, offered, stdout) => {
  const source = `
    const x = new Decimal("1.5");
    const outcome = f => { try { return String(f()); } catch (error) { return error.name; } };
    const equal = [() => x == new Decimal("1.5"), () => eval("new Decimal(1) == new Decimal(1)")];
    console.write([() => structuredClone(x), () => JSON.stringify(x), ...equal].map(outcome).join(" "));
  `;
  const result = await compileAndRun(
    ["--aot"],
    { "main.js": source },
    { ...env, ["BUN_JSC_useDecimal" + built]: "1" },
    {
      ...off,
      ["BUN_JSC_useDecimal" + built]: "0",
      ["BUN_JSC_useDecimal" + offered]: "1",
      BUN_JSC_useDecimalOperators: "1",
    },
  );
  expect(result).toEqual({ stdout, stderr: "", exitCode: 0 });
});

const literals = { ...env, BUN_JSC_useDecimalLiterals: "1" };

// With "bun run" and "bun build", which share the program.
describe.concurrent("literals", () => {
  const files = {
    "rate.cjs": `module.exports = { rate: .07m };`,
    "main.js": `
      import { rate } from "./rate.cjs";
      class Decimal {}
      const price = 19.99m, literal = () => 1m, negative = (sign = -1.50m) => sign;
      class Account { balance = -0m; static limit = 1_000m; }
      let total = 0m;
      for (let i = 0; i < 10; i++) total = total.add(0.1m);
      console.log([price.multiply(rate).round(2), total, negative(), - -1m, -(1m), (-1m).abs(), 1e6145m].join());
      console.log(1m.divide(new Account().balance).toString(), Account.limit.toString(), { [1.50m]: 1 }[1.5]);
      console.log(typeof 1m, typeof -1m, !0m, !-0m, -0m ? 1 : 2, 1m === 1m, literal() === literal(), price === price);
      console.log(-1m instanceof Decimal, -1m instanceof globalThis.Decimal, new Array(-1m).length);
      for (const f of [() => -1m.abs(), () => +1m, () => 1m + 1m, () => "a" + -1m, () => -price, () => 1m.nothing()]) {
        try {
          console.log(f());
        } catch (error) {
          console.log(error.name);
        }
      }
    `,
  };
  const printed = [
    "1.4,1,-1.5,1,-1,1,Infinity",
    "-Infinity 1000 1",
    "object object false false 1 false false true",
    "false true 1",
    ...Array(6).fill("TypeError"),
    "",
  ].join("\n");

  test("bun run", async () => {
    using dir = tempDir("decimal-literal", files);
    expect(await spawn([bunExe(), "main.js"], String(dir), literals)).toEqual({
      stdout: printed,
      stderr: "",
      exitCode: 0,
    });
  });

  test.each([[["--format=esm"]], [["--format=cjs"]], [["--minify"]], [["--format=cjs", "--bytecode"]]])(
    "bun build %j",
    async flags => {
      using dir = tempDir("decimal-literal", files);
      const built = await spawn(
        [bunExe(), "build", "--target=bun", "--outdir=out", ...flags, "main.js"],
        String(dir),
        literals,
      );
      expect(built.stderr).toBe("");
      expect(await spawn([bunExe(), "out/main.js"], String(dir), literals)).toEqual({
        stdout: printed,
        stderr: "",
        exitCode: 0,
      });
    },
  );

  test("an executable has them without the variables", async () => {
    const result = await compileAndRun(["--bytecode", "--format=esm"], files, literals);
    expect(result).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
  });

  test("also in what it loads from disk", async () => {
    const sources = {
      "main.js": `console.log(String(-1m), String((await import(process.cwd() + "/late.ts")).default));`,
      "late.ts": `export default 1.50m as unknown;`,
    };
    const result = await compileAndRun(["--compile-jit-policy=2"], sources, literals);
    expect(result).toEqual({ stdout: "-1 1.5\n", stderr: "", exitCode: 0 });
  });

  test.skipIf(!!unsupported)("--aot", async () => {
    expect(await runCompiled(files, literals)).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
  });

  test.skipIf(!!unsupported || !canTrim)("--aot --trim", async () => {
    const sources = { "main.js": `console.log(1234.5m.toLocaleString("en-US"), -0.125m.round(2).toString());` };
    const result = await compileAndRun(["--aot", "--trim"], sources, literals);
    expect(result).toEqual({ stdout: "1,234.5 -0.12\n", stderr: "", exitCode: 0 });
  });
});
