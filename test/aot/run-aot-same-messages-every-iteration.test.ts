import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunExe, tempDir } from "harness";
import { join } from "path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

test("delete of a method of a locked built-in throws in sloppy code too, and one error in strict code, every time", async () => {
  using dir = tempDir("run-aot-same-messages-every-iteration", {
    "sloppy.cjs": `
      function byName() { return delete Array.prototype.push; }
      function byKey(key) { return delete Array.prototype[key]; }
      function count(f) { const seen = {}; for (let i = 0; i < 200000; i++) { let said; try { said = String(f("push")); } catch (e) { said = e.name; } seen[said] = (seen[said] || 0) + 1; } return JSON.stringify(seen); }
      console.log(count(byName), count(byKey));`,
    "strict.mjs": `
      function byName() { return delete Array.prototype.push; }
      function byKey(key) { return delete Array.prototype[key]; }
      function count(f) { const seen = {}; for (let i = 0; i < 200000; i++) { let said; try { said = String(f("push")); } catch (e) { said = e.message; } seen[said] = (seen[said] || 0) + 1; } return Object.keys(seen).length; }
      console.log(count(byName), count(byKey));`,
  });
  for (const [file, expected] of [
    ["sloppy.cjs", `{"TypeError":200000} {"TypeError":200000}\n`],
    ["strict.mjs", "1 1\n"],
  ]) {
    const { stdout, exitCode } = await runCommand([bunExe(), "run", "--aot", file], String(dir));
    expect({ file, stdout, exitCode }).toEqual({ file, stdout: expected, exitCode: 0 });
  }
});

test("every type rule, 100,000 times", async () => {
  const programs = join(import.meta.dir, "programs");
  const folder = join(programs, "type-rules/every-rule-100k-times");
  const { stdout, exitCode } = await runCommand([bunExe(), "run", "--debug-aot", join(folder, "main.ts")], folder);
  expect({ stdout, exitCode }).toEqual({ stdout: readFileSync(folder + ".expected.txt", "utf8"), exitCode: 0 });
});

test("stores of mismatched values, 100,000 times", async () => {
  const folder = join(import.meta.dir, "programs", "type-rules/stores-100k-times");
  const run = async (...flags: string[]) => {
    const { stdout, exitCode } = await runCommand([bunExe(), "run", ...flags, join(folder, "main.ts")], folder);
    return { stdout, exitCode };
  };
  const plain = await run();
  expect(plain.exitCode).toBe(0);
  expect(plain.stdout).not.toContain("TypeError");
  expect(await run("--aot")).toEqual(plain);
});

test("Object.defineProperty with a value, 100,000 times", async () => {
  const folder = join(import.meta.dir, "programs", "type-rules/define-property-with-value");
  const run = async (...flags: string[]) => {
    const { stdout, exitCode } = await runCommand([bunExe(), "run", ...flags, join(folder, "main.ts")], folder);
    return { stdout, exitCode };
  };
  const plain = await run();
  expect(plain.exitCode).toBe(0);
  expect(await run("--aot")).toEqual(plain);
});

test("a function created from text and a compiled function each report a read of null with one message", async () => {
  using dir = tempDir("run-aot-same-messages-every-iteration", {
    "main.mjs": `
      const evaluated = Function("o", "return o.a");
      function reads() { const seen = {}; for (let i = 0; i < 200000; i++) { let said; try { said = String(evaluated(i % 100 === 99 ? null : { a: 1 })); } catch (e) { said = e.message; } seen[said] = (seen[said] || 0) + 1; } return Object.keys(seen).length; }
      function own() { const seen = {}; for (let i = 0; i < 200000; i++) { let said; try { said = String((i % 100 === 99 ? null : { a: 1 }).a); } catch (e) { said = e.message; } seen[said] = (seen[said] || 0) + 1; } return JSON.stringify(seen); }
      console.log(reads(), own());`,
  });
  const { stdout, exitCode } = await runCommand([bunExe(), "run", "--debug-aot", "main.mjs"], String(dir));
  expect({ stdout, exitCode }).toEqual({
    stdout: `2 {"1":198000,"null is not an object (evaluating 'null.a')":2000}\n`,
    exitCode: 0,
  });
});

test("Reflect.deleteProperty of a method of a locked built-in returns false every time", async () => {
  using dir = tempDir("run-aot-same-messages-every-iteration", {
    "main.mjs": `
      function count(f) { const seen = {}; for (let i = 0; i < 200000; i++) { let said; try { said = String(f(i)); } catch (e) { said = e.name; } seen[said] = (seen[said] || 0) + 1; } return JSON.stringify(seen); }
      console.log(count(() => Reflect.deleteProperty(Array.prototype, "push")), count(i => Reflect.deleteProperty(Math, i & 1 ? "floor" : "abs")), typeof [].push, typeof Math.floor);`,
  });
  const { stdout, exitCode } = await runCommand([bunExe(), "run", "--aot", "main.mjs"], String(dir));
  expect({ stdout, exitCode }).toEqual({
    stdout: `{"false":200000} {"false":200000} function function\n`,
    exitCode: 0,
  });
});

test("a frozen array is never modified", async () => {
  using dir = tempDir("run-aot-same-messages-every-iteration", {
    "main.mjs": `
      function count(f) { const seen = {}; for (let i = 0; i < 200000; i++) { let said; try { said = String(f(i)); } catch (e) { said = e.name; } seen[said] = (seen[said] || 0) + 1; } return JSON.stringify(seen); }
      console.log(count(i => { const a = [i, i + 1]; Object.freeze(a); try { a[0] = -1; } catch {} return a[0] === i; }));
      console.log(count(i => { const a = [i + 0.5, 1.5]; Object.freeze(a); try { a[0] = -1.5; } catch {} return a[0] === i + 0.5; }));
      console.log(count(i => { const a = [{}, i]; Object.freeze(a); try { a[1] = -1; } catch {} return a[1] === i; }));
      console.log(count(i => { const a = [i, i + 1]; Object.freeze(a); a[0] = -1; return "stored"; }));
      console.log(count(i => { const a = [i, i + 1]; Object.freeze(a); try { a.push(1); } catch {} try { a.length = 0; } catch {} return a.length; }));`,
  });
  const { stdout, exitCode } = await runCommand([bunExe(), "run", "--aot", "main.mjs"], String(dir));
  expect({ stdout, exitCode }).toEqual({
    stdout: `{"true":200000}\n{"true":200000}\n{"true":200000}\n{"TypeError":200000}\n{"2":200000}\n`,
    exitCode: 0,
  });
});

test("error messages for writes to locked built-ins", async () => {
  const programs = join(import.meta.dir, "programs");
  const { stdout, exitCode } = await runCommand(
    [bunExe(), "run", "--aot", join(programs, "type-rules/builtin-write-errors-mention-aot.ts")],
    programs,
  );
  expect({ stdout, exitCode }).toEqual({
    stdout: readFileSync(join(programs, "type-rules/builtin-write-errors-mention-aot.expected.txt"), "utf8"),
    exitCode: 0,
  });
});
