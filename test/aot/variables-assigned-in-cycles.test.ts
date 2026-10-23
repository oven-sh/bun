// What a variable without a written type holds is found by looking at what is stored to it. Variables are stored to each other in circles: through sums, through members, through
// closures, through functions whose results are inferred, and through long chains of calls on the variable itself (`s = s.replace(..).replace(..)`). A question that is asked anew along
// every path through such a circle takes time that doubles and more with each link. These programs are small and are checked in a fraction of a second: the bound is on the time.
import { expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { unsupported } from "./run-programs";

const upTo = (n: number) => Array.from({ length: n }, (_, i) => i);
const replaced = (name: string, n: number) =>
  name +
  upTo(n)
    .map(i => `.replace("${i}", "${i + 1}")`)
    .join("");

// prettier-ignore
const shapes: Record<string, (n: number) => string> = {
  "a chain of calls on the variable itself": n => `function f(x: string) { let s = x; s = ${replaced("s", n)}; return s; }\nconsole.log(f("0"));`,
  "a chain of calls on a record whose methods hand back this": n => `interface B { n: number; add(k: number): B }\nfunction make(): B { return { n: 0, add(k) { this.n += k; return this; } }; }\nfunction f() { let b = make(); b = b${upTo(n).map(i => `.add(${i})`).join("")}; return b.n; }\nconsole.log(f());`,
  "two variables, each a chain of calls on the other": n => `function f(x: string) { let a = x, b = x; b = ${replaced("a", n)}; a = ${replaced("b", n)}; return [a, b]; }\nconsole.log(String(f("0")));`,
  "calls nested in each other on the variable itself": n => `const g = (x: number) => x + 1;\nfunction f(x: number) { let s = x; s = ${"g(".repeat(n)}s${")".repeat(n)}; return s; }\nconsole.log(f(0));`,
  "functions that store what the next one returns": n => upTo(n).map(i => `function f${i}(x: number) { let acc = 0; if (x > 0) acc = f${(i + 1) % n}(x - 1); return acc + ${i}; }`).join("\n") + "\nconsole.log(f0(3));",
  "variables stored from the one before, and the first from the last": n => `function f(x: number) {\n  let v0 = 0;\n${upTo(n - 1).map(i => `  let v${i + 1} = 0; v${i + 1} = v${i} + x;`).join("\n")}\n  v0 = v${n - 1}; return v0; }\nconsole.log(f(1));`,
  "variables carried round loops and stored from calls": n => upTo(n).map(i => `function f${i}(x: number) { let s = 0, t = 1; for (let i = 0; i < x; i++) { s = s + t; t = f${(i + 1) % n}(s % 3) + s; } return s + t; }`).join("\n") + "\nconsole.log(f0(2));",
  "every variable stored from five others": n => `function f(x: number) {\n${upTo(n).map(i => `  let v${i} = ${i};`).join("\n")}\n${upTo(n).map(i => "  " + [3, 7, 11, 13, 17].map(k => `v${i} = v${(i * k + k) % n} + x;`).join(" ")).join("\n")}\n  return v0; }\nconsole.log(f(1));`,
  "a member of what the next function returns": n => upTo(n).map(i => `function f${i}(x: number) { let acc = 0; if (x > 0) acc = f${(i + 1) % n}(x - 1).n; return { n: acc + ${i} }; }`).join("\n") + "\nconsole.log(f0(3).n);",
};

for (const [shape, text] of Object.entries(shapes)) {
  test.skipIf(!!unsupported)(
    shape,
    async () => {
      using folder = tempDir("aot-circles", {});
      const entryPoint = join(String(folder), "main.ts");
      writeFileSync(entryPoint, "declare const console: { log(...values: unknown[]): void };\n" + text(60) + "\n");
      // A debug build takes a second or two. One that asks anew along every path does not end.
      await using checked = Bun.spawn({
        cmd: [bunExe(), "check", "--aot", entryPoint],
        cwd: String(folder),
        env: bunEnv,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: 30_000,
        killSignal: "SIGKILL",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        checked.stdout.text(),
        checked.stderr.text(),
        checked.exited,
      ]);
      expect({ signal: checked.signalCode, exitCode, errors: (stdout + stderr).match(/\berror\b.*/g) ?? [] }).toEqual({
        signal: null,
        exitCode: 0,
        errors: [],
      });
    },
    60_000,
  );
}
