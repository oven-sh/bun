import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { expectLayers } from "./harness/layers";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// `spyOn(Uint8Array.prototype, "set")`: the object only inherits the member. What the test puts there stands in front of it for every Uint8Array and Buffer,
// and for nothing else. Compiled code has to find it: in the test file, behind declared types, and in a loop over values of no known type.
const app = {
  "app.ts": `
    export function fill(target: Uint8Array, source: number[]): number { target.set(source); return target[0]; }
    export function fillAny(target: any, source: number[], turns: number) { for (let i = 0; i < turns; i++) target.set(source); return target[0]; }
    export function part(bytes: Uint8Array): number { return bytes.subarray(1).length; }
    export function doubled(numbers: Float64Array): string { return numbers.map(x => x * 2).join(); }
    export function made(items: number[]): number { return Uint8Array.from(items).length; }
    export function total(bytes: Uint8Array): number { let sum = 0; for (let i = 0; i < bytes.length; i++) sum += bytes[i]; return sum; }
    export function owns(list: number[], key: string): boolean { return list.hasOwnProperty(key); }
    export function shown(map: Map<number, number>): string { return \`\${map}\` + String(map) + map.toString(); }`,
};
const imports = `
  import { expect, spyOn, test } from "bun:test";
  import { doubled, fill, fillAny, made, owns, part, shown, total } from "./app";`;

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  // A crash prints only there, and the comparison below would hide it.
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

async function expectCompiledToRunAsPlain(files: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("spy-inherited", files);
  const plain = await runTests(String(dir), ...flags);
  expect(plain.results.filter(result => result.startsWith("fail"))).toEqual([]);
  expect(plain.results).not.toEqual([]);
  expect(await runTests(String(dir), "--aot", ...flags)).toEqual(plain);
}

test("a spy under an inherited name records the calls of compiled code, and of nothing beside its chain", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "one.test.ts": `${imports}
      test("typed arrays", () => {
        const set = spyOn(Uint8Array.prototype, "set");
        console.log(fill(new Uint8Array(2), [7, 8]), fillAny(new Uint8Array(2), [5], 3), fillAny(Buffer.alloc(2), [4], 2), set.mock.calls.length);
        console.log(fillAny(new Int8Array(2), [3], 2), set.mock.calls.length, Object.hasOwn(Uint8Array.prototype, "set"));
        set.mockRestore();
        console.log(fill(new Uint8Array(2), [7, 8]), set.mock.calls.length);
        const subarray = spyOn(Uint8Array.prototype, "subarray"), map = spyOn(Float64Array.prototype, "map"), from = spyOn(Uint8Array, "from");
        console.log(part(new Uint8Array(3)), doubled(new Float64Array([1, 2])), made([1, 2, 3]));
        console.log(subarray.mock.calls.length, map.mock.calls.length, from.mock.calls.length);
        for (const spy of [subarray, map, from]) spy.mockRestore();
      });
      test("names of Object.prototype", () => {
        const owned = spyOn(Array.prototype, "hasOwnProperty"), text = spyOn(Map.prototype, "toString");
        console.log(owns([1], "0"), owns([1], "1"), shown(new Map()), owned.mock.calls.length, text.mock.calls.length);
        console.log(({}).hasOwnProperty("a"), String(new Set()), owned.mock.calls.length, text.mock.calls.length);
        owned.mockRestore(); text.mockRestore();
      });`,
  });
});

