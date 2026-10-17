import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Ordinary Bun, with the JIT, that behaves as the executable of `bun build --compile --aot` does: the type check comes first, values are held to
// their types, `as` converts, built-in objects are immutable.
const flags = ["--aot"];
const note = " (bun --aot: https://bun.com/docs/bundler/executables#ahead-of-time-compilation)";

async function ran(files: Record<string, string>, args: string[]) {
  using dir = tempDir("run-aot-jit", {
    "tsconfig.json": `{ "compilerOptions": { "strict": true, "target": "ESNext", "module": "Preserve", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "noEmit": true } }`,
    ...files,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: String(dir),
    env: { ...bunEnv, BUN_AOT_VERBOSE: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}
const run = (text: string) =>
  ran({ "main.ts": `declare const console: { log(...values: unknown[]): void };\n` + text }, [
    "run",
    ...flags,
    "main.ts",
  ]);
const attempt = (statement: string) => `try { ${statement} } catch (e) { console.log(String(e)); }`;

describe("before the program starts", () => {
  test("a type error ends the process and nothing runs", async () => {
    const { stdout, stderr, exitCode } = await run(
      `console.log("ran"); const port: number = "8080"; console.log(port);`,
    );
    expect(stderr).toContain("TS2322");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });
  test("--define and --feature behave as in bun build", async () => {
    const files = {
      "main.ts": `
        import { feature } from "bun:bundle";
        declare const LIMIT: number;
        function wrong(n: number): number { return n; }
        if (feature("EXTRA")) console.log("extra", LIMIT + 1);
        else console.log(wrong("never checked, never run"));`,
    };
    const { stdout, stderr, exitCode } = await ran(files, [
      "run",
      ...flags,
      "--define",
      "LIMIT=41",
      "--feature=EXTRA",
      "main.ts",
    ]);
    expect({ stdout, stderr: stderr.includes("TS2345"), exitCode }).toEqual({
      stdout: "extra 42\n",
      stderr: false,
      exitCode: 0,
    });
    const without = await ran(files, ["run", ...flags, "--define", "LIMIT=41", "main.ts"]);
    expect({ stderr: without.stderr.includes("TS2345"), exitCode: without.exitCode }).toEqual({
      stderr: true,
      exitCode: 1,
    });
  });
  test("code that always throws under --aot is a compile error", async () => {
    const { stdout, stderr, exitCode } = await run(
      `console.log("ran"); function double(n: number) { return n * 2; } console.log(double("4" as any));`,
    );
    expect(stderr).toContain("TS100013");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });
});

describe("type-check cache", () => {
  const files = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, allowImportingTsExtensions: true, noEmit: true },
    }),
    "main.ts": `import { twice } from "./lib.ts"; const given: any = JSON.parse('"4"'); try { console.log(twice(given)); } catch (e) { console.log(String(e).split(" (bun")[0]); }`,
    "lib.ts": `export function twice(n: number): number { return n * 2; }`,
  };
  async function started(cwd: string, cache: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", ...flags, "main.ts"],
      cwd,
      env: { ...bunEnv, BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    said = stderr;
    return { stdout, errors: stderr.split("\n").filter(line => line.includes("error TS")).length, exitCode };
  }
  let said = "";
  const kept = (cache: string) =>
    existsSync(join(cache, "@aot@")) ? readdirSync(join(cache, "@aot@")).filter(name => name.endsWith(".look")) : [];
  const refused = { stdout: 'TypeError: expected number, got string "4"\n', errors: 0, exitCode: 0 };

  test("the second run hits the cache and behaves the same", async () => {
    using dir = tempDir("aot-kept-look", files);
    using cache = tempDir("aot-kept-look-cache", {});
    expect(await started(String(dir), String(cache))).toEqual(refused);
    expect(kept(String(cache)).length).toBe(1);
    expect(await started(String(dir), String(cache))).toEqual(refused);
  });
  test("a cached run repeats the warnings", async () => {
    using dir = tempDir("aot-kept-look", {
      ...files,
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, allowImportingTsExtensions: true, noEmit: true, types: ["bun-types"] },
      }),
    });
    using cache = tempDir("aot-kept-look-cache", {});
    expect(await started(String(dir), String(cache))).toEqual(refused);
    const first = said;
    expect(first).toContain("TS2688");
    expect(kept(String(cache)).length).toBe(1);
    expect(await started(String(dir), String(cache))).toEqual(refused);
    expect(said).toBe(first);
  });
  test("a new file that shadows a resolved import invalidates the cache", async () => {
    using dir = tempDir("aot-kept-look", {
      "tsconfig.json": files["tsconfig.json"],
      "main.ts": files["main.ts"].replace("./lib.ts", "./lib"),
      "lib/index.ts": files["lib.ts"],
    });
    using cache = tempDir("aot-kept-look-cache", {});
    expect(await started(String(dir), String(cache))).toEqual(refused);
    expect(await started(String(dir), String(cache))).toEqual(refused);
    writeFileSync(join(String(dir), "lib.ts"), `export function twice(n: string): string { return n + n; }`);
    expect(await started(String(dir), String(cache))).toEqual({ stdout: "44\n", errors: 0, exitCode: 0 });
  });
  test("changes to a source file, a .d.ts file or tsconfig.json invalidate the cache", async () => {
    using dir = tempDir("aot-kept-look", files);
    using cache = tempDir("aot-kept-look-cache", {});
    expect(await started(String(dir), String(cache))).toEqual(refused);
    writeFileSync(join(String(dir), "lib.ts"), `export function twice(n: string): string { return n + n; }`);
    expect(await started(String(dir), String(cache))).toEqual({ stdout: "44\n", errors: 0, exitCode: 0 });
    writeFileSync(
      join(String(dir), "lib.ts"),
      `export function twice(n: number): number { const wrong: number = "text"; return n * 2; }`,
    );
    expect(await started(String(dir), String(cache))).toEqual({ stdout: "", errors: 1, exitCode: 1 });
    expect(await started(String(dir), String(cache))).toEqual({ stdout: "", errors: 1, exitCode: 1 });
    writeFileSync(join(String(dir), "lib.ts"), files["lib.ts"]);
    expect(await started(String(dir), String(cache))).toEqual(refused);
    writeFileSync(
      join(String(dir), "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, allowImportingTsExtensions: true, noEmit: true, noUnusedLocals: true },
      }),
    );
    writeFileSync(join(String(dir), "main.ts"), files["main.ts"]);
    expect((await started(String(dir), String(cache))).exitCode).toBe(0);
    writeFileSync(join(String(dir), "main.ts"), `const unused = 1; ` + files["main.ts"]);
    expect(await started(String(dir), String(cache))).toEqual({ stdout: "", errors: 1, exitCode: 1 });
  });
  test("a truncated entry, an entry with another key and an empty cache directory are misses", async () => {
    using dir = tempDir("aot-kept-look", files);
    using cache = tempDir("aot-kept-look-cache", {});
    expect(await started(String(dir), String(cache))).toEqual(refused);
    const [name] = kept(String(cache));
    const path = join(String(cache), "@aot@", name);
    const whole = readFileSync(path);
    writeFileSync(path, whole.subarray(0, whole.length >> 1));
    expect(await started(String(dir), String(cache))).toEqual(refused);
    const flipped = Buffer.from(readFileSync(path));
    flipped[flipped.length - 9] ^= 1;
    writeFileSync(path, flipped);
    expect(await started(String(dir), String(cache))).toEqual(refused);
    rmSync(join(String(cache), "@aot@"), { recursive: true });
    expect(await started(String(dir), String(cache))).toEqual(refused);
    expect(kept(String(cache)).length).toBe(1);
  });
  test("--watch: a type error stops the program and fixing it restarts the program", async () => {
    using dir = tempDir("aot-kept-look", {
      "tsconfig.json": files["tsconfig.json"],
      "main.ts": `import type { Size } from "./size.ts"; const size: Size = 1; console.log("ran", size);`,
      "size.ts": `export type Size = number;`,
    });
    using cache = tempDir("aot-kept-look-cache", {});
    for (const turn of ["full check", "a start on what was kept"]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--watch", ...flags, "main.ts"],
        cwd: String(dir),
        env: { ...bunEnv, BUN_RUNTIME_TRANSPILER_CACHE_PATH: String(cache) },
        stdout: "pipe",
        stderr: "pipe",
      });
      const printed = { stdout: "", stderr: "" };
      const read = async (name: "stdout" | "stderr") => {
        for await (const chunk of proc[name]) printed[name] += new TextDecoder().decode(chunk);
      };
      const all = Promise.all([read("stdout"), read("stderr")]);
      const until = async (holds: () => boolean) => {
        while (!holds()) {
          if (proc.exitCode !== null) throw new Error(turn + ": it ended: " + JSON.stringify(printed));
          await Bun.sleep(5);
        }
      };
      await until(() => printed.stdout.includes("ran 1"));
      expect(kept(String(cache)).length).toBe(1);
      writeFileSync(join(String(dir), "size.ts"), `export type Size = string;`);
      await until(() => printed.stderr.includes("error TS2322"));
      expect(printed.stdout.split("ran 1").length).toBe(2);
      writeFileSync(join(String(dir), "size.ts"), `export type Size = number;`);
      await until(() => printed.stdout.split("ran 1").length === 3);
      proc.kill();
      await all;
    }
  });
  test("editing a file the program does not import keeps the cache unless it adds `declare global`", async () => {
    using dir = tempDir("aot-kept-look", {
      ...files,
      "tsconfig.json": JSON.stringify({ ...JSON.parse(files["tsconfig.json"]), include: ["*.ts"] }),
      "beside.ts": `export const beside = 1;`,
    });
    using cache = tempDir("aot-kept-look-cache", {});
    const written = () => statSync(join(String(cache), "@aot@", kept(String(cache))[0])).mtimeMs;
    expect(await started(String(dir), String(cache))).toEqual(refused);
    const first = written();
    writeFileSync(join(String(dir), "beside.ts"), `export const beside = 2; const wrong: number = "text";`);
    expect(await started(String(dir), String(cache))).toEqual(refused);
    expect(written()).toBe(first);
    writeFileSync(
      join(String(dir), "beside.ts"),
      `export const beside = 3; declare global { interface Number { added: number } }`,
    );
    expect(await started(String(dir), String(cache))).toEqual(refused);
    expect(written()).toBeGreaterThan(first);
  });
  test("creating or deleting non-source files keeps the cache unless the program imports them", async () => {
    using dir = tempDir("aot-kept-look", {
      ...files,
      "main.ts": `// @ts-ignore\nimport note from "./note.txt";\nconsole.log(note); ` + files["main.ts"],
      "note.txt": "first",
    });
    using cache = tempDir("aot-kept-look-cache", {});
    const written = () => statSync(join(String(cache), "@aot@", kept(String(cache))[0])).mtimeMs;
    expect(await started(String(dir), String(cache))).toEqual({ ...refused, stdout: "first\n" + refused.stdout });
    const first = written();
    writeFileSync(join(String(dir), "app.db"), "a database");
    writeFileSync(join(String(dir), ".main.ts.swp"), "a swap file");
    expect(await started(String(dir), String(cache))).toEqual({ ...refused, stdout: "first\n" + refused.stdout });
    rmSync(join(String(dir), "app.db"));
    expect(await started(String(dir), String(cache))).toEqual({ ...refused, stdout: "first\n" + refused.stdout });
    expect(written()).toBe(first);
    rmSync(join(String(dir), "note.txt"));
    expect((await started(String(dir), String(cache))).exitCode).toBe(1);
    writeFileSync(join(String(dir), "note.txt"), "second");
    writeFileSync(join(String(dir), "more.ts"), "export {};");
    expect(await started(String(dir), String(cache))).toEqual({ ...refused, stdout: "second\n" + refused.stdout });
    expect(written()).toBeGreaterThan(first);
  });
  test("a full check seeded with the previous dependency file list produces the same tables as an unseeded one", async () => {
    const manifest = (name: string) => JSON.stringify({ name, version: "1.0.0", main: "index.ts", types: "index.ts" });
    const one = (name: string) =>
      `import { ${name} } from "${name}"; export function one(n: any): number { return ${name}(n); }`;
    const other = (name: string) =>
      `console.log("${name} is run"); export function ${name}(n: number): number { return n * 2; }`;
    using dir = tempDir("aot-kept-look", {
      "tsconfig.json": files["tsconfig.json"],
      "main.ts": `import { one } from "one"; const given: any = JSON.parse('"4"'); try { console.log(one(given)); } catch (e) { console.log(String(e).split(" (bun")[0]); }`,
      "node_modules/one/package.json": manifest("one"),
      "node_modules/one/index.ts": one("two"),
      "node_modules/two/package.json": manifest("two"),
      "node_modules/two/index.ts": other("two"),
      "node_modules/three/package.json": manifest("three"),
      "node_modules/three/index.ts": other("three"),
    });
    using cache = tempDir("aot-kept-look-cache", {});
    const tables = (cache: string) => {
      const file = readFileSync(join(cache, "@aot@", kept(cache)[0]));
      let at = 16;
      const number = () => Number(file.readBigUInt64LE((at += 8) - 8));
      const skip = () => {
        const length = number();
        at += length;
      };
      skip();
      for (let questions = number(); questions > 0; questions--) {
        at += 16;
        skip();
      }
      for (let declarationFiles = number(); declarationFiles > 0; declarationFiles--) {
        at += 8;
        skip();
        skip();
      }
      skip();
      return file.subarray(at).toString("hex");
    };
    expect(await started(String(dir), String(cache))).toEqual({ ...refused, stdout: "two is run\n" + refused.stdout });
    for (const name of ["three", "two"]) {
      writeFileSync(join(String(dir), "node_modules/one/index.ts"), one(name));
      using empty = tempDir("aot-kept-look-cache", {});
      const fromNothing = await started(String(dir), String(empty));
      expect(fromNothing).toEqual({ ...refused, stdout: name + " is run\n" + refused.stdout });
      expect(await started(String(dir), String(cache))).toEqual(fromNothing);
      expect(tables(String(cache))).toBe(tables(String(empty)));
    }
  });
  test("the cache is capped at 1 GiB: oldest entries and stale temporary files are evicted", async () => {
    using dir = tempDir("aot-kept-look", files);
    using cache = tempDir("aot-kept-look-cache", {
      "@aot@/oldest.look": "",
      "@aot@/older.look": "",
      "@aot@/00.look.left": "",
      "@aot@/01.look.fresh": "",
    });
    const at = (name: string) => join(String(cache), "@aot@", name);
    for (const [name, age] of [
      ["oldest.look", 7200],
      ["older.look", 3600],
      ["00.look.left", 3600],
    ] as const) {
      truncateSync(at(name), 600 << 20);
      utimesSync(at(name), Date.now() / 1000 - age, Date.now() / 1000 - age);
    }
    expect(await started(String(dir), String(cache))).toEqual(refused);
    expect(kept(String(cache)).length).toBe(2);
    expect(["oldest.look", "older.look", "00.look.left", "01.look.fresh"].map(name => existsSync(at(name)))).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });
  test("changes in ancestor directories keep the cache unless resolution looked them up", async () => {
    using above = tempDir("aot-kept-look", {
      "project/tsconfig.json": files["tsconfig.json"],
      "project/main.ts":
        `import { twice } from "../beside/lib.ts"; ` + files["main.ts"].slice(files["main.ts"].indexOf("const given")),
      "beside/lib.ts": files["lib.ts"],
    });
    using cache = tempDir("aot-kept-look-cache", {});
    const [dir, at] = [join(String(above), "project"), (name: string) => join(String(above), name)];
    const written = () => statSync(join(String(cache), "@aot@", kept(String(cache))[0])).mtimeMs;
    expect(await started(dir, String(cache))).toEqual(refused);
    const first = written();
    mkdirSync(at("another-project"));
    writeFileSync(at("notes"), "");
    writeFileSync(at("stray.ts"), "export {};");
    expect(await started(dir, String(cache))).toEqual(refused);
    rmSync(at("another-project"), { recursive: true });
    expect(await started(dir, String(cache))).toEqual(refused);
    expect(written()).toBe(first);
    mkdirSync(at("node_modules/@types/bun"), { recursive: true });
    expect(await started(dir, String(cache))).toEqual(refused);
    const second = written();
    expect(second).toBeGreaterThan(first);
    renameSync(at("beside"), at("moved"));
    expect((await started(dir, String(cache))).exitCode).toBe(1);
    renameSync(at("moved"), at("beside"));
    expect(await started(dir, String(cache))).toEqual(refused);
  });
  test("the cache is off when the transpiler cache is off", async () => {
    using dir = tempDir("aot-kept-look", files);
    expect(await started(String(dir), "0")).toEqual(refused);
    expect(await started(String(dir), "0")).toEqual(refused);
  });
});

