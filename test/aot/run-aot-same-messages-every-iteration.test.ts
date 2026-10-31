import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
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
