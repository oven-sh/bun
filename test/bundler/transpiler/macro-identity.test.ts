// https://github.com/oven-sh/bun/issues/7196
//
// Object/array literals returned from a macro have fresh identity each time
// the literal is evaluated. The const-inliner must not substitute the whole
// literal at every use site: `const a = obj(); a === a` must stay `true`, not
// become `({}) === ({})`. Primitive leaves reached through destructuring, and
// direct `macro().prop` access, are still safe to inline.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const files = {
  "m.ts": `
    export const obj = () => ({});
    export const arr = () => [1, 2, 3];
    export const nested = () => ({ leaf: 7, inner: { z: 1 }, list: [9] });
    export const holes = () => ({ a: undefined, b: 4 });
    export const holesArr = () => [undefined, 6];
  `,
  "entry.ts": `
    import { obj, arr, nested, holes, holesArr } from "./m.ts" with { type: "macro" };
    const o = obj();
    const a = arr();
    const { leaf, inner, list } = nested();
    const { a: da = 10, b: db = 20 } = holes();
    const [dx = 30, dy = 40] = holesArr();
    console.log(JSON.stringify({
      o: o === o,
      a: a === a,
      inner: inner === inner,
      list: list === list,
      leaf,
      aJson: JSON.stringify(a),
      direct: nested().leaf,
      da, db, dx, dy,
    }));
  `,
};

const expected = {
  o: true,
  a: true,
  inner: true,
  list: true,
  leaf: 7,
  aJson: "[1,2,3]",
  direct: 7,
  da: 10,
  db: 4,
  dx: 30,
  dy: 6,
};

describe("macro object/array result preserves identity", () => {
  test.concurrent("bun run", async () => {
    using dir = tempDir("macro-identity-run", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "entry.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout.trim().split("\n").pop()!), stderr, exitCode }).toEqual({
      out: expected,
      stderr: "",
      exitCode: 0,
    });
  });

  for (const minify of [false, true]) {
    test.concurrent(`bun build${minify ? " --minify" : ""}`, async () => {
      using dir = tempDir(`macro-identity-build-${minify}`, files);
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "entry.ts", "--target", "bun", ...(minify ? ["--minify"] : []), "--outfile", "out.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, buildErr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      expect({ buildErr, buildExit }).toEqual({ buildErr: "", buildExit: 0 });

      await using run = Bun.spawn({
        cmd: [bunExe(), "out.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
      expect({ out: JSON.parse(stdout.trim()), stderr, exitCode }).toEqual({
        out: expected,
        stderr: "",
        exitCode: 0,
      });
    });
  }
});

// https://github.com/oven-sh/bun/issues/12067
// The macro path in visit_decl bypassed the `was_const` requirement, so a
// `let`/`var` bound to a macro result was still substituted at every use,
// turning `output += " "` into `"Hello" += " "`.
describe("macro result bound to let/var is not substituted", () => {
  const files = {
    "m.ts": `
      export const hello = () => "Hello";
      export const pair = () => ({ x: 1, y: 2 });
    `,
    "entry.ts": `
      import { hello, pair } from "./m.ts" with { type: "macro" };
      let s = hello();
      s += " ";
      s += "World";
      let { x, y } = pair();
      x = 99;
      console.log(JSON.stringify({ s, x, y }));
    `,
  };
  const expected = { s: "Hello World", x: 99, y: 2 };

  test.concurrent("bun run", async () => {
    using dir = tempDir("macro-let-run", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "entry.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout.trim().split("\n").pop()!), stderr, exitCode }).toEqual({
      out: expected,
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("bun build --minify-syntax", async () => {
    using dir = tempDir("macro-let-build", files);
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "entry.ts", "--target", "bun", "--minify-syntax", "--outfile", "out.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildErr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect({ buildErr, buildExit }).toEqual({ buildErr: "", buildExit: 0 });

    await using run = Bun.spawn({
      cmd: [bunExe(), "out.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect({ out: JSON.parse(stdout.trim()), stderr, exitCode }).toEqual({
      out: expected,
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("let destructure still drops unused macro properties from the emitted literal", async () => {
    using dir = tempDir("macro-let-trunc", {
      "m.ts": `export const big = () => ({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 });`,
      "entry.ts": `
        import { big } from "./m.ts" with { type: "macro" };
        let { a } = big();
        a += 100;
        console.log(a);
      `,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "entry.ts", "--target", "bun", "--minify", "--outfile", "out.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildErr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect({ buildErr, buildExit }).toEqual({ buildErr: "", buildExit: 0 });

    const out = await Bun.file(`${dir}/out.js`).text();
    expect(out).not.toContain("b:2");
    expect(out).not.toContain("h:8");

    await using run = Bun.spawn({
      cmd: [bunExe(), "out.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "101", stderr: "", exitCode: 0 });
  });
});
