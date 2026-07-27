import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Compiling a regex with N sibling named capture groups used to be O(N^2):
// YarrParser copied the full active-names set on every open paren. 30000
// named groups took well over a minute in release (and tens of minutes under
// debug+asan) while 30000 unnamed groups took tens of ms. After the fix
// parsing is O(N) and this completes in a few hundred ms.
test("compiling many sibling named capture groups is not quadratic", async () => {
  const code = `
    let src = "";
    for (let i = 0; i < 30000; i++) src += "(?<g" + i + ">a)";
    new RegExp(src);
    process.stdout.write("ok");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await Promise.race([
    proc.exited,
    Bun.sleep(30_000).then(() => {
      proc.kill();
      return "timeout" as const;
    }),
  ]);
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
  expect(stderr).toBe("");
  expect(stdout).toBe("ok");
  expect(exitCode).toBe(0);
}, 60_000);

test("duplicate named capture group detection is unchanged", () => {
  expect(() => new RegExp("(?<a>x)(?<a>y)")).toThrow(SyntaxError);
  expect(() => new RegExp("(?<a>(?<a>x))")).toThrow(SyntaxError);
  expect(() => new RegExp("((?<a>x)|(?<b>y))(?<a>z)")).toThrow(SyntaxError);
  expect(() => new RegExp("((?<a>x)|(?<b>y))(?<b>z)")).toThrow(SyntaxError);

  expect(() => new RegExp("(?<a>x)|(?<a>y)")).not.toThrow();
  expect(() => new RegExp("(?<a>x)|(?<a>y)|(?<a>z)")).not.toThrow();
  expect(() => new RegExp("((?<a>x)|(?<b>y))(?<c>z)")).not.toThrow();
  expect(() => new RegExp("((?<a>x)|(?<a>y))|(?<a>z)")).not.toThrow();

  expect("y".match(/(?<a>x)|(?<a>y)/)?.groups?.a).toBe("y");
  expect("xz".match(/((?<a>x)|(?<b>y))(?<c>z)/)?.groups).toEqual({ a: "x", b: undefined, c: "z" });
});