describe("incremental type check", () => {
  const files = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, allowImportingTsExtensions: true, noEmit: true },
    }),
    "main.ts": `import { twice } from "./lib.ts"; const four: number = twice(2); const given: any = JSON.parse('"4"'); try { console.log(four, twice(given)); } catch (e) { console.log(four, String(e).split(" (bun")[0]); } import "./large.ts";`,
    "lib.ts": `export function twice(n: number) {\n  return n * 2;\n}\n`,
    "large.ts": "export {};\n// " + Buffer.alloc(1 << 20, "x").toString(),
  };
  const inside = (statement: string) => files["lib.ts"].replace("{\n", "{\n  " + statement + "\n");
  async function started(cwd: string, cache: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", ...flags, "main.ts"],
      cwd,
      env: { ...bunEnv, BUN_AOT_VERBOSE: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = stderr.split("\n");
    return {
      stdout,
      errors: lines.filter(line => line.includes("error TS")).map(line => line.split(":")[0]),
      roads: lines
        .filter(line => line.startsWith("[aot] type check: "))
        .map(line => line.slice(18).replace(/\d+ ms/, "some ms")),
      exitCode,
    };
  }
  const refused = 'TypeError: expected number, got string "4"';
  const short = "incremental check: 1 changed, exported types unchanged";

  test("an edit that keeps exported types checks only the changed file", async () => {
    using dir = tempDir("aot-after-an-edit", files);
    using cache = tempDir("aot-after-an-edit-cache", {});
    expect(await started(String(dir), String(cache))).toEqual({
      stdout: `4 ${refused}\n`,
      errors: [],
      roads: ["full check"],
      exitCode: 0,
    });
    writeFileSync(join(String(dir), "lib.ts"), inside("const more = 1; void more;"));
    const next = await started(String(dir), String(cache));
    expect({ ...next, roads: next.roads[0] }).toEqual({
      stdout: `4 ${refused}\n`,
      errors: [],
      roads: short,
      exitCode: 0,
    });
    let later = await started(String(dir), String(cache));
    while (later.roads[0] === short) later = await started(String(dir), String(cache));
    expect(later).toEqual({ stdout: `4 ${refused}\n`, errors: [], roads: ["cache hit"], exitCode: 0 });
  });
  test("a program under 1 MiB always gets a full check", async () => {
    using dir = tempDir("aot-after-an-edit", { ...files, "large.ts": "export {};" });
    using cache = tempDir("aot-after-an-edit-cache", {});
    expect(await started(String(dir), String(cache))).toEqual({
      stdout: `4 ${refused}\n`,
      errors: [],
      roads: ["full check"],
      exitCode: 0,
    });
    expect((await started(String(dir), String(cache))).roads).toEqual(["cache hit"]);
    writeFileSync(join(String(dir), "lib.ts"), inside("const more = 1; void more;"));
    expect(await started(String(dir), String(cache))).toEqual({
      stdout: `4 ${refused}\n`,
      errors: [],
      roads: ["full check"],
      exitCode: 0,
    });
    expect((await started(String(dir), String(cache))).roads).toEqual(["cache hit"]);
  });
  test("a type error in the changed file is reported", async () => {
    using dir = tempDir("aot-after-an-edit", files);
    using cache = tempDir("aot-after-an-edit-cache", {});
    expect((await started(String(dir), String(cache))).roads).toEqual(["full check"]);
    writeFileSync(join(String(dir), "lib.ts"), inside(`const wrong: number = "text"; void wrong;`));
    expect(await started(String(dir), String(cache))).toEqual({
      stdout: "",
      errors: ["lib.ts(2,9)"],
      roads: ["type errors in changed files: falling back to a full check", "full check"],
      exitCode: 1,
    });
    writeFileSync(join(String(dir), "lib.ts"), files["lib.ts"]);
    expect((await started(String(dir), String(cache))).roads).toEqual(["cache hit"]);
  });
  test("a changed inferred return type triggers a full check", async () => {
    using dir = tempDir("aot-after-an-edit", files);
    using cache = tempDir("aot-after-an-edit-cache", {});
    expect((await started(String(dir), String(cache))).roads).toEqual(["full check"]);
    writeFileSync(join(String(dir), "lib.ts"), files["lib.ts"].replace("n * 2", "String(n * 2)"));
    expect(await started(String(dir), String(cache))).toEqual({
      stdout: "",
      errors: ["main.ts(1,41)"],
      roads: ["exported types changed: falling back to a full check", "full check"],
      exitCode: 1,
    });
  });
  test("two changed files are checked together and a new file triggers a full check", async () => {
    using dir = tempDir("aot-after-an-edit", files);
    using cache = tempDir("aot-after-an-edit-cache", {});
    expect((await started(String(dir), String(cache))).roads).toEqual(["full check"]);
    writeFileSync(join(String(dir), "lib.ts"), inside("const more = 1; void more;"));
    writeFileSync(join(String(dir), "main.ts"), files["main.ts"] + " void 0;");
    expect((await started(String(dir), String(cache))).roads[0]).toBe(
      "incremental check: 2 changed, exported types unchanged",
    );
    writeFileSync(join(String(dir), "other.ts"), "export {};");
    expect((await started(String(dir), String(cache))).roads).toEqual(["full check"]);
  });
});

