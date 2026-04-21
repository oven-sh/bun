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
  test("single-use using declaration is not inlined away", () => {
    // When `using` was lowered, it was rewritten to `const` + try/finally before
    // the single-use-symbol inlining optimization ran. Now that `using` survives,
    // that optimization must not remove the declaration, since disposal is a side
    // effect that happens on scope exit.
    const t = new Bun.Transpiler({ target: "bun" });
    const out = t.transformSync(
      `function f() {
  using server = open();
  return server.url;
}
async function g() {
  await using conn = connect();
  return conn.id;
}
`,
      "js",
    );
    expect(out).toContain("using server = open()");
    expect(out).toContain("return server.url");
    expect(out).toContain("await using conn = connect()");
    expect(out).toContain("return conn.id");
    expect(out).not.toContain("return open().url");
    expect(out).not.toContain("return connect().id");
  });

  test("single-use using declaration disposes at runtime", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `let disposed = false;
function open() {
  return {
    url: "http://example",
    [Symbol.dispose]() { disposed = true; },
  };
}
function f() {
  using server = open();
  return server.url;
}
const url = f();
console.log(url, disposed);`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("http://example true\n");
    expect(exitCode).toBe(0);
  });

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

  test.each(["browser", "node"] as const)("Bun.Transpiler still lowers using / await using for target=%s", target => {
    const out = new Bun.Transpiler({ target }).transformSync(source, "js");

    expect(out).toContain("__using");
    expect(out).toContain("__callDispose");
    expect(out).not.toContain("using x =");
    expect(out).not.toContain("await using y =");
    expect(out).not.toContain("for (using z of ");
    expect(out).not.toContain("using top =");
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
    expect(stdout).not.toContain("using x =");
    expect(stdout).not.toContain("await using y =");
    expect(stdout).not.toContain("for (using z of ");
    expect(stdout).not.toContain("using top =");
    expect(exitCode).toBe(0);
  });

  test("top-level using in a lazily-wrapped ESM module still disposes when bundled", async () => {
    // When bundling for bun, a module reached only via dynamic `import()` is
    // wrapped in `__esm(() => { ... })`. The linker hoists top-level locals out
    // of that closure as `var` + assignment; `using` must be exempt from that
    // hoist or disposal semantics are lost.
    using dir = tempDir("using-esm-wrap", {
      "entry.js": `const mod = await import("./lazy.js");
console.log("result:", mod.result);
`,
      "lazy.js": `using handle = { val: 42, [Symbol.dispose]() { console.log("disposed"); } };
export const result = handle.val;
`,
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

    const out = await Bun.file(`${dir}/out.js`).text();
    expect(out).toContain("using handle =");

    await using runProc = Bun.spawn({
      cmd: [bunExe(), "out.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);

    expect(stdout).toBe("disposed\nresult: 42\n");
    expect(exitCode).toBe(0);
  });

  test("adjacent using declarations are not merged", () => {
    const t = new Bun.Transpiler({ target: "bun", minify: { syntax: true } });
    const out = t.transformSync(
      `function f() {
  using a = open();
  using b = open2();
  return [a.url, b.url];
}
`,
      "js",
    );
    // Match esbuild: keep separate `using` statements rather than merging
    // into `using a = open(), b = open2();`.
    expect(out).toContain("using a = open();");
    expect(out).toContain("using b = open2();");
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
