import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The code frame above an error is cut out of the original file, so a CRLF file
// has to print exactly like an LF one. Line 1 used to keep its "\r" (the lines
// after it never did), which also leaked into Bun.inspect(err) strings.
//
// inspect-error.test.js pins its own line numbers in inline snapshots, so these
// live next to it instead of in it.
describe.concurrent("code frame of a file with CRLF line endings", () => {
  async function run(entry: string) {
    using dir = tempDir("inspect-error-crlf", { "entry.js": entry });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.split("\n"), stderr: stderr.split("\n"), exitCode };
  }

  test("uncaught error below line 1", async () => {
    const { stdout, stderr, exitCode } = await run("'L1';\r\n'L2';\r\nthrow new Error('x');\r\n");
    expect({ stdout, stderr: stderr.slice(0, 5), exitCode }).toEqual({
      stdout: [""],
      stderr: ["1 | 'L1';", "2 | 'L2';", "3 | throw new Error('x');", "              ^", "error: x"],
      exitCode: 1,
    });
  });

  test("uncaught error on line 1", async () => {
    const { stdout, stderr, exitCode } = await run("throw new Error('x');\r\n'L2';\r\n");
    expect({ stdout, stderr: stderr.slice(0, 3), exitCode }).toEqual({
      stdout: [""],
      stderr: ["1 | throw new Error('x');", "              ^", "error: x"],
      exitCode: 1,
    });
  });

  test("empty line 1", async () => {
    const { stdout, stderr, exitCode } = await run("\r\nthrow new Error('x');\r\n");
    expect({ stdout, stderr: stderr.slice(0, 4), exitCode }).toEqual({
      stdout: [""],
      stderr: ["1 | ", "2 | throw new Error('x');", "              ^", "error: x"],
      exitCode: 1,
    });
  });

  test("Bun.inspect(error)", async () => {
    const { stdout, stderr, exitCode } = await run(
      "'L1';\r\nconst err = new Error('x');\r\nprocess.stdout.write(Bun.inspect(err));\r\n",
    );
    expect({ stdout: stdout.slice(0, 4), stderr, exitCode }).toEqual({
      stdout: ["1 | 'L1';", "2 | const err = new Error('x');", "                    ^", "error: x"],
      stderr: [""],
      exitCode: 0,
    });
  });

  // The CSS parser locates its diagnostics with the same line lookup, and
  // BuildMessage exposes the line as position.lineText.
  test("CSS syntax error on line 1", async () => {
    using dir = tempDir("inspect-error-crlf", { "entry.css": "}\r\na {}\r\n" });
    const result = await Bun.build({ entrypoints: [`${dir}/entry.css`], throw: false });
    expect(result.logs.map(log => [log.position?.line, log.position?.lineText])).toEqual([[1, "}"]]);
  });
});