describe("at run time", () => {
  test("TypeScript files of dependencies are type checked at any depth and a type-only import is not evaluated", async () => {
    const manifest = (name: string) => JSON.stringify({ name, version: "1.0.0", main: "index.ts", types: "index.ts" });
    const { stdout, exitCode } = await ran(
      {
        "main.ts": `import { one } from "one"; declare const console: { log(...values: unknown[]): void }; console.log(one(1)); ${attempt(`console.log(one(JSON.parse('"1"')));`)}`,
        "node_modules/one/package.json": manifest("one"),
        "node_modules/one/index.ts": `import { inner } from "./inner.ts"; import { two } from "two"; export function one(n: number): number { return inner(n) + two(n); }`,
        "node_modules/one/inner.ts": `export function inner(n: number): number { return n + 1; }`,
        "node_modules/two/package.json": manifest("two"),
        "node_modules/two/index.ts": `import { three } from "three"; import type { Only } from "only-types"; export function two(n: number): number { const only: Only = n; return three(only) * 2; }`,
        "node_modules/three/package.json": manifest("three"),
        "node_modules/three/index.ts": `export function three(n: number): number { return n * 3; }`,
        "node_modules/only-types/package.json": manifest("only-types"),
        "node_modules/only-types/index.ts": `export type Only = number; console.log("it is run");`,
      },
      ["run", ...flags, "main.ts"],
    );
    expect({ stdout, exitCode }).toEqual({
      stdout: `8\nTypeError: expected number, got string "1"${note}\n`,
      exitCode: 0,
    });
  });
  test("a module resolved only at run time runs unchecked", async () => {
    const { stdout, stderr, exitCode } = await ran(
      {
        "main.ts": `declare const console: { log(...values: unknown[]): void }; declare const process: { argv: string[] };
          const late = await import("./la" + (process.argv.length > 0 ? "te" : "") + ".ts");
          console.log(late.twice(JSON.parse('"4"')));`,
        "late.ts": `export function twice(n: number): number { return n * 2; }`,
      },
      ["run", ...flags, "main.ts"],
    );
    expect({
      stdout,
      stderr: stderr
        .split("\n")
        .filter(line => !line.startsWith("[aot] "))
        .join("\n"),
      exitCode,
    }).toEqual({ stdout: "8\n", stderr: "", exitCode: 0 });
  });
  test("what was got is named in the words of an executable", async () => {
    const { stdout, exitCode } = await run(
      `class Point { x = 1 }
      function args(..._: unknown[]): unknown { return (function (..._: unknown[]) { return arguments; })(1); }
      const given: (() => any)[] = [() => ({ a: 1 }), () => -0, () => Object.create({ a: 1 }), () => args(), () => new TypeError("t"), () => (function () {}).bind(null), () => (function* () {})(), () => class {}, () => Point, () => new Point(), () => new Map(), () => [1], () => JSON.parse("{}"), () => ({ title() {} }).title, () => Math.max];
      function take(v: any): unknown { const x: string = v; return x; }
      for (const make of given) { try { take(make()); } catch (e) { console.log(JSON.stringify(String(e).split(" (bun")[0].split("got ")[1])); } }`,
    );
    expect(stdout.split("\n")).toEqual(
      [
        "{ a }",
        "number 0",
        "untyped Object",
        "native Object",
        "native TypeError",
        "function",
        "native Generator",
        "class ",
        "class Point",
        "Point",
        "native Map",
        "Array",
        "untyped object",
        "function title",
        "function max",
      ]
        .map(words => JSON.stringify(words))
        .concat(""),
    );
    expect(exitCode).toBe(0);
  });
  test("a function is no Map, Set, Date, RegExp or typed array", async () => {
    const { stdout, exitCode } = await run(
      `const given: any[] = [() => 1, class {}, function () {}];
      function asMap(v: any): unknown { const x: Map<string, number> = v; return x; }
      function asDate(v: any): unknown { const x: Date = v; return x; }
      function asBytes(v: any): unknown { const x: Uint8Array = v; return x; }
      function asFunction(v: any): unknown { const x: Function = v; return x; }
      for (const take of [asMap, asDate, asBytes, asFunction]) for (const v of given) { try { console.log(take.name, typeof take(v)); } catch (e) { console.log(take.name, String(e).split(", got")[0]); } }`,
    );
    expect(stdout).toBe(
      [
        "asMap TypeError: expected Map",
        "asDate TypeError: expected Date",
        "asBytes TypeError: expected Uint8Array",
        "asFunction function",
      ]
        .map(line => (line + "\n").repeat(3))
        .join(""),
    );
    expect(exitCode).toBe(0);
  });
  test("a wrong argument to an async function rejects its promise and does not throw to the caller", async () => {
    const { stdout, exitCode } = await run(
      `async function size(list: number[]): Promise<number> { return list.length; }
      const arrow = async (list: number[]): Promise<number> => list.length;
      const untyped: any[] = [size, arrow];
      for (const f of untyped) { let promise: Promise<unknown>; try { promise = f(5); } catch { console.log("thrown to the caller"); continue; } await promise.then(() => console.log("fulfilled"), e => console.log("rejected", String(e).split(" (bun")[0])); }`,
    );
    expect(stdout).toBe("rejected TypeError: expected number[], got number 5\n".repeat(2));
    expect(exitCode).toBe(0);
  });
  test("an array of a great length with few elements is iterated at once, and one with a getter is still refused", async () => {
    const { stdout, exitCode } = await run(
      `const sparse: number[] = [1, 2, 3]; sparse[4294967294] = 4; let seen = 0; for (const value of sparse) { if (seen++ > 4) break; } console.log(seen, sparse.length);
      const turned: number[] = [1, 2, 3]; turned[4294967294] = 4; Object.defineProperty(turned, 1, { get() { return 5; } }); ${attempt("for (const value of turned) console.log(value);")}`,
    );
    expect(stdout.split("\n")[0]).toBe("6 4294967295");
    expect(stdout.split("\n")[1]).toStartWith(
      "TypeError: Cannot read array element: the array or its prototype chain has accessors or a Proxy",
    );
    expect(exitCode).toBe(0);
  });
  test("nothing is compiled ahead of time, and the JIT is on", async () => {
    const { stdout, stderr, exitCode } = await ran(
      {
        "main.ts": `import { numberOfDFGCompiles } from "bun:jsc"; function work(n: number) { let sum = 0; for (let i = 0; i < n; i++) sum = (sum + i) % 1000; return sum; } const until = Date.now() + 30000; let sum = 0; do sum = work(1e6); while (numberOfDFGCompiles(work) === 0 && Date.now() < until); console.log(sum, numberOfDFGCompiles(work) > 0);`,
      },
      ["run", ...flags, "main.ts"],
    );
    expect(stderr).not.toContain("[aot] module: ");
    expect({ stdout, exitCode }).toEqual({
      stdout: "0 true\n".replace(
        "0",
        String(
          (() => {
            let sum = 0;
            for (let i = 0; i < 1e6; i++) sum = (sum + i) % 1000;
            return sum;
          })(),
        ),
      ),
      exitCode: 0,
    });
  });
  test("a value that does not match its type throws where it enters", async () => {
    const { stdout, exitCode } = await run(`
      function double(n: number) { return n * 2; }
      const body: any = JSON.parse('{"visits":"3","name":5}');
      ${attempt(`console.log(double(body.visits));`)}
      ${attempt(`const name: string = body.name; console.log(typeof name);`)}
      function read(text: string): number { return JSON.parse(text); }
      ${attempt(`console.log(typeof read('"x"'));`)}
      console.log(double(JSON.parse("4")));`);
    expect(stdout.split("\n")).toEqual([
      `TypeError: expected number | undefined, got string "3"${note}`,
      `TypeError: expected string, got number 5${note}`,
      `TypeError: expected number, got string "x"${note}`,
      "8",
      "",
    ]);
    expect(exitCode).toBe(0);
  });
  test("an uncaught one names the place of the value", async () => {
    const { stderr, exitCode } = await run(
      `function double(n: number) { return n * 2; }\nconst body: any = JSON.parse('{"visits":"3"}');\nconsole.log(double(body.visits));`,
    );
    expect(stderr).toContain(`TypeError: expected number | undefined, got string "3"${note}`);
    expect(stderr).toContain("main.ts:4:20");
    expect(stderr).not.toContain("aot-audit");
    expect(exitCode).toBe(1);
  });
  test("`as` converts between primitive types, and the variable it reads stays what it was", async () => {
    const { stdout } = await run(`
      const query: any = JSON.parse('{"page":"2"}');
      console.log((query.page as number) + 1);
      const given: unknown = JSON.parse("5");
      console.log((given as string) + 1, typeof given);
      const zero: unknown = JSON.parse("0");
      const flag = zero as boolean;
      console.log(flag, typeof flag, zero);`);
    expect(stdout).toBe("3\n51 number\nfalse boolean 0\n");
  });
  test("`x!` checks nothing; `let x!: T` throws when it is read before it is set", async () => {
    const { stdout } = await run(`
      const names = new Map<string, string>();
      ${attempt(`const name: string = names.get("bob")!; console.log(name);`)}
      let size!: number;
      function read() { return size + 1; }
      ${attempt(`console.log(read());`)}`);
    expect(stdout).toBe(`undefined\nTypeError: non-null assertion failed: \`size\` is undefined${note}\n`);
  });
  test("an array type takes a real array only", async () => {
    const { stdout } = await run(`
      function first(list: number[]) { return list[0]; }
      const like: any = { 0: 7, length: 1 }, proxy: any = new Proxy([7], {});
      ${attempt(`console.log(first(like));`)}
      ${attempt(`console.log(first(proxy));`)}
      console.log(first([7]));`);
    expect(stdout).toBe(
      `TypeError: expected number[], got untyped object${note}\nTypeError: expected number[], got native ProxyObject${note}\n7\n`,
    );
  });
  test("built-in objects are immutable", async () => {
    const { stdout } = await ran(
      {
        "main.js": `
          const tried = f => { try { f(); return "done"; } catch (e) { return e.name; } };
          console.log(tried(() => { Array.prototype.push = () => 0; }), tried(() => { String.prototype.shout = () => ""; }), tried(() => { Object.prototype.extra = 1; }), tried(() => { Math.random = () => 0.5; }), tried(() => { globalThis.Promise = class {}; }));
          console.log(tried(() => { Math.half = x => x / 2; }), Math.half(4), Object.isFrozen(Array.prototype), ({}).extra);
          const log = console.log; console.log = (...values) => log("mine:", ...values); console.log("x");`,
      },
      ["run", ...flags, "main.js"],
    );
    expect(stdout).toBe("TypeError TypeError TypeError TypeError TypeError\ndone 2 true undefined\nmine: x\n");
  });
  test("a refused write to a built-in says that --aot is why, in sloppy code too", async () => {
    const { stdout } = await ran(
      {
        "main.cjs": `
          const tried = f => { try { f(); return "done"; } catch (e) { return String(e); } };
          console.log(tried(() => { Array.prototype.push = () => 0; }));
          console.log(tried(() => { Math.random = () => 0.5; }));
          console.log(tried(() => { Object.prototype.extra = 1; }));
          console.log(tried(() => { globalThis.Promise = class {}; }));
          console.log(tried(() => { Object.defineProperty(Object.freeze({ a: 1 }), "a", { value: 2 }); }));`,
      },
      ["run", ...flags, "main.cjs"],
    );
    expect(stdout.split("\n")).toEqual([
      `TypeError: Cannot change 'push' of Array.prototype: built-ins are locked in a program compiled with --aot${note}`,
      `TypeError: Cannot change 'random' of Math: built-ins are locked in a program compiled with --aot${note}`,
      `TypeError: Cannot change 'extra' of Object.prototype: built-ins are locked in a program compiled with --aot${note}`,
      `TypeError: Cannot change 'Promise' of globalThis: built-ins are locked in a program compiled with --aot${note}`,
      "TypeError: Attempting to change value of a readonly property.",
      "",
    ]);
  });
  test("a function reached through another function type runs as JavaScript says where an argument does not fit", async () => {
    const { stdout, exitCode } = await ran(
      {
        "main.ts": `
          function count(list: string[]): number { let n = 0; for (const s of list) n += s.length; return n; }
          const kept = [count] as unknown as ((s: string) => number)[];
          console.log(kept[0]("abc"), count(["ab", "c"]));`,
      },
      ["run", ...flags, "main.ts"],
    );
    expect({ stdout, exitCode }).toEqual({ stdout: "3 3\n", exitCode: 0 });
  });
  test("a property of undefined or null: the words of the executable", async () => {
    const { stdout } = await ran(
      {
        "main.js": `
          const tried = f => { try { return f(); } catch (e) { return String(e); } };
          const o = { a: null };
          console.log(tried(() => o.a.c));
          console.log(tried(() => o.b.length));
          console.log(tried(() => o.b.method()));
          console.log(tried(() => { o.a.c = 1; }));
          console.log(tried(() => { o.b.c = 1; }));`,
      },
      ["run", ...flags, "main.js"],
    );
    expect(stdout.split("\n")).toEqual([
      "TypeError: Cannot read properties of null (reading 'c')",
      "TypeError: Cannot read properties of undefined (reading 'length')",
      "TypeError: Cannot read properties of undefined (reading 'method')",
      "TypeError: Cannot set properties of null (setting 'c')",
      "TypeError: Cannot set properties of undefined (setting 'c')",
      "",
    ]);
  });
  test("a context made at run time has built-ins of its own, which are not locked", async () => {
    const { stdout } = await ran(
      {
        "main.js": `const vm = require("node:vm"); console.log(vm.runInNewContext("Array.prototype.extra = 1; [].extra"), [].extra);`,
      },
      ["run", ...flags, "main.js"],
    );
    expect(stdout).toBe("1 undefined\n");
  });
  test("what comes by the other arm of ||, ?. and a comma is as in plain Bun", async () => {
    const { stdout, exitCode } = await ran(
      {
        "main.ts": `
          const flags: Record<string, boolean> = { a: true };
          function either(k: string) { const found: boolean = flags[k] || flags[k + k]; return [found]; }
          class Account { constructor(public cents: number) {} get isEmpty(): boolean { return this.cents === 0; } }
          function isEmpty(a: Account | undefined): boolean | undefined { return a?.isEmpty; }
          const counter = { n: 0, bump() { return ++this.n; } };
          function tried(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } }
          console.log(either("z"), either("a"), isEmpty(undefined), isEmpty(new Account(0)), (counter.bump)(), tried(() => (0, counter.bump)()));`,
      },
      ["run", ...flags, "main.ts"],
    );
    expect({ stdout, exitCode }).toEqual({
      stdout: "[ undefined ] [ true ] undefined true 1 TypeError\n",
      exitCode: 0,
    });
  });
  test("a deep chain of tail calls whose results are held to a type runs in constant space, and the result is still held", async () => {
    const { stdout, exitCode } = await ran(
      {
        "main.ts": `
          const steps: Array<(n: number, sum: number) => number> = [];
          steps.push(function even(n: number, sum: number): number { return n === 0 ? sum : steps[1](n - 1, sum + 1); });
          steps.push(function odd(n: number, sum: number): number { return n === 0 ? sum : steps[0](...([n - 1, sum + 2] as [number, number])); });
          console.log(steps[0](400000, 0));
          const last: any = () => "text";
          function ends(n: number): number { return n === 0 ? last() : again[0](n - 1); }
          const again: Array<(n: number) => number> = [ends];
          try { console.log(ends(100000)); } catch (e) { console.log(String(e).split(" (bun")[0]); }`,
      },
      ["run", ...flags, "main.ts"],
    );
    expect({ stdout, exitCode }).toEqual({
      stdout: '600000\nTypeError: expected number, got string "text"\n',
      exitCode: 0,
    });
  });
  test("a deep tail recursion finishes, as it does in the executable", async () => {
    const { stdout } = await run(
      `function sum(n: number, total = 0): number { if (n === 0) return total; return sum(n - 1, total + n); } console.log(sum(1_000_000));`,
    );
    expect(stdout).toBe("500000500000\n");
  });
});

