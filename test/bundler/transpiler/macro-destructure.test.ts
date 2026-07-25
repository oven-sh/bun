// https://github.com/oven-sh/bun/issues/9613
//
// Destructuring a macro result with the binding keys in a different order than
// the returned object's properties used to drop bindings: the visitor compacted
// the object's property array in place while still iterating the binding keys,
// so a copy into `props[end]` could overwrite a property that a later key had
// not yet looked up.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Debug builds print "[macro] call <name>" to stdout before the script's own
// output; only the last line carries the JSON the test emits.
const lastLine = (s: string) => s.trim().split("\n").pop() ?? "";

const macroSrc = `
  export function abc() { return { a: "a", b: "b", c: "c" }; }
  export function nested() { return { outer: { x: 1, y: 2, z: 3 }, k: 7 }; }
  export function wide() { return { a: 1, b: 2, c: 3, d: 4, e: 5 }; }
`;

describe("macro object destructure with reordered keys", () => {
  test.concurrent("bun run: every permutation binds the right value", async () => {
    using dir = tempDir("macro-destructure-run", {
      "m.ts": macroSrc,
      "entry.ts": `
        import { abc } from "./m.ts" with { type: "macro" };
        const rows: string[] = [];
        { const { a, b, c } = abc(); rows.push([a, b, c].join(",")); }
        { const { a, c, b } = abc(); rows.push([a, b, c].join(",")); }
        { const { b, a, c } = abc(); rows.push([a, b, c].join(",")); }
        { const { b, c, a } = abc(); rows.push([a, b, c].join(",")); }
        { const { c, a, b } = abc(); rows.push([a, b, c].join(",")); }
        { const { c, b, a } = abc(); rows.push([a, b, c].join(",")); }
        console.log(JSON.stringify(rows));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "entry.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: lastLine(stdout), stderr, exitCode }).toEqual({
      stdout: JSON.stringify(["a,b,c", "a,b,c", "a,b,c", "a,b,c", "a,b,c", "a,b,c"]),
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("bun run: nested and aliased destructure", async () => {
    using dir = tempDir("macro-destructure-nested", {
      "m.ts": macroSrc,
      "entry.ts": `
        import { nested, abc } from "./m.ts" with { type: "macro" };
        const { k, outer: { z, x, y } } = nested();
        const { c: C, a: A, b: B } = abc();
        console.log(JSON.stringify({ x, y, z, k, A, B, C }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "entry.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: lastLine(stdout), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ x: 1, y: 2, z: 3, k: 7, A: "a", B: "b", C: "c" }),
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("bun build: subset destructure keeps only referenced keys", async () => {
    using dir = tempDir("macro-destructure-build", {
      "m.ts": macroSrc,
      "entry.ts": `
        import { wide } from "./m.ts" with { type: "macro" };
        const { d, b } = wide();
        console.log(JSON.stringify({ b, d }));
      `,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "entry.ts", "--target", "bun", "--outfile", "out.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildErr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect({ buildErr, buildExit }).toEqual({ buildErr: "", buildExit: 0 });

    const out = await Bun.file(`${dir}/out.js`).text();
    // the emitted initializer must contain both kept keys and none of the dropped ones
    expect(out).toMatch(/\{\s*d:\s*4,\s*b:\s*2\s*\}|\{\s*b:\s*2,\s*d:\s*4\s*\}/);
    expect(out).not.toMatch(/[^a-zA-Z]a:\s*1/);
    expect(out).not.toMatch(/[^a-zA-Z]c:\s*3/);
    expect(out).not.toMatch(/[^a-zA-Z]e:\s*5/);

    await using run = Bun.spawn({
      cmd: [bunExe(), "out.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [runOut, runErr, runExit] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect({ runOut: lastLine(runOut), runErr, runExit }).toEqual({
      runOut: JSON.stringify({ b: 2, d: 4 }),
      runErr: "",
      runExit: 0,
    });
  });
});
