import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { test } from "./supported";

// `bun run --aot` runs on the interpreter and the JIT. A rule of --aot holds in all of them: what a line says the first time it says the two hundred thousandth time.
test("a delete that the lock on built-ins refuses", async () => {
  using dir = tempDir("run-aot-same-messages-every-tier", {
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
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--aot", file],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ file, stdout, exitCode }).toEqual({ file, stdout: expected, exitCode: 0 });
  }
});

test("every rule a hundred thousand times", async () => {
  const programs = join(import.meta.dir, "programs");
  const folder = join(programs, "type-rules/every-rule-100k-times");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--aot", join(folder, "main.ts")],
    cwd: folder,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: readFileSync(folder + ".expected.txt", "utf8"), exitCode: 0 });
});

test("stores a hundred thousand times", async () => {
  const folder = join(import.meta.dir, "programs", "type-rules/stores-100k-times");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--aot", join(folder, "main.ts")],
    cwd: folder,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: readFileSync(folder + ".expected.txt", "utf8"), exitCode: 0 });
});

test("definitions that bring a value, a hundred thousand times", async () => {
  const folder = join(import.meta.dir, "programs", "type-rules/define-property-with-value");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--aot", join(folder, "main.ts")],
    cwd: folder,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: readFileSync(folder + ".expected.txt", "utf8"), exitCode: 0 });
});

test("a function made of text keeps its words for a read of null when it is inlined into a function of a file", async () => {
  using dir = tempDir("run-aot-same-messages-every-tier", {
    "main.mjs": `
      const made = Function("o", "return o.a");
      function reads() { const seen = {}; for (let i = 0; i < 200000; i++) { let said; try { said = String(made(i % 100 === 99 ? null : { a: 1 })); } catch (e) { said = e.message; } seen[said] = (seen[said] || 0) + 1; } return Object.keys(seen).length; }
      function own() { const seen = {}; for (let i = 0; i < 200000; i++) { let said; try { said = String((i % 100 === 99 ? null : { a: 1 }).a); } catch (e) { said = e.message; } seen[said] = (seen[said] || 0) + 1; } return JSON.stringify(seen); }
      console.log(reads(), own());`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--aot", "main.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({
    stdout: `2 {"1":198000,"Cannot read properties of null (reading 'a')":2000}\n`,
    exitCode: 0,
  });
});

test("Reflect.deleteProperty, a built-in written in JavaScript, answers", async () => {
  using dir = tempDir("run-aot-same-messages-every-tier", {
    "main.mjs": `
      function count(f) { const seen = {}; for (let i = 0; i < 200000; i++) { let said; try { said = String(f(i)); } catch (e) { said = e.name; } seen[said] = (seen[said] || 0) + 1; } return JSON.stringify(seen); }
      console.log(count(() => Reflect.deleteProperty(Array.prototype, "push")), count(i => Reflect.deleteProperty(JSON, i & 1 ? "parse" : "stringify")), typeof [].push, typeof JSON.parse);`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--aot", "main.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({
    stdout: `{"false":200000} {"false":200000} function function\n`,
    exitCode: 0,
  });
});

test("a frozen array stays as it is", async () => {
  using dir = tempDir("run-aot-same-messages-every-tier", {
    "main.mjs": `
      function count(f) { const seen = {}; for (let i = 0; i < 200000; i++) { let said; try { said = String(f(i)); } catch (e) { said = e.name; } seen[said] = (seen[said] || 0) + 1; } return JSON.stringify(seen); }
      console.log(count(i => { const a = [i, i + 1]; Object.freeze(a); try { a[0] = -1; } catch {} return a[0] === i; }));
      console.log(count(i => { const a = [i + 0.5, 1.5]; Object.freeze(a); try { a[0] = -1.5; } catch {} return a[0] === i + 0.5; }));
      console.log(count(i => { const a = [{}, i]; Object.freeze(a); try { a[1] = -1; } catch {} return a[1] === i; }));
      console.log(count(i => { const a = [i, i + 1]; Object.freeze(a); a[0] = -1; return "stored"; }));
      console.log(count(i => { const a = [i, i + 1]; Object.freeze(a); try { a.push(1); } catch {} try { a.length = 0; } catch {} return a.length; }));`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--aot", "main.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({
    stdout: `{"true":200000}\n{"true":200000}\n{"true":200000}\n{"TypeError":200000}\n{"2":200000}\n`,
    exitCode: 0,
  });
});

test("the words of the lock", async () => {
  const programs = join(import.meta.dir, "programs");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--aot", join(programs, "type-rules/builtin-write-errors-mention-aot.ts")],
    cwd: programs,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({
    stdout: readFileSync(join(programs, "type-rules/builtin-write-errors-mention-aot.expected.txt"), "utf8"),
    exitCode: 0,
  });
});
