import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/9613
describe("destructuring a macro object", () => {
  const files = {
    "m.ts": `
      export const obj = () => ({ a: "a", b: "b", c: "c" });
      export const nested = () => ({ outer: { x: 1, y: 2, z: 3 }, other: 0 });
    `,
    "index.ts": `
      import { obj, nested } from "./m.ts" with { type: "macro" };
      const out: string[] = [];
      { const { a, b, c } = obj(); out.push([a, b, c].join(",")); }
      { const { a, c, b } = obj(); out.push([a, b, c].join(",")); }
      { const { b, a, c } = obj(); out.push([a, b, c].join(",")); }
      { const { b, c, a } = obj(); out.push([a, b, c].join(",")); }
      { const { c, a, b } = obj(); out.push([a, b, c].join(",")); }
      { const { c, b, a } = obj(); out.push([a, b, c].join(",")); }
      { const { c, a } = obj(); out.push([a, c].join(",")); }
      { const { b, a: a2 } = obj(); out.push([a2, b].join(",")); }
      { const { a, a: a2 } = obj(); out.push([a, a2].join(",")); }
      { const { c, missing } = obj(); out.push([c, String(missing)].join(",")); }
      { const { outer: { z, x } } = nested(); out.push([x, z].join(",")); }
      console.log(JSON.stringify(out));
    `,
  };
  const expected = ["a,b,c", "a,b,c", "a,b,c", "a,b,c", "a,b,c", "a,b,c", "a,c", "a,b", "a,a", "c,undefined", "1,3"];

  async function run(cmd: string[], cwd: string) {
    await using proc = Bun.spawn({ cmd, env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
    const [rawStdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Debug builds unconditionally print "[macro] call <name>" to stdout; drop those lines so the
    // whole remaining output can be compared exactly.
    const stdout = rawStdout
      .split("\n")
      .filter(l => !l.startsWith("[macro] "))
      .join("\n");
    return { stdout, stderr, exitCode };
  }

  test.concurrent("bun run", async () => {
    using dir = tempDir("macro-destructure-run", files);
    expect(await run([bunExe(), "index.ts"], String(dir))).toEqual({
      stdout: JSON.stringify(expected) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("bun build", async () => {
    using dir = tempDir("macro-destructure-build", files);
    const build = await run([bunExe(), "build", "./index.ts", "--target", "bun", "--outfile", "out.js"], String(dir));
    expect(build).toMatchObject({ exitCode: 0 });
    expect(await run([bunExe(), "out.js"], String(dir))).toEqual({
      stdout: JSON.stringify(expected) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
