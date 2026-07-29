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

describe("WebKit 2e37adcc23b7 upgrade", () => {
  // These are upstream Yarr correctness fixes; they needed no Bun-side change
  // but are observable behaviour differences delivered by this sync.
  test("sticky dot-star-wrapped expression does not skip the leading .*", () => {
    // https://bugs.webkit.org/show_bug.cgi?id=320348
    // optimizeDotStarWrappedExpressions reported the inner match position,
    // which a sticky pattern then rejected because it wasn't at lastIndex 0.
    expect(/^.*a.*$/y.exec("xa")?.[0]).toBe("xa");
    const r = /^.*a.*$/y;
    r.lastIndex = 0;
    expect(r.test("xa")).toBe(true);
  });

  test("^ inside an empty-matching parenthesis does not anchor the whole pattern", () => {
    // https://bugs.webkit.org/show_bug.cgi?id=320347
    // /(?:^a)?b/ was compiled as anchored, so 'b' at a non-start position
    // never matched.
    expect(/(?:^a)?b/.exec("cb")?.[0]).toBe("b");
    expect(/(?:^a)?b/.exec("ab")?.[0]).toBe("ab");
  });
});