describe("bun test", () => {
  const price = {
    "price.ts": `export function price(id: string): number { return id.length; }\nexport const rate = { of(id: string): number { return id.length * 2; } };`,
  };
  test("mock.module replaces the exports of a module", async () => {
    const { stderr, exitCode } = await ran(
      {
        ...price,
        "one.test.ts": `import { expect, mock, test } from "bun:test";\nmock.module("./price.ts", () => ({ price: (id: string): number => 42, rate: { of: () => 1 } }));\ntest("mocked", async () => { const { price } = await import("./price.ts"); expect(price("abc")).toBe(42); });`,
      },
      ["test", ...flags, "one.test.ts"],
    );
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });
  test("spyOn replaces a method of an object of the program and gives it back", async () => {
    const { stderr, exitCode } = await ran(
      {
        ...price,
        "two.test.ts": `import { expect, spyOn, test } from "bun:test";\nimport { rate } from "./price.ts";\ntest("spied", () => { const spy = spyOn(rate, "of").mockReturnValue(7); expect(rate.of("abc")).toBe(7); expect(spy).toHaveBeenCalledWith("abc"); spy.mockRestore(); expect(rate.of("abc")).toBe(6); });`,
      },
      ["test", ...flags, "two.test.ts"],
    );
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });
  test("a mock function stands where a typed callback is wanted, and what it yields is held to the type", async () => {
    const { stderr, exitCode } = await ran(
      {
        "three.test.ts": `import { expect, jest, mock, test } from "bun:test";\nfunction twice(f: (n: number) => number): number { return f(1) + f(2); }\ntest("called", () => { const f = mock((n: number) => n * 10); expect(twice(f)).toBe(30); expect(f).toHaveBeenCalledTimes(2); const g = jest.fn((n: number) => n); expect(twice(g)).toBe(3); });\ntest("held", () => { const wrong: any = mock(() => "text"); expect(() => twice(wrong)).toThrow(TypeError); });`,
      },
      ["test", ...flags, "three.test.ts"],
    );
    expect(stderr).toContain("2 pass");
    expect(exitCode).toBe(0);
  });
  test("spyOn reaches a method of a built-in prototype, which the program itself cannot change", async () => {
    const { stdout, stderr, exitCode } = await ran(
      {
        "main.test.ts": `
          import { expect, spyOn, test } from "bun:test";
          test("case", () => {
            const own = String.prototype.normalize;
            const spy = spyOn(String.prototype, "normalize");
            console.log("see:", "e".normalize(), spy.mock.calls.length, String.prototype.normalize === own);
            const found = spyOn(Array.prototype, "indexOf").mockReturnValue(40);
            console.log("see:", [1].indexOf(1), found.mock.calls.length);
            expect(() => { (Array.prototype as any).indexOf = () => 1; }).toThrow(TypeError);
            spy.mockRestore();
            found.mockRestore();
            console.log("see:", [1].indexOf(1), String.prototype.normalize === own);
          });`,
      },
      ["test", ...flags, "./main.test.ts"],
    );
    expect({ seen: (stdout + stderr).split("\n").filter(line => line.startsWith("see:")), exitCode }).toEqual({
      seen: ["see: e 1 false", "see: 40 1", "see: 0 true"],
      exitCode: 0,
    });
  });
  test("a type error in a test file ends the run", async () => {
    const { stderr, exitCode } = await ran(
      { "four.test.ts": `import { test } from "bun:test";\nconst n: number = "x";\ntest("never", () => {});` },
      ["test", ...flags, "four.test.ts"],
    );
    expect(stderr).toContain("TS2322");
    expect(stderr).not.toContain("1 pass");
    expect(exitCode).toBe(1);
  });
});
