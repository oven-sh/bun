import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression coverage for the WebKit 01aaa3e0be0c sync. Each case targets a
// specific upstream API change that required a Bun-side adaptation.

describe.concurrent("WebKit 01aaa3e0be0c upgrade", () => {
  test("process.env.TZ invalidates the Intl.DateTimeFormat cache", async () => {
    // Upstream caches Intl.DateTimeFormat instances (bug 314337) and clears
    // the cache on VM entry when hasTimeZoneChange() is set. Bun flips the
    // zone mid-execution, so the TZ setter now clears vm.intlCache() directly.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const before = Intl.DateTimeFormat().resolvedOptions().timeZone;
          process.env.TZ = "America/Anchorage";
          const after = Intl.DateTimeFormat().resolvedOptions().timeZone;
          process.stdout.write(JSON.stringify({ before, after }));
        `,
      ],
      env: { ...bunEnv, TZ: "UTC" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ before: "UTC", after: "America/Anchorage" });
    expect(exitCode).toBe(0);
  });

  test("import with a HostDefined type attribute links without crashing", async () => {
    // Upstream's m_dependencies removal (bug 320144) rewrote
    // hostResolveImportedModule as a typed m_loadedModules probe; the fork's
    // HostDefined ScriptFetchParameters::Type must be included in that probe.
    using dir = tempDir("wk-hostdefined", {
      "f.txt": "hello",
      "entry.mjs": `import txt from "./f.txt" with { type: "text" }; process.stdout.write(txt);`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("hello");
    expect(exitCode).toBe(0);
  });

  test("AsyncLocalStorage context survives for-await over an async generator", async () => {
    // Upstream moved the cooperative-driver resolve path behind the new
    // settleDriverWithIteratorResult helper (bug 319817). The fork's
    // AsyncContextSwapScope wrapping had to be re-plumbed through that helper.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { AsyncLocalStorage } = require("node:async_hooks");
          const als = new AsyncLocalStorage();
          async function* gen() { yield 1; await 0; yield 2; }
          als.run("CTX", async () => {
            for await (const x of gen()) {
              if (als.getStore() !== "CTX") throw new Error("lost at " + x);
            }
            process.stdout.write("ok");
          });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ok");
    expect(exitCode).toBe(0);
  });

  test("ReadableStream.from wraps a sync iterable", async () => {
    // JSAsyncFromSyncIterator::create gained an IterationMode parameter
    // (bug 319435). ReadableStreamOperations.cpp constructs one directly.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const rs = ReadableStream.from([10, 20, 30]);
          const r = rs.getReader();
          (async () => {
            const out = [];
            for (;;) {
              const { value, done } = await r.read();
              if (done) break;
              out.push(value);
            }
            process.stdout.write(JSON.stringify(out));
          })();
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("[10,20,30]");
    expect(exitCode).toBe(0);
  });

  test("module linking initialises var bindings without JSModuleRecord VariableEnvironments", async () => {
    // JSModuleRecord no longer stores the parser's VariableEnvironments
    // (bug 320151); var-binding initialisation now reads them from the
    // UnlinkedModuleProgramCodeBlock. Bun's fast-path record construction
    // dropped its declared/lexical-env plumbing to match.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const vm = require("node:vm");
          (async () => {
            const m = new vm.SourceTextModule(
              "var v = 1; function f() { return v + 1; } export { v, f };",
              { identifier: "m" },
            );
            await m.link(() => { throw new Error("unreachable"); });
            await m.evaluate();
            const { v, f } = m.namespace;
            process.stdout.write(JSON.stringify([v, f()]));
          })().catch(e => { console.error(e); process.exit(1); });
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("[1,2]");
    expect(exitCode).toBe(0);
  });
});
