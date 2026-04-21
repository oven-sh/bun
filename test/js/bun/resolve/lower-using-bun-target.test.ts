import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const source = `{
  using x = { [Symbol.dispose]() { console.log("sync disposed"); } };
  console.log("in scope");
}
async function f() {
  await using y = { [Symbol.asyncDispose]() { console.log("async disposed"); } };
  console.log("in async scope");
}
await f();
for (using z of [{ [Symbol.dispose]() { console.log("for-of disposed"); } }]) {
  console.log("for-of body");
}
using top = { [Symbol.dispose]() { console.log("top-level disposed"); } };
console.log("done");
`;

const expectedStdout =
  "in scope\n" +
  "sync disposed\n" +
  "in async scope\n" +
  "async disposed\n" +
  "for-of body\n" +
  "for-of disposed\n" +
  "done\n" +
  "top-level disposed\n";

describe("using / await using is not lowered when targeting bun", () => {
  test("Bun.Transpiler passes using / await using through for target=bun", () => {
    const bunTranspiler = new Bun.Transpiler({ target: "bun" });
    const out = bunTranspiler.transformSync(source, "js");

    expect(out).not.toContain("__using");
    expect(out).not.toContain("__callDispose");
    expect(out).toContain("using x =");
    expect(out).toContain("await using y =");
    expect(out).toContain("for (using z of ");
    expect(out).toContain("using top =");
  });

  test("Bun.Transpiler still lowers using / await using for target=browser", () => {
    const browserTranspiler = new Bun.Transpiler({ target: "browser" });
    const out = browserTranspiler.transformSync(source, "js");

    expect(out).toContain("__using");
    expect(out).toContain("__callDispose");
    expect(out).not.toContain("using x =");
    expect(out).not.toContain("await using y =");
  });

  test("Bun.Transpiler still lowers using / await using for target=node", () => {
    const nodeTranspiler = new Bun.Transpiler({ target: "node" });
    const out = nodeTranspiler.transformSync(source, "js");

    expect(out).toContain("__using");
    expect(out).toContain("__callDispose");
  });

  test("bun build --target=bun passes using / await using through", async () => {
    using dir = tempDir("using-bun-target", {
      "entry.js": source,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--target=bun", "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).not.toContain("__using");
    expect(stdout).not.toContain("__callDispose");
    expect(stdout).toContain("using x =");
    expect(stdout).toContain("await using y =");
    expect(stdout).toContain("for (using z of ");
    expect(stdout).toContain("using top =");
    expect(exitCode).toBe(0);
  });

  test("bun build --target=browser still lowers using / await using", async () => {
    using dir = tempDir("using-browser-target", {
      "entry.js": source,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--target=browser", "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toContain("__using");
    expect(stdout).toContain("__callDispose");
    expect(exitCode).toBe(0);
  });

  test("bun build --target=bun output with using / await using runs correctly", async () => {
    using dir = tempDir("using-bun-target-run", {
      "entry.js": source,
    });

    await using buildProc = Bun.spawn({
      cmd: [bunExe(), "build", "--target=bun", "--outfile=out.js", "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExit] = await Promise.all([
      buildProc.stdout.text(),
      buildProc.stderr.text(),
      buildProc.exited,
    ]);
    expect(buildStderr).toBe("");
    expect(buildExit).toBe(0);

    await using runProc = Bun.spawn({
      cmd: [bunExe(), "out.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);

    expect(stdout).toBe(expectedStdout);
    expect(exitCode).toBe(0);
  });

  test("runtime executes using / await using correctly without lowering", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe(expectedStdout);
    expect(exitCode).toBe(0);
  });
});