test("what stands in front of the member answers in its place, until it is taken away", async () => {
  await expectCompiledToRunAsPlain({
    ...app,
    "one.test.ts": `${imports}
      const uses = () => console.log(fill(new Uint8Array(2), [7]), fillAny(Buffer.alloc(2), [6], 1), part(new Uint8Array(3)), made([1, 2]), shown(new Map()));
      test("a mock, a store, a definition", () => {
        uses();
        const spies = [
          spyOn(Uint8Array.prototype, "set").mockImplementation(function (this: Uint8Array) { this[0] = 99; }),
          spyOn(Uint8Array.prototype, "subarray").mockReturnValue(new Uint8Array(9)),
          spyOn(Uint8Array, "from").mockReturnValue(new Uint8Array(8)),
          spyOn(Map.prototype, "toString").mockReturnValue("a map"),
        ];
        uses();
        for (const spy of spies) spy.mockRestore();
        uses();
        (Uint8Array.prototype as any).set = function (this: Uint8Array) { this[0] = 55; };
        Object.defineProperty(Map.prototype, "toString", { value: () => "defined", configurable: true });
        uses();
        delete (Uint8Array.prototype as any).set;
        delete (Map.prototype as any).toString;
        uses();
        Object.defineProperty(Uint8Array.prototype, "length", { get: () => 5, configurable: true });
        console.log(total(new Uint8Array([1, 2, 3])), total(Buffer.from([1, 2, 3])), new Int8Array(3).length);
        delete (Uint8Array.prototype as any).length;
        console.log(total(new Uint8Array([1, 2, 3])));
      });`,
  });
});

test("over layers", async () => {
  using dir = tempDir("spy-inherited", {
    ...app,
    "one.test.ts": `${imports}
      test("one", () => {
        const set = spyOn(Uint8Array.prototype, "set"), text = spyOn(Map.prototype, "toString");
        console.log("one", fill(new Uint8Array(2), [7, 8]), fillAny(Buffer.alloc(2), [4], 2), fillAny(new Int8Array(2), [3], 2), set.mock.calls.length, shown(new Map()), text.mock.calls.length);
        set.mockRestore(); text.mockRestore();
      });`,
    "two.test.ts": `${imports}
      test("two", () => { console.log("two", fill(new Uint8Array(2), [1, 2]), shown(new Map()), Object.hasOwn(Uint8Array.prototype, "set")); });`,
  });
  const linesOf = async (...flags: string[]) => {
    const environment = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm" };
    const { stderr, exitCode } = await run(
      [bunExe(), "test", "--timeout=60000", "--parallel=2", ...flags],
      String(dir),
      environment,
    );
    // A parallel run prints there what its test files log.
    return {
      lines: stderr
        .split("\n")
        .filter(line => /^(one|two) /.test(line))
        .sort(),
      exitCode,
      stderr,
    };
  };
  const { stderr: _, ...plain } = await linesOf();
  expect(plain.lines.length).toBe(2);
  // More source than fits the memory as one program: the run is built in layers.
  const { stderr, ...compiled } = await linesOf("--aot", "--aot-memory-limit=1KB");
  expectLayers(stderr);
  expect(compiled).toEqual(plain);
});

test("what is read without a lookup stays closed, and says so", async () => {
  using dir = tempDir("spy-inherited", {
    "one.test.ts": `
      import { expect, spyOn, test } from "bun:test";
      test("refused", () => {
        expect(() => { (Uint8Array.prototype as any).next = () => 1; }).toThrow("a test can't add this one");
        expect(() => { (Uint8Array.prototype as any).then = () => 1; }).toThrow("a test can't add this one");
        expect(() => spyOn(Uint8Array.prototype as any, "constructor")).toThrow("a test can't replace this one");
        expect(() => spyOn(Array.prototype.push as any, "apply")).toThrow("'apply' of a built-in function");
      });`,
  });
  expect((await runTests(String(dir), "--aot")).results).toEqual(["pass refused"]);
});

// No spelling opens it there, so the message doesn't advise one.
test("in an executable the write throws as before", async () => {
  using dir = tempDir("spy-inherited", {
    "main.ts": `
      const holder: any = [Uint8Array.prototype][0];
      try { holder[["set"][0]] = () => 1; console.log("stored"); } catch (error) { console.log((error as Error).name, (error as Error).message.includes("Spell out")); }
      const bytes = new Uint8Array(1); bytes.set([5]); console.log(bytes[0]);`,
  });
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "main"],
    String(dir),
    bunEnv,
  );
  expect(built.exitCode).toBe(0);
  expect((await run(["./main"], String(dir), bunEnv)).stdout).toBe("TypeError false\n5\n");
});
