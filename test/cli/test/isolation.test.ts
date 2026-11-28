import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, Heap, isASAN, isDebug, isWindows, normalizeBunSnapshot, tempDir, tls } from "harness";
import fs from "node:fs";
import net from "node:net";
import { join } from "node:path";
import { mysqlHandshakeV10, mysqlOkPacket, pgAuthenticationOk, pgReadyForQuery } from "../../js/sql/wire-frames";

// Every case spawns at least one full `bun test --isolate` child; the heavy
// ones (8-file leak fixtures, 500-2000-export module_info modules) exceed the
// 5s default on debug/ASAN runners.
setDefaultTimeout(isASAN ? 120_000 : 30_000);

// Two test files where the first leaks state and the second observes it.
// Under --isolate the second file must see a clean world.
const fixtures = {
  "a-leaker.test.ts": `
    import { test, expect } from "bun:test";

    test("leak global + server + interval", async () => {
      (globalThis as any).leakedFromA = "boom";

      const server = Bun.serve({ port: 0, fetch: () => new Response("hi") });
      (globalThis as any).leakedPort = server.port;

      setInterval(() => {
        (globalThis as any).intervalRan = ((globalThis as any).intervalRan ?? 0) + 1;
      }, 5).unref();

      expect(server.port).toBeGreaterThan(0);
    });
  `,
  "b-observer.test.ts": `
    import { test, expect } from "bun:test";

    test("globalThis is clean", () => {
      expect((globalThis as any).leakedFromA).toBeUndefined();
      expect((globalThis as any).leakedPort).toBeUndefined();
      expect((globalThis as any).intervalRan).toBeUndefined();
    });
  `,
};

const isolateFlags = ["--isolate", "--isolate=modules"];

async function runTests(
  dir: string,
  extraArgs: string[],
  files = ["./a-leaker.test.ts", "./b-observer.test.ts"],
  env: Record<string, string | undefined> = bunEnv,
) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...extraArgs, ...files],
    env,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("bun test --isolate", () => {
  test("without --isolate, leaked global is visible to next file", async () => {
    using dir = tempDir("isolate-off", fixtures);
    const { stderr, exitCode } = await runTests(String(dir), []);
    expect(stderr).toContain("(fail) globalThis is clean");
    expect(exitCode).not.toBe(0);
  });

  test("with --isolate, each file gets a fresh global", async () => {
    using dir = tempDir("isolate-on", fixtures);
    const { stderr, exitCode } = await runTests(String(dir), ["--isolate"]);
    expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
    expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test.each(isolateFlags)("with %s, a file's process.chdir() is undone before the next file", async isolate => {
    const cwdFixtures = {
      "a-chdir.test.ts": `
        import { test, expect } from "bun:test";
        import { tmpdir } from "node:os";
        test("chdir away", () => {
          process.chdir(tmpdir());
          expect(process.cwd()).not.toBe(import.meta.dir);
        });
      `,
      "b-cwd.test.ts": `
        import { test, expect } from "bun:test";
        import { realpathSync } from "node:fs";
        test("cwd is the fixture dir", () => {
          expect(realpathSync(process.cwd())).toBe(realpathSync(import.meta.dir));
        });
      `,
    };
    const files = ["./a-chdir.test.ts", "./b-cwd.test.ts"];

    using isolated = tempDir("isolate-cwd", cwdFixtures);
    const serial = await runTests(String(isolated), [isolate], files);
    expect(normalizeBunSnapshot(serial.stderr, isolated)).toContain("2 pass");
    expect(serial.exitCode).toBe(0);

    // One worker takes both files (scale-up gated), so the same restore runs
    // between files inside a --parallel worker.
    using parallel = tempDir("isolate-cwd-parallel", cwdFixtures);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=2", ...files],
      env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "60000" },
      cwd: String(parallel),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr, parallel)).toContain("2 pass");
    expect(exitCode).toBe(0);
  });

  // TZ, NODE_TLS_REJECT_UNAUTHORIZED, BUN_CONFIG_VERBOSE_FETCH and the proxy
  // keys have process.env setters with a native side effect outside the global
  // (the WTF time zone override, per-VM caches, the env map the next
  // process.env is seeded from). The next file reads the original values, so
  // the side effects must be rolled back with the global.
  test.each(isolateFlags)(
    "with %s, a file's process.env writes with native side effects are undone before the next file",
    async isolate => {
      const envFixtures = {
        "a-env.test.ts": `
        import { test, expect } from "bun:test";
        process.env.TZ = "America/New_York";
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
        process.env.BUN_CONFIG_VERBOSE_FETCH = "curl";
        process.env.HTTP_PROXY = "http://127.0.0.1:9/";
        test("the writes apply to this file", () => {
          expect(new Date(0).getTimezoneOffset()).toBe(300);
          expect(process.env.HTTP_PROXY).toBe("http://127.0.0.1:9/");
        });
      `,
        "b-env.test.ts": `
        import { test, expect } from "bun:test";
        const tls = ${JSON.stringify(tls)};
        test("Date is back on the runner's TZ", () => {
          expect(process.env.TZ).toBe("Etc/UTC");
          expect(new Date(0).getTimezoneOffset()).toBe(0);
        });
        test("fetch() verifies certificates again", async () => {
          expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
          using server = Bun.serve({ port: 0, tls, fetch: () => new Response("ok") });
          // Self-signed and not in any CA store: only a lax fetch() can connect.
          await expect(fetch(\`https://localhost:\${server.port}/\`, { keepalive: false })).rejects.toMatchObject({
            code: "DEPTH_ZERO_SELF_SIGNED_CERT",
          });
        });
        test("fetch() no longer goes through the previous file's proxy", async () => {
          expect(process.env.HTTP_PROXY).toBeUndefined();
          using server = Bun.serve({ port: 0, fetch: () => new Response("direct") });
          expect(await fetch(\`http://127.0.0.1:\${server.port}/\`, { keepalive: false }).then(r => r.text())).toBe("direct");
        });
      `,
      };
      const files = ["./a-env.test.ts", "./b-env.test.ts"];
      // The second file expects the proxy key to be unset, so the runner must
      // start without one even on a machine that routes through a proxy.
      const env = {
        ...bunEnv,
        HTTP_PROXY: undefined,
        http_proxy: undefined,
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
        NO_PROXY: undefined,
        no_proxy: undefined,
      };

      using isolated = tempDir("isolate-env", envFixtures);
      const serial = await runTests(String(isolated), [isolate], files, env);
      expect(normalizeBunSnapshot(serial.stderr, isolated)).toContain("4 pass");
      // Verbose fetch logging was left on by the first file: the second file's
      // fetch() must not print its curl transcript.
      expect(serial.stderr).not.toContain("curl --http1.1");
      expect(serial.exitCode).toBe(0);

      using parallel = tempDir("isolate-env-parallel", envFixtures);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--parallel=2", ...files],
        env: { ...env, BUN_TEST_PARALLEL_SCALE_MS: "60000" },
        cwd: String(parallel),
        stderr: "pipe",
        stdout: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(normalizeBunSnapshot(stderr, parallel)).toContain("4 pass");
      expect(stderr).not.toContain("curl --http1.1");
      expect(exitCode).toBe(0);
    },
  );

  // The synthetic allocation limit is process-wide. A file that lowers it and
  // does not put it back (or dies before its restore runs) must not make every
  // later file in the same process fail to build strings.
  test("with --isolate, a file's lowered synthetic allocation limit is undone before the next file", async () => {
    const MiB = 1024 * 1024;
    const limitFixtures = {
      "a-limit.test.ts": `
        import { test, expect } from "bun:test";
        import { setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
        test("lower the limit and leave it lowered", async () => {
          setSyntheticAllocationLimitForTesting(${MiB});
          await expect(new Response(Buffer.alloc(${2 * MiB}, 97)).text()).rejects.toMatchObject({
            code: "ERR_STRING_TOO_LONG",
          });
        });
      `,
      "b-limit.test.ts": `
        import { test, expect } from "bun:test";
        test("strings over the previous file's limit can be built again", async () => {
          const text = await new Response(Buffer.alloc(${8 * MiB}, 97)).text();
          expect(text.length).toBe(${8 * MiB});
          expect(Buffer.alloc(${8 * MiB}, 97).toString().length).toBe(${8 * MiB});
        });
      `,
    };
    const files = ["./a-limit.test.ts", "./b-limit.test.ts"];
    // The second file builds 8 MiB strings, so the runner must start at the
    // default limit even on a machine that lowers it through the environment.
    const env = { ...bunEnv, BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: undefined };

    using isolated = tempDir("isolate-alloc-limit", limitFixtures);
    const serial = await runTests(String(isolated), ["--isolate"], files, env);
    expect(normalizeBunSnapshot(serial.stderr, isolated)).toContain("2 pass");
    expect(serial.exitCode).toBe(0);

    using parallel = tempDir("isolate-alloc-limit-parallel", limitFixtures);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=2", ...files],
      env: { ...env, BUN_TEST_PARALLEL_SCALE_MS: "60000" },
      cwd: String(parallel),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr, parallel)).toContain("2 pass");
    expect(exitCode).toBe(0);
  });

  test("with --isolate, --preload re-runs in each file's fresh global", async () => {
    using dir = tempDir("isolate-preload", {
      "preload.ts": `
        import { expect, beforeEach, beforeAll, afterAll } from "bun:test";
        expect.extend({
          toBeCustom() { return { pass: true, message: () => "" }; },
        });
        beforeEach(() => { (globalThis as any).__preloadRan = true; });
        beforeAll(() => { (globalThis as any).__beforeAllRan = ((globalThis as any).__beforeAllRan ?? 0) + 1; });
        afterAll(() => { (globalThis as any).__afterAllRan = true; });
      `,
      "a.test.ts": `
        import { test, expect } from "bun:test";
        test("preload state present in a", () => {
          expect((globalThis as any).__preloadRan).toBe(true);
          expect((globalThis as any).__beforeAllRan).toBe(1);
          (expect(1) as any).toBeCustom();
        });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        test("preload state present in b", () => {
          expect((globalThis as any).__preloadRan).toBe(true);
          expect((globalThis as any).__beforeAllRan).toBe(1);
          (expect(1) as any).toBeCustom();
        });
      `,
    });
    const { stderr, exitCode } = await runTests(
      String(dir),
      ["--isolate", "--preload", "./preload.ts"],
      ["./a.test.ts", "./b.test.ts"],
    );
    expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
    expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("without --isolate, --preload still runs once (regression)", async () => {
    using dir = tempDir("isolate-preload-off", {
      "preload.ts": `
        import { beforeAll } from "bun:test";
        (globalThis as any).__preloadEvals = ((globalThis as any).__preloadEvals ?? 0) + 1;
        beforeAll(() => { (globalThis as any).__beforeAllRan = ((globalThis as any).__beforeAllRan ?? 0) + 1; });
      `,
      "a.test.ts": `
        import { test, expect } from "bun:test";
        test("a", () => {
          expect((globalThis as any).__preloadEvals).toBe(1);
          expect((globalThis as any).__beforeAllRan).toBe(1);
        });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        test("b", () => {
          expect((globalThis as any).__preloadEvals).toBe(1);
          expect((globalThis as any).__beforeAllRan).toBe(1);
        });
      `,
    });
    const { stderr, exitCode } = await runTests(
      String(dir),
      ["--preload", "./preload.ts"],
      ["./a.test.ts", "./b.test.ts"],
    );
    expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
    expect(exitCode).toBe(0);
  });

  test("with --isolate, module state is not shared between files", async () => {
    using dir = tempDir("isolate-modules", {
      "shared.ts": `export let counter = { n: 0 };`,
      "a.test.ts": `
        import { test, expect } from "bun:test";
        import { counter } from "./shared";
        test("bump", () => { counter.n++; expect(counter.n).toBe(1); });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        import { counter } from "./shared";
        test("fresh", () => { expect(counter.n).toBe(0); });
      `,
    });
    const { stderr, exitCode } = await runTests(String(dir), ["--isolate"], ["./a.test.ts", "./b.test.ts"]);
    expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
    expect(exitCode).toBe(0);
  });

  test.each([
    ["--isolate", ["--isolate"], {}],
    // One worker takes all three files (scale-up gated), so the second and third come after the worker's own swap.
    ["--parallel worker", ["--parallel=2"], { BUN_TEST_PARALLEL_SCALE_MS: "60000" }],
  ])("a test file's macros are loaded again for each file (%s)", async (_, args, env) => {
    const files: Record<string, string> = {
      "macro.ts": `
        let calls = 0;
        export function mark(name: string) { return name + ":" + ++calls; }
      `,
    };
    const names = ["a", "b", "c"];
    for (const name of names) {
      files[`required-${name}.ts`] = `
        import { mark } from "./macro.ts" with { type: "macro" };
        export const required = mark("required-${name}");
      `;
      files[`${name}.test.ts`] = `
        import { test, expect } from "bun:test";
        import { mark } from "./macro.ts" with { type: "macro" };
        const marks = [mark("${name}"), mark("${name}"), require("./required-${name}.ts").required];
        test("${name}", () => { expect(marks).toEqual(["${name}:1", "${name}:2", "required-${name}:3"]); });
      `;
    }
    using dir = tempDir("isolate-macro", files);
    const { stderr, exitCode } = await runTests(
      String(dir),
      args,
      names.map(name => `./${name}.test.ts`),
      { ...bunEnv, ...env },
    );
    expect(normalizeBunSnapshot(stderr, dir)).toContain("3 pass");
    expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  // The cached module record carries each name as Latin-1 or UTF-16; the second file links from that record.
  test("with --isolate, cached module records keep short, Latin-1 and UTF-16 names", async () => {
    using dir = tempDir("isolate-module-names", {
      "names.ts": `export const a = 1, ab = 2, abc = 3, abcd = 4, café = 5, слово = 6; export { a as é, ab as ф };`,
      "a.test.ts": `
        import { test, expect } from "bun:test";
        import { a, ab, abc, abcd, café, слово, é, ф } from "./names";
        test("first", () => {
          (globalThis as any).__a_ran = true;
          expect([a, ab, abc, abcd, café, слово, é, ф].join()).toBe("1,2,3,4,5,6,1,2");
        });
      `,
      "b.test.ts": `
        import { test, expect } from "bun:test";
        import { isolatedModuleCacheSourceType } from "bun:internal-for-testing";
        import { a, ab, abc, abcd, café, слово, é, ф } from "./names";
        test("from cache", () => {
          expect((globalThis as any).__a_ran).toBeUndefined();
          expect(isolatedModuleCacheSourceType(require.resolve("./names"))).toBe("BunTranspiledModule");
          expect([a, ab, abc, abcd, café, слово, é, ф].join()).toBe("1,2,3,4,5,6,1,2");
        });
      `,
    });
    const { stderr, exitCode } = await runTests(String(dir), ["--isolate"], ["./a.test.ts", "./b.test.ts"]);
    expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
    expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/33904
  // The linker rewrites an import that a plugin onResolve answers. When the answer has a
  // namespace, the printer emits "namespace:path", and the cached module record has to
  // request that same specifier. "./data.bar?custom" is moved into a namespace by the
  // plugin. "virt:thing" is already in one in the source.
  const pluginNamespaceTestFile = `
    import { test, expect } from "bun:test";
    import direct from "./data.bar?custom";
    import * as star from "./data.bar?custom";
    import { named as viaClause } from "./reexport-clause.ts";
    import { named as viaStar } from "./reexport-star.ts";
    import { ns as viaNamespace } from "./reexport-namespace.ts";
    import redirected from "./data.bar?redirect";
    import virtual from "virt:other";
    import { virtual as viaVirtualReexport } from "./reexport-virtual.ts";

    test("plugin-resolved imports load", () => {
      expect({
        direct,
        star: star.named,
        viaClause,
        viaStar,
        viaNamespace: viaNamespace.named,
        redirected,
        virtual,
        viaVirtualReexport,
      }).toEqual({
        direct: "FROM_PLUGIN",
        star: "FROM_PLUGIN",
        viaClause: "FROM_PLUGIN",
        viaStar: "FROM_PLUGIN",
        viaNamespace: "FROM_PLUGIN",
        redirected: "REDIRECTED",
        virtual: "resolved-other",
        viaVirtualReexport: "resolved-thing",
      });
    });
  `;

  const pluginNamespaceFixture = {
    "bunfig.toml": `[test]\npreload = ["./plugin.ts"]\n`,
    "plugin.ts": `
      import { dirname, resolve } from "node:path";
      Bun.plugin({
        name: "query-loader",
        setup(build) {
          build.onResolve({ filter: /\\.bar\\?custom$/ }, args => ({
            path: resolve(dirname(args.importer), args.path.slice(0, -"?custom".length)),
            namespace: "custom",
          }));
          build.onLoad({ filter: /.*/, namespace: "custom" }, () => ({
            contents: 'export const named = "FROM_PLUGIN"; export default "FROM_PLUGIN";',
            loader: "js",
          }));
          // No namespace: the record stays a plain file path.
          build.onResolve({ filter: /\\.bar\\?redirect$/ }, args => ({
            path: resolve(dirname(args.importer), "redirected.ts"),
          }));
          build.onResolve({ filter: /.*/, namespace: "virt" }, args => ({
            path: "resolved-" + args.path,
            namespace: "virt",
          }));
          build.onLoad({ filter: /.*/, namespace: "virt" }, args => ({
            contents: "export default " + JSON.stringify(args.path) + ";",
            loader: "js",
          }));
        },
      });
    `,
    "data.bar": "unused",
    "redirected.ts": `export default "REDIRECTED";`,
    "reexport-clause.ts": `export { named } from "./data.bar?custom";`,
    "reexport-star.ts": `export * from "./data.bar?custom";`,
    "reexport-namespace.ts": `export * as ns from "./data.bar?custom";`,
    "reexport-virtual.ts": `export { default as virtual } from "virt:thing";`,
    "a.test.ts": pluginNamespaceTestFile,
    "b.test.ts": pluginNamespaceTestFile,
  };

  test.each([
    ["--isolate", ["--isolate"], {}],
    // One worker takes both files (scale-up gated), so the second file links from the records the first one cached.
    ["--parallel worker", ["--parallel=2"], { BUN_TEST_PARALLEL_SCALE_MS: "60000" }],
  ])("cached module records keep the namespace a plugin onResolve gives an import (%s)", async (_, args, env) => {
    using dir = tempDir("isolate-plugin-namespace", pluginNamespaceFixture);
    const { stderr, exitCode } = await runTests(String(dir), args, ["./a.test.ts", "./b.test.ts"], {
      ...bunEnv,
      ...env,
    });
    expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
    expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  // The on-disk transpiler cache stores the module record next to the output. reexport-clause.ts
  // is padded past the 4 KiB floor of that cache, so the second run rebuilds its record from the entry.
  test("with --isolate, the on-disk transpiler cache keeps that namespace in the stored module record", async () => {
    using dir = tempDir("isolate-plugin-namespace-disk-cache", {
      ...pluginNamespaceFixture,
      "reexport-clause.ts": `export { named } from "./data.bar?custom";\n//${Buffer.alloc(5 * 1024, "f").toString()}\n`,
    });
    const cacheDir = join(String(dir), ".cache");
    const env = {
      ...bunEnv,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: cacheDir,
      BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
    };
    for (const run of ["cold", "warm"]) {
      const { stderr, exitCode } = await runTests(String(dir), ["--isolate"], ["./a.test.ts", "./b.test.ts"], env);
      expect(normalizeBunSnapshot(stderr, dir), run).toContain("2 pass");
      expect(normalizeBunSnapshot(stderr, dir), run).toContain("0 fail");
      expect(fs.readdirSync(cacheDir), run).toHaveLength(1);
      expect(exitCode, run).toBe(0);
    }
  });

  test("with --isolate, leaked outbound socket is closed before next file", async () => {
    using dir = tempDir("isolate-socket", {
      "a-connect.test.ts": `
        import { test, expect } from "bun:test";
        import net from "node:net";

        test("leak a net.Socket", async () => {
          const port = Number(process.env.PORT!);
          const sock = net.connect(port, "127.0.0.1");
          await new Promise<void>((resolve, reject) => {
            sock.once("connect", () => resolve());
            sock.once("error", reject);
          });
          expect(sock.readyState).toBe("open");
          // intentionally not closing sock
        });
      `,
      "b-check.test.ts": `
        import { test, expect } from "bun:test";
        import fs from "node:fs";

        test("server saw the disconnect", async () => {
          const closeFile = process.env.CLOSE_FILE!;
          for (let i = 0; i < 200; i++) {
            if (fs.existsSync(closeFile)) break;
            await Bun.sleep(10);
          }
          expect(fs.existsSync(closeFile)).toBe(true);
        });
      `,
    });

    const closeFile = String(dir) + "/closed.txt";

    const server = net.createServer(sock => {
      sock.on("close", () => fs.writeFileSync(closeFile, "1"));
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as any).port;

    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--isolate", "./a-connect.test.ts", "./b-check.test.ts"],
        env: { ...bunEnv, PORT: String(port), CLOSE_FILE: closeFile },
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
      expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
      expect(exitCode).toBe(0);
    } finally {
      server.close();
    }
  });

  test("with --isolate, what a leaked listener's close handler opens is closed before next file", async () => {
    using dir = tempDir("isolate-close-handler", {
      "a-listen.test.ts": `
        import { test, expect } from "bun:test";
        import fs from "node:fs";

        test("leak a listener whose close handler binds a UDP socket", async () => {
          const { promise: accepted, resolve } = Promise.withResolvers<void>();
          const listener = Bun.listen({
            hostname: "127.0.0.1",
            port: 0,
            socket: {
              open() { resolve(); },
              data() {},
              async close() {
                // Not in any socket group: only its owner's context closes it.
                const late = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
                fs.writeFileSync(process.env.PORT_FILE!, String(late.port));
              },
            },
          });
          await Bun.connect({ hostname: "127.0.0.1", port: listener.port, socket: { data() {} } });
          await accepted;
          // intentionally leaving both open
        });
      `,
      "b-check.test.ts": `
        import { test, expect } from "bun:test";
        import fs from "node:fs";

        test("the late socket's port is free again", async () => {
          const port = Number(fs.readFileSync(process.env.PORT_FILE!, "utf8"));
          expect(port).toBeGreaterThan(0);
          const socket = await Bun.udpSocket({ hostname: "127.0.0.1", port });
          try {
            expect(socket.port).toBe(port);
          } finally {
            socket.close();
          }
        });
      `,
    });

    const { stderr, exitCode } = await runTests(
      String(dir),
      ["--isolate"],
      ["./a-listen.test.ts", "./b-check.test.ts"],
      { ...bunEnv, PORT_FILE: join(String(dir), "port.txt") },
    );
    expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
    expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  // The dial is still connecting when the swap closes it. Its owner keeps a pointer to the native
  // socket, and a connection timeout armed, until it hears that the dial failed.
  const redialWithBunConnect = (hostname: string) => `
    const dial = (socket: any) => Bun.connect({ hostname: "${hostname}", port, socket: { data() {}, ...socket } });
    // Every failed dial dials again, and the swap still ends.
    const redial = () =>
      dial({ open() { entered("open"); }, connectError() { entered("connectError"); redial(); } }).catch(() => {});
    await dial({ close: redial });
  `;
  const redialWithSQL = (scheme: string) => `
    const pool = (options = {}) => new Bun.SQL({ url: "${scheme}://u@127.0.0.1:" + port + "/db", max: 1, ...options });
    const first = pool();
    await first.connect();
    // Never answered: rejected when the swap closes its connection.
    first\`select 1\`.catch(() => pool({ connectionTimeout: timeout / 1000 })\`select 1\`.catch(() => {}));
  `;
  // `serve` gets a client as far as connected, and answers nothing after that.
  test.each([
    { client: "Bun.connect to an address", serve: undefined, leak: redialWithBunConnect("127.0.0.1") },
    { client: "Bun.connect to a name", serve: undefined, leak: redialWithBunConnect("localhost") },
    {
      client: "RedisClient",
      serve: (sock: net.Socket) => void sock.once("data", () => sock.write("+OK\r\n")),
      leak: `
        const dial = (options = {}) =>
          new Bun.RedisClient("redis://127.0.0.1:" + port, { autoReconnect: false, ...options });
        const first = dial();
        first.onclose = () => {
          dial({ connectionTimeout: timeout }).connect().catch(() => {});
        };
        await first.connect();
      `,
    },
    {
      client: "Postgres SQL",
      serve: (sock: net.Socket) =>
        void sock.once("data", () => sock.write(Buffer.concat([pgAuthenticationOk(), pgReadyForQuery()]))),
      leak: redialWithSQL("postgres"),
    },
    {
      client: "MySQL SQL",
      serve: (sock: net.Socket) => {
        sock.write(mysqlHandshakeV10());
        // Byte 3 of a packet is its sequence number.
        sock.on("data", (packet: Buffer) => !packet.includes("select 1") && sock.write(mysqlOkPacket(packet[3] + 1)));
      },
      leak: redialWithSQL("mysql"),
    },
  ])(
    "with --isolate, what a leaked $client's close handler dials is gone before next file",
    async ({ serve, leak }) => {
      const shared = `
      const port = Number(process.env.PORT!);
      // Of the dial the close handler makes only: nothing that has to succeed is timed.
      const timeout = 200;
    `;
      using dir = tempDir("isolate-redial", {
        "a-redial.test.ts": `
        import { test } from "bun:test";
        import fs from "node:fs";
        ${shared}
        test("leak a client that dials again when it is closed", async () => {
          const entered = (handler: string) => fs.appendFileSync(process.env.ENTERED_FILE!, handler + "\\n");
          ${leak}
        });
      `,
        "b-check.test.ts": `
        import { test, expect } from "bun:test";
        import fs from "node:fs";
        ${shared}
        test("nothing of the previous file acts on this one", async () => {
          // One of these takes the memory of a native socket the swap freed, so closing that
          // socket again does not go unnoticed.
          const junk = Array.from({ length: 1 << 14 }, (_, i) => Buffer.alloc(80, String(i)).toString());
          // Armed after the leaked client's connection timeout with the same delay, so it fires later.
          await new Promise(resolve => setTimeout(resolve, timeout));
          expect(junk).toHaveLength(1 << 14);
          expect(fs.existsSync(process.env.ENTERED_FILE!)).toBe(false);
        });
      `,
      });

      const server = net.createServer(sock => {
        sock.on("error", () => {});
        serve?.(sock);
      });
      await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));

      try {
        const { stderr, exitCode } = await runTests(
          String(dir),
          ["--isolate"],
          ["./a-redial.test.ts", "./b-check.test.ts"],
          {
            ...bunEnv,
            PORT: String((server.address() as net.AddressInfo).port),
            ENTERED_FILE: join(String(dir), "entered.txt"),
            // A Bun.connect socket has no timer: its finalizer is what closes the native socket again.
            ...(isASAN && { BUN_DESTRUCT_VM_ON_EXIT: "1" }),
          },
        );
        expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
        expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
        expect(exitCode).toBe(0);
      } finally {
        server.close();
      }
    },
  );

  test("with --isolate, the default DNS resolver answers in every file, not only the first", async () => {
    // The resolver is the VM's, and each file's queries open its channel anew.
    using dir = tempDir("isolate-dns", {
      "a-resolve.test.ts": `
        import { test, expect } from "bun:test";
        import dns from "node:dns";

        test("a query through the default resolver is answered", async () => {
          // A DNS server that answers every query with NXDOMAIN.
          const server = await Bun.udpSocket({
            hostname: "127.0.0.1",
            port: 0,
            socket: {
              data(socket, query, port, address) {
                const reply = Buffer.from(query);
                reply[2] |= 0x80;
                reply[3] = (reply[3] & 0xf0) | 3;
                socket.send(reply, port, address);
              },
            },
          });
          try {
            dns.setServers(["127.0.0.1:" + server.port]);
            const outcome = await dns.promises.resolve4("isolate-dns.test").then(() => "resolved", error => error.code);
            expect(outcome).toBe("ENOTFOUND");
          } finally {
            server.close();
          }
        });
      `,
      "b-resolve.test.ts": `
        import { test, expect } from "bun:test";
        import dns from "node:dns";

        test("a query through the default resolver is answered", async () => {
          // A DNS server that answers every query with NXDOMAIN.
          const server = await Bun.udpSocket({
            hostname: "127.0.0.1",
            port: 0,
            socket: {
              data(socket, query, port, address) {
                const reply = Buffer.from(query);
                reply[2] |= 0x80;
                reply[3] = (reply[3] & 0xf0) | 3;
                socket.send(reply, port, address);
              },
            },
          });
          try {
            dns.setServers(["127.0.0.1:" + server.port]);
            const outcome = await dns.promises.resolve4("isolate-dns.test").then(() => "resolved", error => error.code);
            expect(outcome).toBe("ENOTFOUND");
          } finally {
            server.close();
          }
        });
      `,
      "c-resolve.test.ts": `
        import { test, expect } from "bun:test";
        import dns from "node:dns";

        test("a query through the default resolver is answered", async () => {
          // A DNS server that answers every query with NXDOMAIN.
          const server = await Bun.udpSocket({
            hostname: "127.0.0.1",
            port: 0,
            socket: {
              data(socket, query, port, address) {
                const reply = Buffer.from(query);
                reply[2] |= 0x80;
                reply[3] = (reply[3] & 0xf0) | 3;
                socket.send(reply, port, address);
              },
            },
          });
          try {
            dns.setServers(["127.0.0.1:" + server.port]);
            const outcome = await dns.promises.resolve4("isolate-dns.test").then(() => "resolved", error => error.code);
            expect(outcome).toBe("ENOTFOUND");
          } finally {
            server.close();
          }
        });
      `,
    });

    const { stderr, exitCode } = await runTests(
      String(dir),
      ["--isolate"],
      ["./a-resolve.test.ts", "./b-resolve.test.ts", "./c-resolve.test.ts"],
      bunEnv,
    );
    expect(normalizeBunSnapshot(stderr, dir)).toContain("3 pass");
    expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("with --isolate, leaked fs.watch is closed before next file", async () => {
    using dir = tempDir("isolate-fswatch", {
      "watched/.keep": "",
      "a-watch.test.ts": `
        import { test, expect } from "bun:test";
        import fs from "node:fs";

        test("leak an fs.watch", () => {
          const w = fs.watch(process.env.WATCH_DIR!, () => {
            fs.writeFileSync(process.env.FIRE_FILE!, "fired");
          });
          w.unref();
          expect(w).toBeTruthy();
          // intentionally not calling w.close()
        });
      `,
      "b-mutate.test.ts": `
        import { test, expect } from "bun:test";
        import fs from "node:fs";

        test("watcher from prior file does not fire", async () => {
          fs.writeFileSync(process.env.WATCH_DIR! + "/poke.txt", String(Date.now()));
          // Poll for up to 500ms; if the leaked watcher fires at any point in
          // this window the regression is caught (avoids a false pass when a
          // slow runner delivers the event after a fixed sleep).
          for (let i = 0; i < 25; i++) {
            if (fs.existsSync(process.env.FIRE_FILE!)) break;
            await Bun.sleep(20);
          }
          expect(fs.existsSync(process.env.FIRE_FILE!)).toBe(false);
        });
      `,
    });

    const watchDir = String(dir) + "/watched";
    const fireFile = String(dir) + "/fired.txt";

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "./a-watch.test.ts", "./b-mutate.test.ts"],
      env: { ...bunEnv, WATCH_DIR: watchDir, FIRE_FILE: fireFile },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
    expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("with --isolate, leaked vi.useFakeTimers() is deactivated before next file", async () => {
    // Fake-timer state lives in the per-thread timer heap, not the JS global,
    // so a file that activates vi.useFakeTimers() and never restores real
    // timers (e.g. an it.failing that throws before useRealTimers()) used to
    // route the next file's setTimeout into the never-driven fake heap.
    // net.Server.listen() fires 'listening' via setTimeout, so such a file
    // would hang until its per-test timeout.
    const fakeTimerFixtures = {
      "a-fake.test.ts": `
        import { test, vi } from "bun:test";
        test("leak fake timers", () => {
          vi.useFakeTimers();
          setTimeout(() => {}, 1000);
          AbortSignal.timeout(1000);
          // intentionally never calling vi.useRealTimers()
        });
      `,
      "b-real.test.ts": `
        import { test, expect } from "bun:test";
        import { createServer } from "node:net";
        test("setTimeout fires and net.Server 'listening' emits", async () => {
          const fired = await new Promise<boolean>(resolve => {
            setTimeout(() => resolve(true), 1);
          });
          expect(fired).toBe(true);

          const server = createServer();
          const listened = await new Promise<boolean>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => resolve(true));
          });
          server.close();
          expect(listened).toBe(true);
        });
      `,
    };
    const files = ["./a-fake.test.ts", "./b-real.test.ts"];

    using isolated = tempDir("isolate-fake-timers", fakeTimerFixtures);
    const serial = await runTests(String(isolated), ["--isolate", "--timeout=5000"], files);
    expect(normalizeBunSnapshot(serial.stderr, isolated)).toContain("2 pass");
    expect(normalizeBunSnapshot(serial.stderr, isolated)).toContain("0 fail");
    expect(serial.exitCode).toBe(0);

    // One worker takes both files (scale-up gated) so the same reset runs
    // between files inside a --parallel worker.
    using parallel = tempDir("isolate-fake-timers-parallel", fakeTimerFixtures);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=2", "--timeout=5000", ...files],
      env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "60000" },
      cwd: String(parallel),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr, parallel)).toContain("2 pass");
    expect(normalizeBunSnapshot(stderr, parallel)).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  // Close handlers for sockets a file leaves open are the last of that file's JS to run.
  test.each(["--isolate", "--parallel=1"])(
    "timers faked by a finished file's close handler are real in the next file: bun test %s",
    async flag => {
      using dir = tempDir("isolate-fake-timers-close-handler", {
        "a.test.ts": `
          import { test, vi } from "bun:test";
          test("leaves sockets open", async () => {
            let isFaked = false;
            const close = () => {
              // Again, it would settle the call that is in flight.
              if (isFaked) return;
              isFaked = true;
              vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "setImmediate", "nextTick", "queueMicrotask", "Date"] });
              process.nextTick(() => console.log("a: tick"));
              queueMicrotask(() => console.log("a: microtask"));
              setImmediate(() => console.log("a: immediate"));
              setTimeout(() => console.log("a: timeout"), 5);
              vi.advanceTimersByTimeAsync(100).then(() => console.log("a: settled"));
              vi.setTimerTickMode("nextTimerAsync");
            };
            const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {}, close } });
            await Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data() {}, close } });
          });
        `,
        "b.test.ts": `
          import { afterEach, expect, test, vi } from "bun:test";
          const atTheTop = { setTimeout, isFake: vi.isFakeTimers(), date: Date.now() };
          afterEach(() => void vi.useRealTimers());
          test("nothing is faked", () => {
            expect({ ...atTheTop, date: atTheTop.date > 1e12 }).toEqual({ setTimeout, isFake: false, date: true });
          });
          test("useRealTimers() has left the functions of this file's realm", async () => {
            expect(setTimeout).toBe(atTheTop.setTimeout);
            expect(Object.getPrototypeOf(setTimeout)).toBe(Function.prototype);
            for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 1));
          });
        `,
      });
      const { stdout, stderr, exitCode } = await runTests(String(dir), [flag], ["./a.test.ts", "./b.test.ts"]);
      expect({
        stdout: stdout.replace(/^bun test .*\n/, ""),
        counts: stderr.match(/^ \d+ (pass|fail)$/gm),
        exitCode,
      }).toEqual({ stdout: "", counts: [" 3 pass", " 0 fail"], exitCode: 0 });
    },
  );

  // Work started from a finished file's close handler is still in flight when the file's realm is retired.
  test.each([
    ["a ShadowRealm", "new ShadowRealm().evaluate(code)"],
    ["a node:vm context", "vm.runInContext(code, vm.createContext({ console }))"],
    [
      "a node:vm context without a sandbox",
      "vm.runInContext(code, Object.assign(vm.createContext(vm.constants.DONT_CONTEXTIFY), { console }))",
    ],
  ])("with --isolate, work a file leaves in flight in %s doesn't continue in the next file", async (_, evaluate) => {
    using dir = tempDir("isolate-derived-realm", {
      "a.test.ts": `
        import { test } from "bun:test";
        import vm from "node:vm";
        const code = \`
          Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(8)), 0, 0, 1).value.then(() => {
            console.log("a: goes on");
            throw new Error("from a");
          });
          0;
        \`;
        test("leaves sockets open", async () => {
          let isClosed = false;
          const close = () => {
            if (isClosed) return;
            isClosed = true;
            ${evaluate};
          };
          const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {}, close } });
          await Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { data() {}, close } });
        });
      `,
      "b.test.ts": `
        import { test } from "bun:test";
        test("waits longer than what a left", async () => {
          await Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(8)), 0, 0, 1).value;
          await new Promise(resolve => setImmediate(resolve));
        });
      `,
    });
    const { stdout, stderr, exitCode } = await runTests(String(dir), ["--isolate"], ["./a.test.ts", "./b.test.ts"]);
    expect({
      stdout: stdout.replace(/^bun test .*\n/, ""),
      counts: stderr.match(/^ \d+ (pass|fail|error)$/gm),
      exitCode,
    }).toEqual({ stdout: "", counts: [" 2 pass", " 0 fail"], exitCode: 0 });
  });

  test.each(isolateFlags)(
    "with %s, a BroadcastChannel left open in a ShadowRealm stops receiving messages",
    async isolate => {
      using dir = tempDir("isolate-derived-realm-channel", {
        "a.test.ts": `
        import { test } from "bun:test";
        test("leaves a channel open", () => {
          new ShadowRealm().evaluate(\`
            globalThis.channel = new BroadcastChannel("isolate-derived-realm");
            channel.onmessage = () => {
              console.log("a: goes on");
              Promise.reject(new Error("from a"));
            };
            0;
          \`);
        });
      `,
        "b.test.ts": `
        import { test } from "bun:test";
        test("posts to the channel", async () => {
          const receiver = new BroadcastChannel("isolate-derived-realm");
          const sender = new BroadcastChannel("isolate-derived-realm");
          const received = new Promise(resolve => (receiver.onmessage = resolve));
          sender.postMessage(1);
          await received;
          receiver.close();
          sender.close();
          await new Promise(resolve => setImmediate(resolve));
        });
      `,
      });
      const { stdout, stderr, exitCode } = await runTests(String(dir), [isolate], ["./a.test.ts", "./b.test.ts"]);
      expect({
        stdout: stdout.replace(/^bun test .*\n/, ""),
        counts: stderr.match(/^ \d+ (pass|fail|error)$/gm),
        exitCode,
      }).toEqual({ stdout: "", counts: [" 2 pass", " 0 fail"], exitCode: 0 });
    },
  );

  describe("no root reaches the global object of a finished file", () => {
    const shadowRealm = `globalThis.realm = new ShadowRealm(); realm.evaluate("1");`;
    const context = `globalThis.context = vm.createContext({ kept }); vm.runInContext("1", context);`;
    const bareContext = `globalThis.bareContext = vm.createContext(vm.constants.DONT_CONTEXTIFY); bareContext.kept = kept;`;
    const channel = `new ShadowRealm().evaluate('globalThis.channel = new BroadcastChannel("kept"); channel.onmessage = () => {}; 0');`;

    describe.each([
      ["nothing", ""],
      ["a ShadowRealm", shadowRealm],
      ["a node:vm context", context],
      ["a node:vm context without a sandbox", bareContext],
      ["a BroadcastChannel in a ShadowRealm", channel],
      ["all of them", shadowRealm + context + bareContext + channel],
    ])("that makes %s", (_, make) => {
      test.each([3, 12, 48])("%d files", async count => {
        const files: Record<string, string> = {};
        for (let file = 0; file < count; file++) {
          files[`${String(file).padStart(2, "0")}.test.ts`] = `
            import { test } from "bun:test";
            import vm from "node:vm";
            globalThis.kept = Array.from({ length: 100 }, () => new URLSearchParams());
            test("makes it", () => {
              ${make}
            });
          `;
        }
        files["counts.test.ts"] = `
          import { generateHeapSnapshotForDebugging } from "bun:jsc";
          import { test } from "bun:test";
          ${Heap}
          globalThis.kept = Array.from({ length: 7 }, () => new URLSearchParams());
          let heap;
          test("counts", async () => {
            heap = new Promise(resolve => setTimeout(() => resolve(new Heap({ followers: false })), 0));
            heap = await heap;
            console.log(
              JSON.stringify({
                globals: heap.pathsTo("GlobalObject"),
                contexts: heap.pathsTo("NodeVMGlobalObject"),
                kept: heap.pathsTo("URLSearchParams").length,
              }),
            );
          });
        `;
        using dir = tempDir("isolate-collects-globals", files);
        const { stdout, stderr, exitCode } = await runTests(
          String(dir),
          ["--isolate"],
          Object.keys(files).map(file => "./" + file),
          // An in-flight JIT compilation roots the code it compiles, which would show up in the snapshot.
          { ...bunEnv, BUN_JSC_useConcurrentJIT: "0" },
        );
        const printed = stdout.replace(/^bun test .*\n/, "");
        expect(printed, stderr).toStartWith("{");
        // Only counts.test.ts is left. kept is 9 for its 7 URLSearchParams plus their prototype and constructor.
        expect({ ...JSON.parse(printed), exitCode }).toEqual({
          globals: ["root(ProtectedValues) GlobalObject"],
          contexts: [],
          kept: 9,
          exitCode: 0,
        });
      });
    });
  });

  // On debug builds `vm.global().set_time_zone()` temporaries in `TestCommand::exec`'s frame keep the first file alive.
  test.skipIf(isDebug)(
    "with --isolate, only the last two finished files can still be waiting for garbage collection",
    async () => {
      // File i keeps 16 * 2 ** i URLSearchParams on its global, so the live count is a bitmask of the live files.
      const keep = (file: number) =>
        `globalThis.kept = Array.from({ length: ${16 * 2 ** file} }, () => new URLSearchParams());`;
      const files: Record<string, string> = {};
      for (let file = 0; file < 12; file++) {
        files[`${String(file).padStart(2, "0")}.test.ts`] = `
          import { test } from "bun:test";
          ${keep(file)}
          test("passes", () => {});
        `;
      }
      files["counts.test.ts"] = `
        import { generateHeapSnapshotForDebugging, heapStats } from "bun:jsc";
        import { test } from "bun:test";
        ${Heap}
        ${keep(12)}
        test("counts", async () => {
          const filesOf = count => Array.from({ length: 13 }, (_, file) => file).filter(file => (count >> 4) & (1 << file));
          let alive, rounds = 0;
          // Only what stays alive counts.
          do {
            Bun.gc(true);
            await new Promise(resolve => setTimeout(resolve, 1));
            alive = filesOf(heapStats().objectTypeCounts.URLSearchParams);
          } while (++rounds < 20 && alive.some(file => file < 10));
          // A word that an earlier call left in a slot of a live native frame can keep a file alive. Bun holds what a root reaches.
          const isOld = file => file < 10;
          const held = alive.some(isOld) ? filesOf(new Heap().counts(["URLSearchParams"]).URLSearchParams) : alive;
          console.log(JSON.stringify({ alive, held }));
        }, 60_000);
      `;
      using dir = tempDir("isolate-collects-globals", files);
      const { stdout, stderr, exitCode } = await runTests(
        String(dir),
        ["--isolate"],
        Object.keys(files).map(file => "./" + file),
      );
      const printed = stdout.replace(/^bun test .*\n/, "");
      expect(printed, stderr).toStartWith("{");
      const { alive, held }: Record<"alive" | "held", number[]> = JSON.parse(printed);
      expect({
        theFileThatCounts: held.includes(12),
        heldLongAfterItsEnd: held.filter(file => file < 10),
        exitCode,
      }).toEqual({ theFileThatCounts: true, heldLongAfterItsEnd: [], exitCode: 0 });
      // A leak that the snapshot can't see keeps all ten. A stray word keeps one file, and which words are left depends on the build.
      expect(alive.filter(file => file < 10).length).toBeLessThan(5);
    },
  );

  // --rerun-each runs of a file share one global, even with --isolate.
  test.each(["--rerun-each=3", "--isolate --rerun-each=3", "--parallel=1 --rerun-each=3"])(
    "every run of a file starts with nothing mocked: bun test %s",
    async flags => {
      using dir = tempDir("rerun-each-starts-clean", {
        "dep.ts": `export const f = () => "real";`,
        "a.test.ts": `
          import { mock, test, vi } from "bun:test";
          import { f } from "./dep.ts";
          console.log(
            JSON.stringify({
              isFake: vi.isFakeTimers(),
              isNow: Date.now() > 1e12,
              env: process.env.STUBBED ?? null,
              global: typeof stubbed,
              f: f(),
            }),
          );
          await new Promise(resolve => setTimeout(resolve, 1));
          test("mocks", () => {
            vi.useFakeTimers({ now: 1000 });
            vi.stubEnv("STUBBED", "1");
            vi.stubGlobal("stubbed", 1);
            mock.module("./dep.ts", () => ({ f: () => "mocked" }));
          });
        `,
      });
      const { stdout, stderr, exitCode } = await runTests(String(dir), flags.split(" "), ["./a.test.ts"]);
      expect({
        loads: stdout
          .split("\n")
          .filter(line => line.startsWith("{"))
          .map(line => JSON.parse(line)),
        counts: stderr.match(/^ \d+ (pass|fail)$/gm),
        exitCode,
      }).toEqual({
        loads: Array(3).fill({ isFake: false, isNow: true, env: null, global: "undefined", f: "real" }),
        counts: [" 3 pass", " 0 fail"],
        exitCode: 0,
      });
    },
  );

  test.each(isolateFlags)("with %s, a leaked monitorEventLoopDelay() is disabled before next file", async isolate => {
    // The monitor is per thread while its histogram belongs to the file's
    // global. A file that enables it and never disables it used to leave the
    // monitor recording into the collected histogram of the retired global for
    // the rest of the run. Two things are observable from the next file: a
    // fresh histogram that reuses the freed cell receives the stale records,
    // and the next file's own enable() is a no-op because the monitor is still
    // marked enabled, so its histogram never records anything.
    const monitorFixtures = {
      "a-monitor.test.ts": `
        import { test, expect } from "bun:test";
        import { monitorEventLoopDelay } from "node:perf_hooks";
        test("leak an enabled monitor", () => {
          expect(monitorEventLoopDelay({ resolution: 1 }).enable()).toBe(true);
          // intentionally never calling disable()
        });
      `,
      "b-histogram.test.ts": `
        import { test, expect } from "bun:test";
        import { createHistogram, monitorEventLoopDelay } from "node:perf_hooks";
        test("previous file's monitor is gone and this file's own works", async () => {
          // Collect file A's histogram first so a decoy below lands in its cell.
          Bun.gc(true);
          const decoys = Array.from({ length: 8 }, () => createHistogram());

          const own = monitorEventLoopDelay({ resolution: 1 });
          expect(own.enable()).toBe(true);
          const deadline = Date.now() + 5000;
          while (own.count === 0 && Date.now() < deadline) {
            // Stall the loop, then yield so the monitor's timer can measure it.
            const until = Date.now() + 10;
            while (Date.now() < until) {}
            await Bun.sleep(2);
          }
          own.disable();

          expect(decoys.map(h => h.count)).toEqual(decoys.map(() => 0));
          expect(own.count).toBeGreaterThan(0);
        });
      `,
    };
    const files = ["./a-monitor.test.ts", "./b-histogram.test.ts"];

    using isolated = tempDir("isolate-event-loop-delay", monitorFixtures);
    const serial = await runTests(String(isolated), [isolate, "--timeout=10000"], files);
    expect(normalizeBunSnapshot(serial.stderr, isolated)).toContain("2 pass");
    expect(normalizeBunSnapshot(serial.stderr, isolated)).toContain("0 fail");
    expect(serial.exitCode).toBe(0);

    // One worker takes both files (scale-up gated) so the same sweep runs
    // between files inside a --parallel worker.
    using parallel = tempDir("isolate-event-loop-delay-parallel", monitorFixtures);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--parallel=2", "--timeout=10000", ...files],
      env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "60000" },
      cwd: String(parallel),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr, parallel)).toContain("2 pass");
    expect(normalizeBunSnapshot(stderr, parallel)).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("leaked subprocesses are killed for every isolated file, not just the first", async () => {
    using dir = tempDir("isolate-subprocess", {
      "a-spawn.test.ts": `
        import { test, expect } from "bun:test";
        import fs from "node:fs";
        test("leak a sleeper from file A", () => {
          const child = Bun.spawn({ cmd: [process.execPath, "-e", "setInterval(()=>{}, 1e6)"], stdout: "ignore", stderr: "ignore" });
          fs.writeFileSync(process.env.PID_FILE_A!, String(child.pid));
          expect(child.pid).toBeGreaterThan(0);
        });
      `,
      "b-spawn.test.ts": `
        import { test, expect } from "bun:test";
        import fs from "node:fs";
        test("leak a sleeper from file B", () => {
          const child = Bun.spawn({ cmd: [process.execPath, "-e", "setInterval(()=>{}, 1e6)"], stdout: "ignore", stderr: "ignore" });
          fs.writeFileSync(process.env.PID_FILE_B!, String(child.pid));
          expect(child.pid).toBeGreaterThan(0);
        });
      `,
      "c-check.test.ts": `
        import { test, expect } from "bun:test";
        import fs from "node:fs";
        const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
        test("both prior subprocesses were killed by isolation", async () => {
          const pidA = Number(fs.readFileSync(process.env.PID_FILE_A!, "utf8"));
          const pidB = Number(fs.readFileSync(process.env.PID_FILE_B!, "utf8"));
          // auto_killer sends SIGTERM at swap; allow a moment for the OS to reap.
          for (let i = 0; i < 50 && (isAlive(pidA) || isAlive(pidB)); i++) await Bun.sleep(20);
          expect(isAlive(pidA)).toBe(false);
          expect(isAlive(pidB)).toBe(false);
        });
      `,
    });

    const pidA = String(dir) + "/pid-a.txt";
    const pidB = String(dir) + "/pid-b.txt";

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "./a-spawn.test.ts", "./b-spawn.test.ts", "./c-check.test.ts"],
      env: { ...bunEnv, PID_FILE_A: pidA, PID_FILE_B: pidB },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr, dir)).toContain("3 pass");
    expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  // Every file spawns a sleeper at module scope (outside any test or hook),
  // appends its pid to a shared log, and its test asserts that the sleepers
  // logged by the files that ran before it are gone. The first file's sleeper
  // is always killed; the third file is what proves the second file's
  // module-scope sleeper was killed at its isolation swap too. Holds in any
  // file order, so the same fixture covers a --parallel worker running
  // several files.
  const moduleScopeSpawnFile = `
    import { test, expect } from "bun:test";
    import fs from "node:fs";
    const log = process.env.PID_LOG!;
    const earlier = fs.readFileSync(log, "utf8").split("\\n").filter(Boolean).map(Number);
    const child = Bun.spawn({ cmd: [process.execPath, "-e", "setInterval(()=>{}, 1e6)"], stdout: "ignore", stderr: "ignore" });
    fs.appendFileSync(log, child.pid + "\\n");
    const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    test("module-scope sleepers of the files before this one were killed", async () => {
      // The swap sends SIGTERM; the sleeper may still be getting reaped.
      const deadline = Date.now() + 2_000;
      while (earlier.some(isAlive) && Date.now() < deadline) await Bun.sleep(10);
      expect(earlier.filter(isAlive)).toEqual([]);
    });
  `;

  test.each([
    ["--isolate", ["--isolate"], {}],
    // One worker takes all three files (scale-up gated), so the worker's
    // per-file swap is what has to kill the second and third sleepers.
    ["--parallel worker", ["--parallel=2"], { BUN_TEST_PARALLEL_SCALE_MS: "60000" }],
  ])("module-scope subprocesses are killed for every isolated file, not just the first (%s)", async (_, args, env) => {
    using dir = tempDir("isolate-module-scope-subprocess", {
      "a.test.ts": moduleScopeSpawnFile,
      "b.test.ts": moduleScopeSpawnFile,
      "c.test.ts": moduleScopeSpawnFile,
      "pids.txt": "",
    });
    const log = join(String(dir), "pids.txt");
    const loggedPids = () => fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", ...args, "./a.test.ts", "./b.test.ts", "./c.test.ts"],
        env: { ...bunEnv, ...env, PID_LOG: log },
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(normalizeBunSnapshot(stderr, dir)).toContain("3 pass");
      expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
      expect(loggedPids()).toHaveLength(3);
      expect(exitCode).toBe(0);
    } finally {
      // Nothing swaps after the last file of a serial run, so its sleeper is
      // ours to kill, as is anything an unfixed runner leaked.
      for (const pid of loggedPids()) {
        try {
          process.kill(Number(pid));
        } catch {}
      }
    }
  });
});

// --isolate raises JSC's FTL warm-up threshold. JSC options are set once per
// process, by whoever initializes JSC first. The [install] hoist patterns are
// regexes, and compiling them while bunfig.toml loaded used to initialize JSC
// with the default options before `bun test` could pass its own.
describe.concurrent("bun test --isolate=modules", () => {
  const passes = async (files: Record<string, string>, pass: number, args: string[] = []) => {
    using dir = tempDir("isolate-modules", files);
    const names = Object.keys(files)
      .filter(name => name.includes(".test."))
      .map(name => "./" + name);
    const { stdout, stderr, exitCode } = await runTests(String(dir), ["--isolate=modules", ...args], names);
    expect(stderr).toContain(` ${pass} pass\n 0 fail\n`);
    expect(exitCode).toBe(0);
    return stdout;
  };

  test("what a file leaves open is closed, and what it put on globalThis is gone", async () => {
    await passes(fixtures, 2);
  });

  // onmessage, onerror and Error.prepareStackTrace are data properties to a script, with native code behind them. The
  // next file gets them back by a definition of the value they had, and that definition has to reach the native side.
  test("what a file stored in onmessage, onerror and Error.prepareStackTrace is gone for the next file", async () => {
    const stdout = await passes(
      {
        "a.test.js": `
          test("a", () => {
            Error.prepareStackTrace = () => "formatted by a";
            globalThis.onmessage = event => console.log("a's onmessage got " + event.data);
            globalThis.onerror = event => console.log("a's onerror got " + event.error);
          });
        `,
        "b.test.js": `
          test("b", () => {
            const lines = [new Error("of b").stack.split("\\n")[0], String(onmessage), String(onerror)];
            dispatchEvent(new MessageEvent("message", { data: "for nobody" }));
            dispatchEvent(new ErrorEvent("error", { error: "for nobody" }));
            globalThis.onmessage = event => lines.push("b's onmessage got " + event.data);
            dispatchEvent(new MessageEvent("message", { data: "for b" }));
            globalThis.onmessage = null;
            Error.prepareStackTrace = () => "formatted by b";
            lines.push(new Error("of b").stack);
            console.log(JSON.stringify(lines));
          });
        `,
      },
      2,
    );
    expect(stdout.split("\n").filter(line => line.startsWith("[") || line.includes(" got "))).toEqual([
      `["Error: of b","null","null","b's onmessage got for b","formatted by b"]`,
    ]);
  });

  test("a zlib stream that a file left in the middle of a write becomes idle", async () => {
    await passes(
      {
        "a.test.js": `
          test("a", () => {
            const zlib = require("node:zlib");
            zlib.left = zlib.createDeflate({ chunkSize: 4 << 20 });
            zlib.left.write(require("node:crypto").randomBytes(2 << 20));
          });
        `,
        "b.test.js": `
          test("b", async () => {
            const { left } = require("node:zlib");
            for (const deadline = performance.now() + 15_000; ; await new Promise(setImmediate)) {
              try { return left.reset(); }
              catch (error) { if (!left || performance.now() > deadline) throw error; }
            }
          }, 20_000);
        `,
      },
      2,
    );
  });

  test("Bun.main, import.meta.main, process.argv and Bun.argv name the running file", async () => {
    const file = `
      import { basename } from "node:path";
      test("names", () => {
        const args = process.argv.slice(1).map(arg => basename(arg)).join();
        console.log(basename(Bun.main), import.meta.main, args, Bun.argv === process.argv);
        process.argv.push("--left");
      });
    `;
    const files = { "a.test.js": file, "b.test.js": file };
    const stdout = await passes(files, 2);
    expect(stdout).toContain("a.test.js true a.test.js true\nb.test.js true b.test.js true\n");
  });

  test("a file that throws while it loads is reported once", async () => {
    using dir = tempDir("isolate-modules-throws", {
      "a.test.js": `throw new Error("a throws while it loads");`,
      "b.test.js": `test("b", () => {});`,
    });
    const { stderr, exitCode } = await runTests(String(dir), ["--isolate=modules"], ["./a.test.js", "./b.test.js"]);
    expect(stderr.match(/^error: a throws while it loads$/gm)).toHaveLength(1);
    expect(stderr).toContain(" 1 pass\n 1 fail\n 1 error\n");
    expect(exitCode).toBe(1);
  });

  test("a file that never finishes loading is reported with the modules it is stuck on", async () => {
    using dir = tempDir("isolate-modules-stuck", {
      "a.test.js": `import "./stuck.js"; test("unreachable", () => {});`,
      "stuck.js": `await new Promise(() => {});`,
      "b.test.js": `test("b", () => {});`,
    });
    const { stderr, exitCode } = await runTests(String(dir), ["--isolate=modules"], ["./a.test.js", "./b.test.js"]);
    expect(stderr).toMatch(/error: ".*a\.test\.js" never finished loading/);
    expect(stderr).toMatch(/note: unsettled top-level await in ".*stuck\.js"/);
    expect(stderr).toContain(" 1 pass\n 1 fail\n");
    expect(exitCode).toBe(1);
  });

  test("each file has its own modules, mocks and preloads", async () => {
    const file = (name: string, mock: string, dep: string) => `
      import { expect, test, vi } from "vitest";
      import { createRequire } from "node:module";
      ${mock}
      import { inc } from "./state.js";
      import { uses } from "./uses.js";
      test("${name}", async () => {
        expect([inc(), inc(), createRequire(import.meta.url)("./state.cjs").inc(), uses()]).toEqual([1, 2, 1, "${dep}"]);
        expect((await import("./state.js")).inc).toBe(inc);
        expect([globalThis.hookRuns, import.meta.main]).toEqual([1, true]);
      });
    `;
    await passes(
      {
        "state.js": `let n = 0; export const inc = () => ++n;`,
        "state.cjs": `let n = 0; exports.inc = () => ++n;`,
        "dep.js": `export const dep = () => "real";`,
        "uses.js": `import { dep } from "./dep.js"; export const uses = () => dep();`,
        "preload.js": `
          import { beforeAll } from "bun:test";
          let runs = 0;
          beforeAll(() => void (globalThis.hookRuns = ++runs));
        `,
        "a.test.js": file("a", `vi.mock("./dep.js", () => ({ dep: () => "mock" }));`, "mock"),
        "b.test.js": file("b", "", "real"),
      },
      2,
      ["--preload", "./preload.js"],
    );
  });

  test("what a file did to the builtins, process.env and the listeners of process is undone", async () => {
    await passes(
      {
        "a.test.js": `
          test("a", () => {
            globalThis.fetch = () => {}; globalThis.structuredClone = undefined; Array.prototype.last = function () {}; console.error = () => {};
            Date.now = () => 0; delete Math.random; Promise.prototype.then = function () {}; Response.prototype.json = () => {}; Bun.sleep = () => {};
            process.exit = () => {}; process.env.ADDED = "1"; process.env.PATH = "x"; process.on("exit", () => {}); Error.stackTraceLimit = 1;
            // What the undoing itself might use.
            Object.prototype.get = () => {}; Reflect.ownKeys = () => []; Object.defineProperty = () => {}; Map.prototype.get = () => {}; Array.prototype.push = () => {};
          });
        `,
        "b.test.js": `
          const isNative = fn => String(fn).includes("[native code]");
          test("b", () => {
            expect([fetch, structuredClone, console.error, Date.now, Math.random, Promise.prototype.then, Response.prototype.json, Bun.sleep,
              Reflect.ownKeys, Object.defineProperty, Map.prototype.get, Array.prototype.push].map(isNative)).not.toContain(false);
            expect(["last" in Array.prototype, "get" in {}, process.exit.name, process.env.ADDED, process.env.PATH === "x", process.listenerCount("exit"), Error.stackTraceLimit > 1])
              .toEqual([false, false, "exit", undefined, false, 0, true]);
          });
        `,
      },
      2,
    );
  });

  test("every file finds the builtins as the first one did, whatever the files before it did to them", async () => {
    const state = `JSON.stringify([
      typeof Math.max, Math.PI, "extra" in Array.prototype.map, Array.prototype.map.name, Array.prototype[0], Object.keys(Math), process.title === title,
      typeof Object.getOwnPropertyDescriptor(Map.prototype, "size").get, typeof Object.getOwnPropertyDescriptor(Set.prototype, "size").set, Symbol.iterator in Number.prototype, JSON[Symbol.toStringTag], Object.keys(Array.prototype),
      Object.getOwnPropertyDescriptor(URL.prototype, "href").get.name, Reflect.ownKeys(Date).length, Reflect.ownKeys(Date.now).join(), typeof Bun.inspect,
    ])`;
    const change = [
      `delete Math.max; Array.prototype.map.extra = 1; Array.prototype[0] = "zero"; process.title = "changed";`,
      `Math.max = 1; Math.added = 1; Object.defineProperty(Set.prototype, "size", { set() {} }); delete Array.prototype.map.name; Number.prototype[Symbol.iterator] = function* () {};`,
      `Object.defineProperty(Map.prototype, "size", { value: 1 }); Object.defineProperty(URL.prototype, "href", { get() {} }); Date.now.extra = Date.extra = 1;`,
      `delete JSON[Symbol.toStringTag]; delete Math.max; Math.max = () => 0; Array.prototype.extra = 1; Bun.inspect = 1;`,
      ``,
    ];
    const files = Object.fromEntries(
      change.map((code, i) => [
        `${i}.test.js`,
        `const { title } = process; test("${i}", () => { console.log(${state}); ${code} });`,
      ]),
    );
    const lines = (await passes(files, change.length)).split("\n").filter(line => line.startsWith("["));
    expect(lines).toEqual(Array(change.length).fill(lines[0]));
    expect(JSON.parse(lines[0]).slice(0, 5)).toEqual(["function", Math.PI, false, "map", null]);
  });

  test("what a file defines without \`configurable\` is undone too", async () => {
    const state = `JSON.stringify(["fixed" in Array.prototype, "fixedGlobal" in globalThis, typeof Math.min, Object.getOwnPropertyDescriptor(Math, "min").configurable, "after" in Array.prototype])`;
    const files = {
      "a.test.js": `test("a", () => {
        console.log(${state});
        Object.defineProperty(Array.prototype, "fixed", { value: 1 });
        Array.prototype.after = 1;
        Object.defineProperty(globalThis, "fixedGlobal", { value: 1 });
        Object.defineProperty(Math, "min", { value: 1, writable: false, configurable: false });
      });`,
      "b.test.js": `test("b", () => { console.log(${state}); });`,
    };
    const lines = (await passes(files, 2)).split("\n").filter(line => line.startsWith("["));
    expect(lines).toEqual(Array(2).fill(JSON.stringify([false, false, "function", true, false])));
  });

  test("restores a global that a file redefined as writable but not configurable, and the properties after it", async () => {
    const state = `JSON.stringify([fetch.name, Object.getOwnPropertyDescriptor(globalThis, "fetch").configurable, "addedLater" in globalThis])`;
    const files = {
      "a.test.js": `test("a", () => {
        console.log(${state});
        Object.defineProperty(globalThis, "fetch", { value: function stub() {}, writable: true, configurable: false });
        globalThis.addedLater = 1;
      });`,
      "b.test.js": `test("b", () => { console.log(${state}); });`,
    };
    const lines = (await passes(files, 2)).split("\n").filter(line => line.startsWith("["));
    expect(lines).toEqual(Array(2).fill(JSON.stringify(["fetch", true, false])));
  });

  test("keeps what node:perf_hooks and node:worker_threads add to the builtins when they load", async () => {
    const file = `
      import "node:perf_hooks";
      import "node:worker_threads";
      test("reads the additions", () => {
        const { timerify, eventLoopUtilization, nodeTiming } = performance;
        // The native close() has no parameters.
        console.log(JSON.stringify([typeof timerify, typeof eventLoopUtilization, typeof nodeTiming, MessagePort.prototype.close.length]));
      });
    `;
    const lines = (await passes({ "a.test.js": file, "b.test.js": file }, 2))
      .split("\n")
      .filter(line => line.startsWith("["));
    expect(lines).toEqual(Array(2).fill(JSON.stringify(["function", "function", "object", 1])));
  });

  // If this fails, load the module before the snapshot in src/js/internal/test/globals.ts.
  test("no other builtin module patches a global class when it loads", async () => {
    const files = {
      "a.test.js": `test("loads every builtin module", () => {
        const objects = Object.getOwnPropertyNames(globalThis)
          .map(name => Object.getOwnPropertyDescriptor(globalThis, name).value)
          .filter(value => typeof value === "function")
          .flatMap(value => [value, value.prototype])
          .filter(object => object != null);
        const functionsOf = object =>
          new Map(
            Reflect.ownKeys(object).map(key => {
              const { value, get, set } = Object.getOwnPropertyDescriptor(object, key);
              return [key, [typeof value === "function" ? value : undefined, get, set]];
            }),
          );
        const before = objects.map(functionsOf);
        const patched = [];
        for (const id of require("node:module").builtinModules) {
          if (/^bun|^_|^(wasi|repl|inspector|trace_events)/.test(id)) continue;
          require(id);
          objects.forEach((object, i) => {
            for (const [key, functions] of functionsOf(object)) {
              if (functions.some((fn, j) => fn !== before[i].get(key)?.[j]) || !before[i].has(key)) patched.push(id + ": " + String(key));
              before[i].set(key, functions);
            }
          });
        }
        console.log(JSON.stringify(patched));
      });`,
    };
    expect((await passes(files, 1)).split("\n").filter(line => line.startsWith("["))).toEqual(["[]"]);
  });

  test("Module._cache is the running file's require.cache", async () => {
    const file = `
      const Module = require("node:module");
      test("evicts a module", () => {
        const path = require.resolve("./counter.cjs");
        const first = require(path);
        const isCached = path in Module._cache;
        delete Module._cache[path];
        console.log(JSON.stringify([Module._cache === require.cache, isCached, require(path) === first]));
      });
    `;
    const files = { "counter.cjs": `module.exports = {};`, "a.test.js": file, "b.test.js": file };
    const lines = (await passes(files, 2)).split("\n").filter(line => line.startsWith("["));
    expect(lines).toEqual(Array(2).fill(JSON.stringify([true, true, false])));
  });

  test("process.mainModule is the running file's module", async () => {
    const file = `test("reads it", () => { console.log(JSON.stringify([process.mainModule === module, require.main === module])); });`;
    const files = {
      "a.test.mjs": `test("reads it", () => { console.log(JSON.stringify([process.mainModule])); });`,
      "b.test.cjs": file,
      "c.test.cjs": file,
    };
    const lines = (await passes(files, 3)).split("\n").filter(line => line.startsWith("["));
    expect(lines).toEqual(["[null]", "[true,true]", "[true,true]"]);
  });

  test("the global object and the builtin modules are the same for every file", async () => {
    const files = {
      "a.test.js": `import fs from "node:fs"; test("a", () => { fs.arrayOfA = Array; });`,
      "b.test.js": `import fs from "node:fs"; test("b", () => { console.log(fs.arrayOfA === Array); });`,
    };
    expect(await passes(files, 2)).toContain("true\n");
    using dir = tempDir("isolate-global", files);
    expect((await runTests(String(dir), ["--isolate"], ["./a.test.js", "./b.test.js"])).stdout).toContain("false\n");
  });

  test("a file runs the code that was compiled for the files before it", async () => {
    const hot = (name: string) => `
      import { noInline, numberOfDFGCompiles } from "bun:jsc";
      import { esm } from "./hot.js";
      import cjs from "./hot.cjs";
      test("${name}", () => {
        console.log("${name}", numberOfDFGCompiles(esm) > 0, numberOfDFGCompiles(cjs) > 0);
        for (const fn of [esm, cjs]) {
          // Inlined into this function, it would never be compiled on its own.
          noInline(fn);
          const deadline = Date.now() + 20_000;
          while (!numberOfDFGCompiles(fn) && Date.now() < deadline) for (let i = 0; i < 500; i++) fn(i);
        }
      }, 30_000);
    `;
    const files = {
      "hot.js": `export function esm(x) { return x * 2 + 1; }`,
      "hot.cjs": `module.exports = function cjs(x) { return x * 2 + 1; };`,
      "a.test.js": hot("a"),
      // The code is kept although no module of this file uses it.
      "b.test.js": `test("b", () => { Bun.gc(true); Bun.gc(true); });`,
      "c.test.js": hot("c"),
    };
    expect(await passes(files, 3)).toContain("a false false\nc true true\n");
    // But not forever, or every test file's own code would pile up: the last 8 files' graphs and the running one's.
    const { "c.test.js": _, ...many }: Record<string, string> = files;
    for (let i = 0; i < 10; i++) many[`b${i}.test.js`] = files["b.test.js"];
    many["count.test.ts"] = `
      import { generateHeapSnapshotForDebugging } from "bun:jsc";
      ${Heap}
      test("count", () => {
        const held = new Heap().pathsTo("ModuleGraph").filter(path => path === "root(StrongHandles) ModuleGraph");
        console.log("graphs", held.length);
      }, 120_000); // A heap snapshot takes 20 s on a busy debug build.
    `;
    expect(await passes(many, 13)).toContain("graphs 9\n");
    using dir = tempDir("isolate-global-code", files);
    const { stdout } = await runTests(String(dir), ["--isolate"], ["./a.test.js", "./b.test.js", "./c.test.js"]);
    expect(stdout).toContain("a false false\nc false false\n");
  });

  test("with --parallel", async () => {
    const file = (name: string) => `
      import { inc } from "./state.js";
      test("${name}", () => { expect([inc(), globalThis.leaked]).toEqual([1, undefined]); globalThis.leaked = "${name}"; });
    `;
    const files: Record<string, string> = { "state.js": `let n = 0; export const inc = () => ++n;` };
    for (let i = 0; i < 6; i++) files[`${i}.test.js`] = file(String(i));
    await passes(files, 6, ["--parallel=2"]);
  });

  test("another value is an error", async () => {
    using dir = tempDir("isolate-value", fixtures);
    const { stderr, exitCode } = await runTests(String(dir), ["--isolate=nothing"]);
    expect(stderr).toContain(`--isolate expects "global" or "modules", received "nothing"`);
    expect(exitCode).toBe(1);
  });
});

test.concurrent("--isolate: JSC options survive a bunfig.toml with an install hoist pattern", async () => {
  using dir = tempDir("isolate-bunfig-hoist-pattern", {
    "bunfig.toml": `[install]\nhoistPattern = ["*eslint*"]\n`,
    "a.test.ts": `
      import { test, expect } from "bun:test";
      test("passes", () => {
        expect(1).toBe(1);
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate", "./a.test.ts"],
    env: { ...bunEnv, BUN_JSC_dumpOptions: "2" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const threshold = stderr.split("\n").find(line => line.includes("thresholdForFTLOptimizeAfterWarmUp="));
  expect(threshold?.trim()).toBe("thresholdForFTLOptimizeAfterWarmUp=1000000");
  expect(normalizeBunSnapshot(stderr, dir)).toContain("1 pass");
  expect(exitCode).toBe(0);
});

// The eviction test below proves the SourceProvider cache is active (control:
// b sees stale v1 → cache hit) and that delete require.cache evicts it
// (treatment: b sees fresh v2). A/B timing was removed as flaky; this is the
// deterministic behavioral proof.
test.concurrent("--isolate: delete require.cache evicts the SourceProvider cache", async () => {
  const sharedV1 = `export const v = "v1";\n`;
  const sharedV2 = `export const v = "v2";\n`;
  const aBody = (doDelete: boolean) => `
    import { test, expect } from "bun:test";
    import { writeFileSync } from "node:fs";
    test("a sees v1 then rewrites", async () => {
      const { v } = await import("./shared.ts");
      expect(v).toBe("v1");
      ${doDelete ? `delete require.cache[require.resolve("./shared.ts")];` : ``}
      writeFileSync(new URL("./shared.ts", import.meta.url), ${JSON.stringify(sharedV2)});
    });
  `;
  const bBody = (expected: "v1" | "v2") => `
    import { test, expect } from "bun:test";
    test("b sees ${expected}", async () => {
      const { v } = await import("./shared.ts");
      expect(v).toBe("${expected}");
    });
  `;

  // Control (without delete) and treatment (with delete) are independent — run
  // both subprocesses in parallel.
  await Promise.all([
    // Control: without delete, the SourceProvider cache returns the v1 provider
    // even though the file on disk is now v2.
    (async () => {
      using dir = tempDir("isolate-spcache-evict-ctrl", {
        "shared.ts": sharedV1,
        "a.test.ts": aBody(false),
        "b.test.ts": bBody("v1"),
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--isolate", "./a.test.ts", "./b.test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("2 pass");
      expect(stderr).toContain("0 fail");
      expect(exitCode).toBe(0);
    })(),
    // With delete: the cache entry is evicted, so b's import re-transpiles and
    // sees v2 from disk.
    (async () => {
      using dir = tempDir("isolate-spcache-evict", {
        "shared.ts": sharedV1,
        "a.test.ts": aBody(true),
        "b.test.ts": bBody("v2"),
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--isolate", "./a.test.ts", "./b.test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("2 pass");
      expect(stderr).toContain("0 fail");
      expect(exitCode).toBe(0);
    })(),
  ]);
});

test.concurrent("--isolate: SourceProvider cache covers CommonJS modules", async () => {
  const sharedV1 = `module.exports = { v: "v1" };\n`;
  const sharedV2 = `module.exports = { v: "v2" };\n`;
  const aBody = (doDelete: boolean) => `
    const { test, expect } = require("bun:test");
    const { writeFileSync } = require("node:fs");
    const path = require("node:path");
    test("a sees v1 then rewrites", () => {
      const { v } = require("./shared.cjs");
      expect(v).toBe("v1");
      globalThis.__a_ran = true;
      ${doDelete ? `delete require.cache[require.resolve("./shared.cjs")];` : ``}
      writeFileSync(path.join(__dirname, "shared.cjs"), ${JSON.stringify(sharedV2)});
    });
  `;
  const bBody = (expected: "v1" | "v2") => `
    const { test, expect } = require("bun:test");
    test("b sees ${expected}", () => {
      // Under --isolate, a's global is gone; if b sees ${expected === "v1" ? "stale " : ""}v
      // it must be from the VM-level SourceProvider cache, not require.cache.
      expect(globalThis.__a_ran).toBeUndefined();
      const { v } = require("./shared.cjs");
      expect(v).toBe("${expected}");
    });
  `;
  // Same shared.cjs imported as ESM (import-CJS-from-ESM path).
  const cBody = (expected: "v1" | "v2") => `
    import { test, expect } from "bun:test";
    test("c (esm import of cjs) sees ${expected}", async () => {
      const mod = await import("./shared.cjs");
      expect(mod.default.v).toBe("${expected}");
    });
  `;

  // Control and treatment are independent — run both subprocesses in parallel.
  await Promise.all([
    // Control: without delete, the cached Program-type SourceProvider is reused
    // across files for both require() and import-of-CJS, so b and c see stale v1.
    (async () => {
      using dir = tempDir("isolate-spcache-cjs-ctrl", {
        "shared.cjs": sharedV1,
        "a.test.cjs": aBody(false),
        "b.test.cjs": bBody("v1"),
        "c.test.ts": cBody("v1"),
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--isolate", "./a.test.cjs", "./b.test.cjs", "./c.test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("3 pass");
      expect(stderr).toContain("0 fail");
      expect(exitCode).toBe(0);
    })(),
    // With delete: b and c re-transpile and see v2.
    (async () => {
      using dir = tempDir("isolate-spcache-cjs", {
        "shared.cjs": sharedV1,
        "a.test.cjs": aBody(true),
        "b.test.cjs": bBody("v2"),
        "c.test.ts": cBody("v2"),
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--isolate", "./a.test.cjs", "./b.test.cjs", "./c.test.ts"],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
        stdout: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("3 pass");
      expect(stderr).toContain("0 fail");
      expect(exitCode).toBe(0);
    })(),
  ]);
});

test.concurrent("--isolate: SourceProvider cache covers node_modules .mjs and type:commonjs packages", async () => {
  // Regression: insert was gated on tag == JavaScript || PackageJSONTypeModule,
  // so .mjs files from `"type":"module"` packages and .ts from `"type":"commonjs"`
  // packages (PackageJSONTypeCommonJS / ESM tags) bypassed the cache and were
  // re-transpiled on every isolated file. This test proves both now cache by
  // showing files 2-3 see stale v1 after file 1 rewrites disk to v2.
  const mkEsmPkg = (v: string) => `export const v = "${v}";\n`;
  const mkCjsPkg = (v: string) => `export const v: string = "${v}";\n`;
  const aBody = `
    import { test, expect } from "bun:test";
    import { writeFileSync } from "node:fs";
    import * as path from "node:path";
    import { v as esm } from "fake-esm-pkg";
    import { v as cjs } from "fake-cjs-pkg";
    test("a", () => {
      expect(esm).toBe("v1");
      expect(cjs).toBe("v1");
      globalThis.__a_ran = true;
      writeFileSync(path.join(process.cwd(), "node_modules/fake-esm-pkg/index.mjs"), ${JSON.stringify(mkEsmPkg("v2"))});
      writeFileSync(path.join(process.cwd(), "node_modules/fake-cjs-pkg/index.ts"), ${JSON.stringify(mkCjsPkg("v2"))});
    });
  `;
  const bcBody = (name: string) => `
    import { test, expect } from "bun:test";
    import { v as esm } from "fake-esm-pkg";
    import { v as cjs } from "fake-cjs-pkg";
    test("${name}", () => {
      expect(globalThis.__a_ran).toBeUndefined();
      expect(esm).toBe("v1");
      expect(cjs).toBe("v1");
    });
  `;

  using dir = tempDir("isolate-spcache-nodemod", {
    "node_modules/fake-esm-pkg/package.json": JSON.stringify({
      name: "fake-esm-pkg",
      type: "module",
      main: "./index.mjs",
    }),
    "node_modules/fake-esm-pkg/index.mjs": mkEsmPkg("v1"),
    "node_modules/fake-cjs-pkg/package.json": JSON.stringify({
      name: "fake-cjs-pkg",
      type: "commonjs",
      main: "./index.ts",
    }),
    "node_modules/fake-cjs-pkg/index.ts": mkCjsPkg("v1"),
    "a.test.ts": aBody,
    "b.test.ts": bcBody("b"),
    "c.test.ts": bcBody("c"),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate", "./a.test.ts", "./b.test.ts", "./c.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("3 pass");
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
});

test.concurrent("--isolate: cached SourceProvider's module_info rebuilds correct exports", async () => {
  // A wide module so the printer-generated module_info has thousands of
  // export entries. Under --isolate, file b hits the SourceProvider cache and
  // rebuilds JSModuleRecord from the cached module_info (Bun__analyzeTranspiledModule)
  // instead of re-parsing. If the record is wrong, named imports would be
  // undefined or the count would mismatch. The names are long enough that the
  // record's string table passes 64 KB and stores its offsets as u32.
  const N = 2000;
  const P = Buffer.alloc(40, "p").toString();
  let big = "";
  for (let i = 0; i < N; i++) big += `export function f${i}${P}(x){return x+${i};}\n`;
  big += `export const COUNT = ${N};\n`;

  const tBody = (name: string) => `
    import { test, expect } from "bun:test";
    import { f0${P}, f1${P}, f${N - 1}${P}, COUNT } from "./big";
    import * as all from "./big";
    test("${name}", () => {
      expect(f0${P}(1)).toBe(1);
      expect(f1${P}(1)).toBe(2);
      expect(f${N - 1}${P}(1)).toBe(${N});
      expect(COUNT).toBe(${N});
      expect(Object.keys(all).length).toBe(${N + 1});
    });
  `;

  using dir = tempDir("isolate-module-info", {
    "big.ts": big,
    "a.test.ts": tBody("a"),
    "b.test.ts": tBody("b"),
    "c.test.ts": tBody("c"),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate", "./a.test.ts", "./b.test.ts", "./c.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("3 pass");
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
});

// JSC caches the unlinked code of 2,000 sources unless it's given room for more, hence 2,200 modules.
// Pruning also only keeps the last 10 s of additions, and on debug or ASAN builds one file can take longer to load.
test
  .skipIf(isDebug || isASAN)
  .concurrent(
    "--isolate: code is generated once for the modules every file loads, however many there are",
    async () => {
      const count = 2200;
      const files: Record<string, string> = { "all.js": "" };
      for (let i = 0; i < count; i++) {
        files[`modules/${i}.js`] = `export const v${i} = ${i};\n`;
        files["all.js"] += `import "./modules/${i}.js";\n`;
      }
      for (const name of ["a", "b", "c"]) {
        files[`${name}.test.js`] = `
      import "./all.js";
      import { writeSync } from "node:fs";
      writeSync(2, "<loaded>\\n");
      test("${name}", () => {});
    `;
      }
      using dir = tempDir("isolate-code-cache", files);
      const { stderr, exitCode } = await runTests(
        String(dir),
        ["--isolate"],
        ["./a.test.js", "./b.test.js", "./c.test.js"],
        {
          ...bunEnv,
          BUN_JSC_reportBytecodeCompileTimes: "1",
        },
      );
      const [a, , c] = stderr.split("<loaded>\n").map(part => part.match(/^Compiled #/gm)?.length ?? 0);
      expect(a).toBeGreaterThanOrEqual(count);
      expect(c).toBeLessThan(count / 10);
      expect(stderr).toContain("3 pass");
      expect(exitCode).toBe(0);
    },
  );

test.concurrent(
  "--isolate: cached module_info handles `import * as ns; export { ns }` as a Namespace export",
  async () => {
    // The zod pattern: re-exporting a namespace import binding. Bun's module_info
    // must record this as a [Namespace] export entry (not [Local]) so the cached
    // analyze result matches JSC's ModuleAnalyzer. The debug build's
    // fallbackParse diff would print "BEGIN analyzeTranspiledModule" + a DIFF
    // and assert if they disagree.
    using dir = tempDir("isolate-ns-reexport", {
      "external.ts": `export const a = 1;\nexport const b = 2;\n`,
      "re.ts": `import * as ns from "./external";\nexport { ns };\nexport default ns;\nexport * from "./external";\n`,
      "t1.test.ts": `import {test,expect} from "bun:test";
import { ns } from "./re";
import def, * as all from "./re";
test("t1", () => {
  (globalThis as any).__t1_ran = true;
  expect(ns.a).toBe(1);
  expect(def.b).toBe(2);
  expect(all.ns.a).toBe(1);
  expect(all.a).toBe(1);
  expect(Object.keys(ns).sort()).toEqual(["a","b"]);
});
`,
      "t2.test.ts": `import {test,expect} from "bun:test";
import { ns } from "./re";
test("t2", () => {
  // Isolation sentinel: system bun ignores --isolate, so t2 would see t1's
  // global mutation and fail here. Ensures this test depends on --isolate.
  expect((globalThis as any).__t1_ran).toBeUndefined();
  expect(ns.a).toBe(1);
  expect(ns.b).toBe(2);
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "./t1.test.ts", "./t2.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("BEGIN analyzeTranspiledModule");
    expect(stderr).not.toContain("DIFF:");
    expect(stderr).toContain("2 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  },
);

test.concurrent("--isolate: leaked AbortSignal.timeout does not fire in next file", async () => {
  using dir = tempDir("isolate-abort-timeout", {
    "a-leak.test.ts": `
      import { test, expect } from "bun:test";
      import { writeFileSync } from "fs";
      test("leak AbortSignal.timeout", () => {
        const s = AbortSignal.timeout(100);
        s.addEventListener("abort", () => writeFileSync(process.env.FIRE_FILE!, "fired"));
        // Keep the signal reachable so it isn't GC'd before the timer would
        // have fired.
        (globalThis as any).__abort_signal = s;
        (globalThis as any).__a_ran = true;
        expect(s.aborted).toBe(false);
      });
    `,
    "b-check.test.ts": `
      import { test, expect } from "bun:test";
      import { existsSync } from "fs";
      test("AbortSignal from prior file did not fire here", async () => {
        // Prove this file is isolated from a (fails under USE_SYSTEM_BUN=1).
        expect((globalThis as any).__a_ran).toBeUndefined();
        for (let i = 0; i < 30; i++) {
          if (existsSync(process.env.FIRE_FILE!)) break;
          await Bun.sleep(20);
        }
        expect(existsSync(process.env.FIRE_FILE!)).toBe(false);
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate", "./a-leak.test.ts", "./b-check.test.ts"],
    env: { ...bunEnv, FIRE_FILE: String(dir) + "/fired.txt" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("2 pass");
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
});

// The swap sweeps what exists AT the file boundary. Work a finished file left
// in flight lands later, while the next file runs: a thread-pool job settles a
// promise of the retired realm, a child the swap killed reports its exit. The
// finished file's continuation must not run then. Before the fence it did, and
// whatever it created (a setInterval, a Bun.serve, a child process, a chdir)
// was adopted by the running file.
describe.concurrent("--isolate: a finished file's late completions do not run in the next file", () => {
  const lateFixtures = {
    "a-late.test.ts": `
      import { test, expect } from "bun:test";
      import { existsSync, writeFileSync } from "node:fs";
      import { tmpdir } from "node:os";
      import { join } from "node:path";

      const dir = import.meta.dir;

      test("leaks a thread-pool chain and a child with onExit", () => {
        // Each turn hops through the thread pool, so the chain is always mid-flight
        // at the swap. It only acts once b-late.test.ts says it is running.
        (async () => {
          while (!existsSync(join(dir, "b-running"))) {
            await Bun.password.hash("pw", { algorithm: "bcrypt", cost: 4 });
          }
          process.chdir(tmpdir());
          const server = Bun.serve({ port: 0, fetch: () => new Response("served by dead A") });
          writeFileSync(join(dir, "a-acted"), String(server.port));
        })();

        // Killed by the swap; its exit lands while B runs.
        Bun.spawn({
          cmd: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
          stdio: ["ignore", "ignore", "ignore"],
          onExit() {
            writeFileSync(join(dir, "a-onexit"), "");
          },
        });

        expect(existsSync(join(dir, "b-running"))).toBe(false);
      });
    `,
    "b-late.test.ts": `
      import { test, expect } from "bun:test";
      import { existsSync, realpathSync, writeFileSync } from "node:fs";
      import { join } from "node:path";

      const dir = import.meta.dir;

      test("sees nothing from A", async () => {
        writeFileSync(join(dir, "b-running"), "");
        // Turn the event loop through the thread pool so A's pending job (and
        // its killed child's exit) get every chance to land here.
        for (let i = 0; i < 40 && !existsSync(join(dir, "a-acted")); i++) {
          await Bun.password.hash("pw", { algorithm: "bcrypt", cost: 4 });
        }
        expect({
          acted: existsSync(join(dir, "a-acted")),
          onExit: existsSync(join(dir, "a-onexit")),
          cwd: realpathSync("."),
        }).toEqual({
          acted: false,
          onExit: false,
          cwd: realpathSync(dir),
        });
      });
    `,
  };
  const files = ["./a-late.test.ts", "./b-late.test.ts"];

  test("--isolate", async () => {
    using dir = tempDir("isolate-late", lateFixtures);
    const { stderr, exitCode } = await runTests(String(dir), ["--isolate"], files);
    expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
    expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
    if (exitCode !== 0) expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // One worker takes both files (scale-up gated), so the same fence applies
  // between files inside a --parallel worker.
  test("--parallel", async () => {
    using dir = tempDir("isolate-late-parallel", lateFixtures);
    const { stderr, exitCode } = await runTests(String(dir), ["--parallel=2"], files, {
      ...bunEnv,
      BUN_TEST_PARALLEL_SCALE_MS: "60000",
    });
    expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
    expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
    if (exitCode !== 0) expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // A FinalizationRegistry cleanup that a finished file created reaches none of
  // the checks above: JSC calls it directly from a DeferredWorkTimer job, not
  // through a microtask, a Job or run_callback. The cleanup ran in the retired
  // realm while a later file executed, and an error it threw was charged to
  // that later file (which then lost its remaining tests to "Cannot call test()
  // after the test run has completed"). The retired realm now reports its
  // script execution as stopped, so Bun drops the job, as JSC's own
  // DeferredWorkTimer::doWork does for a stopped realm.
  test.each(isolateFlags)(
    "%s: a finished file's FinalizationRegistry cleanup does not run in the next file",
    async isolate => {
      using dir = tempDir("isolate-finalization-registry", {
        "a-registry.test.ts": `
        import { test, expect } from "bun:test";
        import { existsSync, writeFileSync } from "node:fs";
        import { join } from "node:path";

        const dir = import.meta.dir;
        // The cleanup only acts once b-registry.test.ts says it is running, and it
        // registers fresh garbage each time, so this registry has dead entries at
        // every collection for as long as its realm is alive.
        const registry = new FinalizationRegistry(() => {
          if (existsSync(join(dir, "b-running"))) writeFileSync(join(dir, "a-acted"), "");
          registry.register({}, 0);
        });

        test("registers objects that die at once", () => {
          for (let i = 0; i < 200; i++) registry.register({ i }, i);
          expect(existsSync(join(dir, "b-running"))).toBe(false);
        });
      `,
        "b-registry.test.ts": `
        import { test, expect } from "bun:test";
        import { existsSync, writeFileSync } from "node:fs";
        import { join } from "node:path";

        const dir = import.meta.dir;
        writeFileSync(join(dir, "b-running"), "");

        test("A's FinalizationRegistry cleanup does not run here", async () => {
          // Collect, then round-trip the thread pool, so a cleanup A left queued gets
          // every chance to land here.
          for (let i = 0; i < 20 && !existsSync(join(dir, "a-acted")); i++) {
            Bun.gc(true);
            await Bun.password.hash("pw", { algorithm: "bcrypt", cost: 4 });
          }
          expect(existsSync(join(dir, "a-acted"))).toBe(false);
        });
      `,
      });
      const { stderr, exitCode } = await runTests(
        String(dir),
        [isolate, "--timeout=30000"],
        ["./a-registry.test.ts", "./b-registry.test.ts"],
        // A collects between its last drain and the swap, which is when the cleanup it
        // leaves behind is queued. Natural GC timing does that only sometimes.
        { ...bunEnv, BUN_JSC_collectContinuously: "1" },
      );
      expect(normalizeBunSnapshot(stderr, dir)).toContain("2 pass");
      expect(normalizeBunSnapshot(stderr, dir)).toContain("0 fail");
      if (exitCode !== 0) expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    },
  );
});

// Each of these leaked handles used to pin its test file's ENTIRE global
// object (and therefore the file's module graph) for the rest of a
// `bun test --isolate` run, growing memory by one full global per file:
//
// - fs.watch: isolation teardown called FSWatcher.detach(), which never drops
//   the initial pending_activity_count ref, so hasPendingActivity() stayed
//   true forever and the GC could never collect the wrapper or its cached
//   listener closure.
// - Bun.serve: the swap blind-closed the listen socket at the uws layer; the
//   Server object never learned, kept hasListener() true, and its strong
//   js_value (fetch handler closure) pinned the global.
// - setTimeout/setInterval: generation-stale timers only self-cancelled when
//   they FIRED, so a module-scope long timer held a Strong on its wrapper
//   until the deadline (effectively forever for hour-scale timers).
// - AbortSignal.timeout with an abort listener: the swap unlinked the native
//   timer but left the signal believing it still had one, and the GC keeps a
//   pending timeout signal's wrapper (hence its listener, hence the global)
//   alive for as long as the signal says so. Same story when the timer sat in
//   the fake-timer heap of a file that never called useRealTimers().
// - mock()/spyOn()/mock.module()/Bun.plugin: the global's own mock-tracking
//   sets and plugin callback lists were held through Strong handles, so any
//   file that created a mock or registered a plugin formed an uncollectable
//   root -> realm object -> global cycle (#31771's linear growth in practice).
// - monitorEventLoopDelay().enable(): the per-thread monitor holds the file's
//   histogram. It is disabled at the swap and only ever holds the histogram
//   weakly, so an enabled monitor must not keep the file's global alive.
//
// Each fixture runs 8 isolated files that leak one handle apiece, forces a
// full GC, and counts live GlobalObject cells. Pinned globals accumulate
// (the last file sees 8); collectable ones plateau (current + a lagging one
// or two).
describe.concurrent("--isolate: collects globals pinned by leaked handles", () => {
  const LEAK_FILE_COUNT = 8;

  function makeLeakFixture(dirt: string | ((i: number) => string)): Record<string, string> {
    const files: Record<string, string> = {};
    for (let i = 1; i <= LEAK_FILE_COUNT; i++) {
      files[`file_${i}.test.js`] = `
        import { test, expect } from "bun:test";
        import { heapStats } from "bun:jsc";
        ${typeof dirt === "string" ? dirt : dirt(i)}
        test("leak-${i}", () => {
          Bun.gc(true);
          Bun.gc(true);
          const globals = heapStats().objectTypeCounts.GlobalObject ?? 0;
          console.log("GLOBALS=" + globals);
          expect(globals).toBeGreaterThan(0);
        });
      `;
    }
    return files;
  }

  async function maxLiveGlobals(dir: string): Promise<number> {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate"],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(`${LEAK_FILE_COUNT} pass`);
    expect(exitCode).toBe(0);
    const counts = [...stdout.matchAll(/GLOBALS=(\d+)/g)].map(m => Number(m[1]));
    expect(counts).toHaveLength(LEAK_FILE_COUNT);
    return Math.max(...counts);
  }

  test("fs.watch left open", async () => {
    using dir = tempDir(
      "isolate-leak-watch",
      makeLeakFixture(`
        import fs from "node:fs";
        const watcher = fs.watch(import.meta.dir, () => {});
      `),
    );
    expect(await maxLiveGlobals(String(dir))).toBeLessThanOrEqual(4);
  });

  test("Bun.serve left running", async () => {
    using dir = tempDir(
      "isolate-leak-serve",
      makeLeakFixture(`
        const server = Bun.serve({ port: 0, fetch: () => new Response("x") });
      `),
    );
    expect(await maxLiveGlobals(String(dir))).toBeLessThanOrEqual(4);
  });

  test("long setTimeout/setInterval left pending", async () => {
    using dir = tempDir(
      "isolate-leak-timers",
      makeLeakFixture(`
        setTimeout(() => {}, 3_600_000);
        setInterval(() => {}, 3_600_000);
      `),
    );
    expect(await maxLiveGlobals(String(dir))).toBeLessThanOrEqual(4);
  });

  test("AbortSignal.timeout with an abort listener left pending", async () => {
    using dir = tempDir(
      "isolate-leak-abort-timeout",
      makeLeakFixture(`
        AbortSignal.timeout(3_600_000).addEventListener("abort", () => {});
      `),
    );
    expect(await maxLiveGlobals(String(dir))).toBeLessThanOrEqual(4);
  });

  test("AbortSignal.timeout with an abort listener left pending in a fake-timer heap", async () => {
    using dir = tempDir(
      "isolate-leak-abort-timeout-fake",
      makeLeakFixture(`
        import { vi } from "bun:test";
        vi.useFakeTimers();
        AbortSignal.timeout(3_600_000).addEventListener("abort", () => {});
      `),
    );
    expect(await maxLiveGlobals(String(dir))).toBeLessThanOrEqual(4);
  });

  test("mock(), spyOn() and mock.module() left registered", async () => {
    using dir = tempDir(
      "isolate-leak-mocks",
      makeLeakFixture(`
        import { mock, spyOn } from "bun:test";
        const fn = mock(() => 1);
        fn();
        spyOn(console, "warn");
        mock.module("./mocked-dep", () => ({ default: 1 }));
      `),
    );
    expect(await maxLiveGlobals(String(dir))).toBeLessThanOrEqual(4);
  });

  test("a module mock that was removed while its module was being loaded", async () => {
    using dir = tempDir("isolate-leak-evicted-mock", {
      ...makeLeakFixture(`
        import { vi } from "bun:test";
        const called = Promise.withResolvers();
        vi.doMock("./mocked-dep.js", async () => (vi.doUnmock("./mocked-dep.js"), called.resolve(), await new Promise(() => {})));
        void import("./imports-mocked-dep.js");
        await called.promise;
      `),
      "mocked-dep.js": `export default 0;`,
      "imports-mocked-dep.js": `import "./mocked-dep.js";`,
    });
    expect(await maxLiveGlobals(String(dir))).toBeLessThanOrEqual(4);
  });

  test("Bun.plugin left registered", async () => {
    using dir = tempDir(
      "isolate-leak-plugin",
      makeLeakFixture(`
        Bun.plugin({
          name: "leak",
          setup(build) {
            build.onLoad({ filter: /never-matches/ }, () => ({ contents: "", loader: "js" }));
            build.onResolve({ filter: /never-matches/ }, () => null);
            build.module("leaked-virtual-module", () => ({ exports: {}, loader: "object" }));
          },
        });
      `),
    );
    expect(await maxLiveGlobals(String(dir))).toBeLessThanOrEqual(4);
  });

  test("monitorEventLoopDelay() left enabled", async () => {
    using dir = tempDir(
      "isolate-leak-event-loop-delay",
      makeLeakFixture(`
        import { monitorEventLoopDelay } from "node:perf_hooks";
        monitorEventLoopDelay({ resolution: 1 }).enable();
      `),
    );
    expect(await maxLiveGlobals(String(dir))).toBeLessThanOrEqual(4);
  });

  // A macro that no later file loads again is never replaced, so each file has its own.
  test("a macro left loaded", async () => {
    using dir = tempDir("isolate-leak-macro", {
      ...makeLeakFixture(
        i => `
        import { macro${i} } from "./macro.ts" with { type: "macro" };
        macro${i}();
      `,
      ),
      "macro.ts": Array.from(
        { length: LEAK_FILE_COUNT },
        (_, i) => `export const macro${i + 1} = () => ${i + 1};`,
      ).join("\n"),
    });
    expect(await maxLiveGlobals(String(dir))).toBeLessThanOrEqual(4);
  });

  // The loader builds a module from only one of the two sources. The other source's value references its global.
  test("two concurrent import() calls for the same data file", async () => {
    using dir = tempDir("isolate-leak-data-import", {
      ...makeLeakFixture(`
        await Promise.all([import("./data.json"), import("./data.json")]);
      `),
      "data.json": `{ "value": 1 }`,
    });
    expect(await maxLiveGlobals(String(dir))).toBeLessThanOrEqual(4);
  });
});

// fs.watchFile's StatWatcher is thread-safe-refcounted: the scheduler queue
// holds a ref that is dropped on the work-pool thread. After unwatchFile +
// GC of the JS wrapper, that queue ref is the LAST ref, so the watcher is
// freed off the JS thread — where its context's handle list must not be
// touched. The watcher must therefore leave its context in close() (JS
// thread), not in the refcount destructor; otherwise the file-boundary sweep
// reaches a dangling pointer and calls close() on freed memory (UAF, caught by
// ASAN).
test.concurrent(
  "--isolate: unwatchFile'd watcher freed on the work pool leaves no dangling registry entry",
  async () => {
    // The dance, per file:
    //   1. watchFile, then touch the file until the listener fires — proof the
    //      initial stat completed and the watcher sits in the scheduler queue
    //      (queue ref taken).
    //   2. unwatchFile (close: Strong self-ref downgraded) + Bun.gc (wrapper
    //      finalized: wrapper ref dropped).
    //   3. sleep past a few 10ms scheduler ticks so the work-pool callback pops
    //      the closed watcher and drops the queue ref — the last one — freeing
    //      the watcher on the work-pool thread. No JS-observable signal exists
    //      for that free, hence the bounded sleep.
    // The file boundary after each file then sweeps the file's context, which
    // must no longer reference the freed watcher.
    const raceFixture = `
    import { test } from "bun:test";
    import fs from "node:fs";
    import path from "node:path";

    test("unwatchFile then free on work pool", async () => {
      const target = path.join(import.meta.dir, "watched-" + path.basename(import.meta.path) + ".txt");
      for (let round = 0; round < 3; round++) {
        fs.writeFileSync(target, "0");
        await (async function arm() {
          const fired = Promise.withResolvers();
          fs.watchFile(target, { interval: 10 }, () => fired.resolve());
          const poker = setInterval(() => fs.writeFileSync(target, String(Math.random())), 10);
          await fired.promise;
          clearInterval(poker);
          fs.unwatchFile(target);
        })();
        Bun.gc(true);
        Bun.gc(true);
        await Bun.sleep(250);
      }
    });
  `;
    // Two identical files: the drain runs at the boundary BETWEEN files, so the
    // first file's registry is drained while the second exists to force it.
    using dir = tempDir("isolate-statwatcher-race", {
      "a.test.js": raceFixture,
      "b.test.js": raceFixture,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("2 pass");
    expect(exitCode).toBe(0);
  },
);

test.concurrent("--isolate: a queued watchFile timer update does not re-arm the last file's scheduler", async () => {
  // The first sleep makes the scheduler's timer due along with `due`. The second lets the stat pass
  // it started queue its timer update, which the file then ends without running.
  const fixture = `
    import { test } from "bun:test";
    import fs from "node:fs";

    test("leaves a watcher behind", async () => {
      Bun.gc(true);
      const polled = Promise.withResolvers();
      fs.watchFile(import.meta.dir + "/missing", { interval: 5 }, polled.resolve);
      await polled.promise;
      const due = Promise.withResolvers();
      setTimeout(due.resolve, 6);
      Bun.sleepSync(10);
      await due.promise;
      Bun.sleepSync(10);
    });
  `;
  const files = ["./a.test.js", "./b.test.js", "./c.test.js", "./d.test.js"];
  using dir = tempDir("isolate-statwatcher-update", Object.fromEntries(files.map(file => [file, fixture])));
  const { stderr, exitCode } = await runTests(String(dir), ["--isolate"], files);
  expect(stderr).toContain("4 pass");
  expect(exitCode).toBe(0);
});

// The synchronous module-load path (require(esm), importSync) must attach the
// transpiler's ESM-record analysis (module_info) to the ResolvedSource under
// --isolate, exactly like the async path does. module_info is what turns the
// cached SourceProvider into a BunTranspiledModule, letting every later file
// rebuild the module record from the cache instead of re-running JSC's parser
// over the transpiled source in its fresh global (CPU + transient allocations
// per file; ~1.2s/file for a 3000-export module in a debug build). Run 1
// exercises the fresh-transpile branch; run 2 hits the on-disk
// RuntimeTranspilerCache entry (esm_record branch).
test.concurrent("--isolate: require(esm) caches a BunTranspiledModule SourceProvider", async () => {
  // Wide enough to clear the RuntimeTranspilerCache minimum size (4KB).
  let big = "";
  for (let i = 0; i < 500; i++) big += `export function f${i}(x){return x+${i};}\n`;
  big += `export const COUNT = 500;\n`;

  using dir = tempDir("isolate-sync-provider", {
    "big.mjs": big,
    "a.test.ts": `
      import { test, expect } from "bun:test";
      import { isolatedModuleCacheSourceType } from "bun:internal-for-testing";

      test("require(esm) provider carries module_info", () => {
        const path = require.resolve("./big.mjs");
        const m = require("./big.mjs");
        expect(m.COUNT).toBe(500);
        expect(m.f42(1)).toBe(43);
        expect(isolatedModuleCacheSourceType(path)).toBe("BunTranspiledModule");
      });
    `,
  });

  const cacheDir = `${String(dir)}/transpiler-cache`;
  for (const run of [1, 2]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "./a.test.ts"],
      env: {
        ...bunEnv,
        BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: cacheDir,
      },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr, `run ${run}`).toContain("1 pass");
    expect(stderr, `run ${run}`).toContain("0 fail");
    expect(exitCode, `run ${run}`).toBe(0);
  }
});

test.concurrent(
  "--isolate parses the source of an internal module for the first file that loads it, and for no other",
  async () => {
    const file = `
    import { test, expect } from "bun:test";
    import { internalModulesCompiledFromSource } from "bun:internal-for-testing";

    test("loads node:zlib", () => {
      const before = internalModulesCompiledFromSource();
      const zlib = require("node:zlib");
      expect(zlib.gunzipSync(zlib.gzipSync("text")).toString()).toBe("text");
      zlib.changedByAFile = (zlib.changedByAFile ?? 0) + 1;
      console.log(JSON.stringify({ parsedAny: internalModulesCompiledFromSource() > before, changes: zlib.changedByAFile }));
    });
  `;
    using dir = tempDir("isolate-internal-modules", { "a.test.ts": file, "b.test.ts": file, "c.test.ts": file });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "./a.test.ts", "./b.test.ts", "./c.test.ts"],
      env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = stdout.split("\n").filter(line => line.startsWith("{"));
    // Every file still gets a module object of its own.
    expect({ stderr, files: lines.map(line => JSON.parse(line)) }).toEqual({
      stderr: expect.stringContaining("3 pass"),
      files: [
        { parsedAny: true, changes: 1 },
        { parsedAny: false, changes: 1 },
        { parsedAny: false, changes: 1 },
      ],
    });
    expect(exitCode).toBe(0);
  },
);

describe.concurrent("the SourceProvider cache skips files that use import.meta.glob() or macros", () => {
  // One size below and one above the RuntimeTranspilerCache's minimum file size.
  const padding = { small: "", large: Buffer.alloc("// padding\n".length * 6000, "// padding\n").toString() };
  const files = (size: keyof typeof padding) => ({
    "globbed/a.ts": ``,
    "value.txt": `first`,
    "macro.ts": `
      import { readFileSync } from "node:fs";
      export const read = () => readFileSync(import.meta.dir + "/value.txt", "utf8");
    `,
    "globs.ts": `${padding[size]}export const matched = Object.keys(import.meta.glob("./globbed/*.ts"));`,
    "calls-macro.ts": `${padding[size]}import { read } from "./macro.ts" with { type: "macro" }; export const value = read();`,
    "plain.ts": `${padding[size]}export const plain = 1;`,
    "1.test.ts": `
      import { expect, test } from "bun:test";
      import { writeFileSync } from "node:fs";
      import { matched } from "./globs.ts";
      import { value } from "./calls-macro.ts";
      import "./plain.ts";
      test("the first file", () => {
        expect({ matched, value }).toEqual({ matched: ["./globbed/a.ts"], value: "first" });
        writeFileSync(import.meta.dir + "/globbed/b.ts", "");
        writeFileSync(import.meta.dir + "/value.txt", "second");
      });
    `,
    "2.test.ts": `
      import { isolatedModuleCacheSourceType } from "bun:internal-for-testing";
      import { expect, test } from "bun:test";
      import { writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { matched } from "./globs.ts";
      import { value } from "./calls-macro.ts";
      test("the second file", () => {
        expect({ matched, value }).toEqual({ matched: ["./globbed/a.ts", "./globbed/b.ts"], value: "second" });
        expect(["globs", "calls-macro", "plain"].map(name => isolatedModuleCacheSourceType(join(import.meta.dir, name + ".ts")))).toEqual(
          [null, null, "BunTranspiledModule"],
        );
        writeFileSync(import.meta.dir + "/globbed/c.ts", "");
        writeFileSync(import.meta.dir + "/value.txt", "third");
      });
    `,
    "3.test.ts": `
      import { expect, test } from "bun:test";
      import { writeFileSync } from "node:fs";
      test("the third file, which uses require()", () => {
        expect({ matched: require("./globs.ts").matched, value: require("./calls-macro.ts").value }).toEqual({
          matched: ["./globbed/a.ts", "./globbed/b.ts", "./globbed/c.ts"],
          value: "third",
        });
        writeFileSync(import.meta.dir + "/globbed/d.ts", "");
        writeFileSync(import.meta.dir + "/value.txt", "fourth");
      });
    `,
    "4.test.ts": `
      import { expect, test } from "bun:test";
      test("the fourth file, which does too", () => {
        expect({ matched: require("./globs.ts").matched, value: require("./calls-macro.ts").value }).toEqual({
          matched: ["./globbed/a.ts", "./globbed/b.ts", "./globbed/c.ts", "./globbed/d.ts"],
          value: "fourth",
        });
      });
    `,
  });

  test.each([
    ["--isolate", "small", undefined],
    ["--isolate", "large", undefined],
    ["--isolate", "large", "0"],
    ["--parallel=1", "small", undefined],
  ] as const)("%s, %s files, BUN_RUNTIME_TRANSPILER_CACHE_PATH=%s", async (flag, size, cachePath) => {
    using dir = tempDir("isolate-more-than-source", files(size));
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", flag],
      env: {
        ...bunEnv,
        BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: cachePath ?? `${String(dir)}/transpiler-cache`,
      },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(" 4 pass\n 0 fail\n");
    expect(exitCode).toBe(0);
  });

  // On Windows `bun test --watch` is a parent process that restarts the runner.
  test.skipIf(isWindows).each(["--watch", "--hot"])("--isolate %s", async flag => {
    using dir = tempDir("isolate-more-than-source-watch", files("small"));
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", flag, "--no-clear-screen"],
      env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
      cwd: String(dir),
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    let stderr = "";
    for await (const chunk of proc.stderr.pipeThrough(new TextDecoderStream())) {
      stderr += chunk;
      if (stderr.includes("Ran 4 tests across 4 files.")) break;
    }
    expect(stderr).toContain(" 4 pass\n 0 fail\n");
  });
});

test.concurrent("--isolate: a macro runs in every file when a plugin is registered", async () => {
  const files: Record<string, string> = {
    "preload.ts": `Bun.plugin({ name: "never matches", setup(build) { build.onLoad({ filter: /never-matches$/ }, () => undefined); } });`,
    "macro.ts": `export const macro = () => "from the macro";`,
  };
  for (const name of ["a", "b", "c"]) {
    files[`calls-${name}.ts`] =
      `import { macro } from "./macro.ts" with { type: "macro" }; export const value = macro();`;
    files[`${name}.test.ts`] = `
      import { expect, test } from "bun:test";
      import { value } from "./calls-${name}.ts";
      test("${name}", () => {
        expect(value).toBe("from the macro");
      });
    `;
  }
  using dir = tempDir("isolate-macro-plugin", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate", "--preload", "./preload.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(" 3 pass\n 0 fail\n");
  expect(exitCode).toBe(0);
});

test.concurrent("--isolate: two concurrent import()s of a file both add it to the SourceProvider cache", async () => {
  using dir = tempDir("isolate-import-twice", {
    "imported.ts": `export const x = 1;`,
    "required.cjs": `exports.x = 1;`,
    "a.test.ts": `
      import { expect, test } from "bun:test";
      test("imports", async () => {
        const all = await Promise.all([import("./imported.ts"), import("./imported.ts"), import("./required.cjs"), import("./required.cjs")]);
        expect(all.map(({ x }) => x)).toEqual([1, 1, 1, 1]);
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate", "./a.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(" 1 pass\n 0 fail\n");
  expect(exitCode).toBe(0);
});

describe.concurrent("the SourceProvider cache tells a test file that is the entry point from an import of it", () => {
  const flags = [...isolateFlags, "--parallel=1"];

  test.each(flags)("%s: it imports a file of an unknown type as a file", async flag => {
    using dir = tempDir("isolate-entry-was-imported", {
      "a.test.ts": `import "./b.test";`,
      "b.test.ts": `
        import { expect, test } from "bun:test";
        import image from "./image.png";
        test("image", () => expect(image).toEndWith("image.png"));
      `,
      "image.png": ")",
    });
    const { stderr, exitCode } = await runTests(String(dir), [flag], ["./a.test.ts", "./b.test.ts"]);
    expect(stderr).toContain(" 2 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  test.each(flags)("%s: a CommonJS test file too", async flag => {
    using dir = tempDir("isolate-entry-was-imported", {
      "a.test.cjs": `require("./b.test.cjs");`,
      "b.test.cjs": `
        const { expect, test } = require("bun:test");
        test("image", async () => expect((await import("./image.png")).default).toEndWith("image.png"));
      `,
      "image.png": ")",
    });
    const { stderr, exitCode } = await runTests(String(dir), [flag], ["./a.test.cjs", "./b.test.cjs"]);
    expect(stderr).toContain(" 2 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  test.each(flags)("%s: a later test file can require() it", async flag => {
    using dir = tempDir("isolate-entry-is-imported-later", {
      "a.test.js": `
        import { expect, test } from "vitest";
        import { one } from "./one.js";
        import { two } from "./two.js";
        export const sum = one + two;
        test("a", () => expect(sum).toBe(3));
      `,
      "b.test.js": `
        import { expect, test } from "vitest";
        const { sum } = require("./a.test.js");
        test("b", () => expect(sum).toBe(3));
      `,
      "one.js": `export const one = 1;`,
      "two.js": `export const two = 2;`,
    });
    const { stderr, exitCode } = await runTests(String(dir), [flag], ["./a.test.js", "./b.test.js"]);
    expect(stderr).toContain(" 3 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  test.each(flags)("%s: a test can require() a preload that vi.resetModules() unloaded", async flag => {
    const file = `
      import { expect, test, vi } from "vitest";
      test("requires the preload", () => {
        vi.resetModules();
        expect(require("./preload.js").sum).toBe(3);
      });
    `;
    using dir = tempDir("isolate-preload-is-required-later", {
      "preload.js": `
        import { vi } from "vitest";
        import { one } from "./one.js";
        import { two } from "./two.js";
        export const sum = one + two;
      `,
      "a.test.js": file,
      "b.test.js": file,
      "one.js": `export const one = 1;`,
      "two.js": `export const two = 2;`,
    });
    const args = [flag, "--preload", "./preload.js"];
    const { stderr, exitCode } = await runTests(String(dir), args, ["./a.test.js", "./b.test.js"]);
    expect(stderr).toContain(" 2 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });

  test.each(flags)("%s: it runs its imports in turn", async flag => {
    using dir = tempDir("isolate-entry-was-imported", {
      "a.test.js": `
        import { test } from "bun:test";
        test("imports b", () => import("./b.test.js").catch(() => {}));
      `,
      "b.test.js": `
        import { expect, test } from "vitest";
        import "./mocks-dep.js";
        import { onlyInTheMock } from "./uses-dep.js";
        test("mock", () => expect(onlyInTheMock).toBe(1));
      `,
      "mocks-dep.js": `
        import { vi } from "vitest";
        vi.doMock("./dep.js", () => ({ onlyInTheMock: 1 }));
      `,
      "uses-dep.js": `export { onlyInTheMock } from "./dep.js";`,
      "dep.js": `export {};`,
    });
    const { stderr, exitCode } = await runTests(String(dir), [flag], ["./a.test.js", "./b.test.js"]);
    expect(stderr).toContain(" 2 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("mocks and spies do not outlive their test file", () => {
  const modes = ["--no-isolate", "--isolate", "--rerun-each=2", "--parallel=1 --no-isolate"];
  const results = (stderr: string) => [
    ...new Set(
      stderr
        .split("\n")
        .filter(line => /^\((pass|fail)\)/.test(line))
        .map(line => line.replace(/ \[[\d.]+ms\]$/, "")),
    ),
  ];
  const spied = `[
    [globalThis, "fetch"], [console, "info"], [process, "cwd"], [Response.prototype, "status", "get"], [path, "join"], [fs, "readFileSync"],
    [Object, "keys"], [Date, "now"], [Math, "random"], [Bun, "sleep"], [shared, "method"], [Shared.prototype, "inherited"],
    // On Windows it is a Proxy, which like Node's refuses an accessor.
    ...(process.platform === "win32" ? [] : [[process.env, "ISOLATION_SPIED", "get"]]),
  ]`;
  const prelude = `
    import { expect, jest, spyOn, test, vi } from "bun:test";
    import fs from "node:fs";
    import path from "node:path";
    import { shared, Shared } from "./shared.ts";
    const isSpied = ([object, key, access]) => {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      return jest.isMockFunction(access ? descriptor?.[access] : descriptor?.value);
    };
  `;
  const files = {
    "shared.ts": `
      export class Shared { inherited() { return "original"; } shadowed() { return "original"; } }
      export const shared = Object.assign(new Shared(), { method: () => "original" });
    `,
    "a.test.ts": `
      ${prelude}
      test("a", () => {
        const makers = [spyOn, jest.spyOn, vi.spyOn];
        ${spied}.forEach((target, i) => makers[i % 3](...target).mockReturnValue("spied"));
        vi.spyOn(shared, "shadowed").mockReturnValue("spied");
        expect(${spied}.map(isSpied)).not.toContain(false);
        expect([shared.method(), shared.inherited(), shared.shadowed(), Object.hasOwn(shared, "shadowed")]).toEqual(["spied", "spied", "spied", true]);
      });
    `,
    "b.test.ts": `
      ${prelude}
      test("b", () => {
        expect(${spied}.map(isSpied)).not.toContain(true);
        expect([shared.method(), shared.inherited(), shared.shadowed(), Object.hasOwn(shared, "shadowed")]).toEqual(["original", "original", "original", false]);
        expect(path.join("a", "b")).toBe(path.sep === "/" ? "a/b" : "a\\\\b");
        expect(new Response(null, { status: 201 }).status).toBe(201);
      });
    `,
  };

  test.each(modes)("spies are restored: bun test %s", async flags => {
    using dir = tempDir("spies-of-a-file", files);
    const { stderr, exitCode } = await runTests(String(dir), flags.split(" "), ["./a.test.ts", "./b.test.ts"], {
      ...bunEnv,
      ISOLATION_SPIED: "original",
    });
    expect({ results: results(stderr), exitCode }, stderr).toEqual({ results: ["(pass) a", "(pass) b"], exitCode: 0 });
  });

  test("spies of a file that fails to load are restored", async () => {
    using dir = tempDir("spies-of-a-file", {
      ...files,
      "a.test.ts": `
        ${prelude}
        for (const target of ${spied}) vi.spyOn(...target);
        vi.spyOn(shared, "shadowed");
        throw new Error("thrown while loading");
      `,
    });
    const { stderr, exitCode } = await runTests(String(dir), [], ["./a.test.ts", "./b.test.ts"], {
      ...bunEnv,
      ISOLATION_SPIED: "original",
    });
    expect(stderr).toContain("error: thrown while loading");
    expect({ results: results(stderr), exitCode }, stderr).toEqual({ results: ["(pass) b"], exitCode: 1 });
  });

  // Restoring the spy after the test hits the Proxy's defineProperty trap, which runs `onRestore`.
  const restoredThroughTrap = (onRestore: string) => `
    import { jest, spyOn, test } from "bun:test";
    test("a", () => {
      let isOver = false;
      globalThis.target = new Proxy({ method() {} }, {
        defineProperty(...args) {
          if (isOver) { ${onRestore} }
          return Reflect.defineProperty(...args);
        },
      });
      globalThis.other = { method: () => "original" };
      globalThis.called = jest.fn();
      spyOn(target, "method");
      isOver = true;
    });
  `;

  test("a spy that can't be restored is reported once, under the file that made it", async () => {
    using dir = tempDir("spies-of-a-file", {
      "a.test.ts": restoredThroughTrap(`throw new Error("the trap refuses");`),
      "b.test.ts": `import { test } from "bun:test"; test("b", () => {});`,
      "c.test.ts": `import { test } from "bun:test"; test("c", () => {});`,
    });
    const { stderr, exitCode } = await runTests(String(dir), [], ["./a.test.ts", "./b.test.ts", "./c.test.ts"]);
    const lines = stderr.split("\n").filter(line => /^(error: |[abc]\.test\.ts:$|\((pass|fail)\) )/.test(line));
    expect(
      lines.map(line => line.replace(/ \[[\d.]+ms\]$/, "")),
      stderr,
    ).toEqual([
      "a.test.ts:",
      "(pass) a",
      "error: the trap refuses",
      "b.test.ts:",
      "(pass) b",
      "c.test.ts:",
      "(pass) c",
    ]);
    expect(exitCode).toBe(1);
  });

  test.each([
    [
      "a spy that is made",
      `isOver = false; spyOn(other, "method").mockReturnValue("spied");`,
      `expect(other.method()).toBe("original")`,
    ],
    ["a call that is made", `called("by the trap");`, `expect(called.mock.calls).toEqual([])`],
  ])("%s while a file's spies are being restored doesn't outlive the file either", async (_, onRestore, check) => {
    using dir = tempDir("spies-of-a-file", {
      "a.test.ts": restoredThroughTrap(onRestore),
      "b.test.ts": `import { expect, test } from "bun:test"; test("b", () => ${check});`,
    });
    const { stderr, exitCode } = await runTests(String(dir), [], ["./a.test.ts", "./b.test.ts"]);
    expect({ results: results(stderr), exitCode }, stderr).toEqual({ results: ["(pass) a", "(pass) b"], exitCode: 0 });
  });

  test("spies made by a preload or its beforeAll() are kept across files", async () => {
    using dir = tempDir("spies-of-a-preload", {
      "preload.ts": `
        import { beforeAll, jest, vi } from "bun:test";
        globalThis.target = { loading: () => "original", hook: () => "original", file: () => "original" };
        vi.spyOn(target, "loading").mockReturnValue("spied");
        beforeAll(() => {
          jest.spyOn(target, "hook").mockReturnValue("spied");
        });
      `,
      "a.test.ts": `
        import { expect, test, vi } from "bun:test";
        test("a", () => {
          vi.spyOn(target, "file").mockReturnValue("spied");
          expect([target.loading(), target.hook(), target.file()]).toEqual(["spied", "spied", "spied"]);
        });
      `,
      "b.test.ts": `
        import { expect, test, vi } from "bun:test";
        test("b", () => {
          expect([target.loading(), target.hook(), target.file()]).toEqual(["spied", "spied", "original"]);
          vi.restoreAllMocks();
          expect([target.loading(), target.hook(), target.file()]).toEqual(["original", "original", "original"]);
        });
      `,
    });
    const { stderr, exitCode } = await runTests(
      String(dir),
      ["--preload", "./preload.ts"],
      ["./a.test.ts", "./b.test.ts"],
    );
    expect({ results: results(stderr), exitCode }).toEqual({ results: ["(pass) a", "(pass) b"], exitCode: 0 });
  });

  test("a preload's afterAll() sees the calls made in every file", async () => {
    using dir = tempDir("mocks-of-a-preload", {
      "preload.ts": `
        import { afterAll, expect, jest } from "bun:test";
        globalThis.reportProblem = jest.fn();
        afterAll(() => {
          expect(reportProblem).not.toHaveBeenCalled();
        });
      `,
      "a.test.ts": `
        import { test } from "bun:test";
        test("a", () => reportProblem("something is wrong"));
      `,
      "b.test.ts": `
        import { test } from "bun:test";
        test("b", () => {});
      `,
    });
    const { stderr, exitCode } = await runTests(
      String(dir),
      ["--preload", "./preload.ts"],
      ["./a.test.ts", "./b.test.ts"],
    );
    expect(stderr).toContain("Expected number of calls: 0\nReceived number of calls: 1\n");
    expect({ results: results(stderr), exitCode }).toEqual({
      results: ["(pass) a", "(pass) b", "(fail) (unnamed)"],
      exitCode: 1,
    });
  });

  describe.each([
    ["while it loads", (make: string) => make],
    ["in its beforeAll()", (make: string) => `beforeAll(() => { ${make} });`],
    ["in its beforeAll(), after an await", (make: string) => `beforeAll(async () => { await Bun.sleep(0); ${make} });`],
  ])("a mock that a preload makes %s", (_, where) => {
    const preload = `
      import { beforeAll, jest, mock, spyOn, vi } from "bun:test";
      ${where(`
        const target = { jest: () => "original", vi: () => "original", bun: () => "original" };
        globalThis.ofPreload = {
          "jest.fn()": jest.fn(),
          "jest.fn(implementation)": jest.fn(() => "initial"),
          "jest.fn().mockReturnValue()": jest.fn().mockReturnValue("configured"),
          "vi.fn()": vi.fn(),
          "vi.fn(implementation)": vi.fn(() => "initial"),
          "vi.fn().mockReturnValue()": vi.fn().mockReturnValue("configured"),
          "mock()": mock(),
          "mock(implementation)": mock(() => "initial"),
          "jest.spyOn()": jest.spyOn(target, "jest"),
          "vi.spyOn()": vi.spyOn(target, "vi"),
          "spyOn()": spyOn(target, "bun"),
          ...AUTOMOCKS,
        };
      `)}
    `;
    const automocks = `{
      "vi.mockObject()": vi.mockObject({ method() {} }).method,
      "a method of an instance of vi.mockObject(class)": new (vi.mockObject({ Class: class { method() {} } }).Class)().method,
    }`;
    const kinds = [
      "jest.fn()",
      "jest.fn(implementation)",
      "jest.fn().mockReturnValue()",
      "vi.fn()",
      "vi.fn(implementation)",
      "vi.fn().mockReturnValue()",
      "mock()",
      "mock(implementation)",
      "jest.spyOn()",
      "vi.spyOn()",
      "spyOn()",
    ];
    const calls = `Object.fromEntries(Object.entries(ofPreload).map(([kind, mocked]) => [kind, mocked.mock.calls.join()]))`;

    test.each([
      ["mocks and spies", "{}", kinds],
      ["automocks", automocks, [...kinds, "vi.mockObject()", "a method of an instance of vi.mockObject(class)"]],
    ])("keeps its calls from file to file: %s", async (_, automocks, kinds) => {
      const all = (value: string) => JSON.stringify(Object.fromEntries(kinds.map(kind => [kind, value])));
      using dir = tempDir("mocks-of-a-preload", {
        "preload.ts": preload.replace("AUTOMOCKS", automocks),
        "a.test.ts": `
          import { expect, test } from "bun:test";
          test("a", () => {
            for (const mocked of Object.values(ofPreload)) mocked("a");
            expect(${calls}).toEqual(${all("a")});
          });
        `,
        "b.test.ts": `
          import { expect, test } from "bun:test";
          test("b", () => {
            expect(${calls}).toEqual(${all("a")});
            for (const mocked of Object.values(ofPreload)) mocked("b");
          });
        `,
        "c.test.ts": `
          import { expect, jest, test } from "bun:test";
          test("c", () => {
            expect(${calls}).toEqual(${all("a,b")});
            jest.clearAllMocks();
            expect(${calls}).toEqual(${all("")});
          });
        `,
      });
      const { stderr, exitCode } = await runTests(
        String(dir),
        ["--preload", "./preload.ts"],
        ["./a.test.ts", "./b.test.ts", "./c.test.ts"],
      );
      expect({ results: results(stderr), exitCode }).toEqual({
        results: ["(pass) a", "(pass) b", "(pass) c"],
        exitCode: 0,
      });
    });
  });

  test("mocks made in a preload's beforeEach() are cleaned up with the file", async () => {
    using dir = tempDir("mocks-of-a-file", {
      "preload.ts": `
        import { beforeAll, beforeEach, jest } from "bun:test";
        globalThis.made = {};
        beforeAll(() => {});
        beforeEach(() => {
          made.beforeEachOfPreload ??= jest.fn();
        });
      `,
      "a.test.ts": `
        import { beforeAll, describe, expect, jest, test } from "bun:test";
        made.whileFileLoads = jest.fn();
        describe("describe", () => {
          made.inDescribe = jest.fn();
          beforeAll(() => {
            made.beforeAllOfFile = jest.fn();
          });
          test("a", () => {
            made.inTest = jest.fn();
            for (const mocked of Object.values(made)) mocked("a");
            expect(Object.keys(made)).toEqual(["whileFileLoads", "inDescribe", "beforeAllOfFile", "beforeEachOfPreload", "inTest"]);
          });
        });
      `,
      "b.test.ts": `
        import { expect, test } from "bun:test";
        test("b", () => expect(Object.values(made).map(mocked => mocked.mock.calls)).toEqual([[], [], [], [], []]));
      `,
    });
    const { stderr, exitCode } = await runTests(
      String(dir),
      ["--preload", "./preload.ts"],
      ["./a.test.ts", "./b.test.ts"],
    );
    expect({ results: results(stderr), exitCode }).toEqual({
      results: ["(pass) describe > a", "(pass) b"],
      exitCode: 0,
    });
  });

  test("the next file does not see the calls, and its clearAllMocks() does not visit the mocks", async () => {
    using dir = tempDir("mocks-of-a-file", {
      "a.test.ts": `
        import { expect, jest, test, vi } from "bun:test";
        test("a", () => {
          globalThis.ofFile = { jest: jest.fn(), vi: vi.fn() };
          globalThis.stateOfFile = ofFile.vi.mock;
          for (const mocked of Object.values(ofFile)) mocked("a");
          expect(ofFile.jest).toHaveBeenCalledTimes(1);
        });
      `,
      "b.test.ts": `
        import { expect, jest, test, vi } from "bun:test";
        test("b", () => {
          const { calls } = stateOfFile;
          expect(calls).toEqual([]);
          vi.clearAllMocks();
          expect(stateOfFile.calls).toBe(calls);
          expect([ofFile.jest.mock.calls, ofFile.vi.mock.calls]).toEqual([[], []]);

          for (const mocked of Object.values(ofFile)) mocked("b");
          vi.clearAllMocks();
          expect([ofFile.jest.mock.calls, ofFile.vi.mock.calls]).toEqual([[], []]);
        });
      `,
    });
    const { stderr, exitCode } = await runTests(String(dir), [], ["./a.test.ts", "./b.test.ts"]);
    expect({ results: results(stderr), exitCode }).toEqual({ results: ["(pass) a", "(pass) b"], exitCode: 0 });
  });

  describe("resetAllMocks() resets mocks that an earlier file configured", () => {
    const configure = `
      for (const mocked of Object.values(mocks)) mocked.mockReturnValue("configured").mockReturnValueOnce("once");
    `;
    const seen = `Object.values(mocks).map(mocked => [mocked(), mocked()])`;
    const configured = `[["once", "configured"], ["once", "configured"]]`;
    const a = (mocks: string) => `
      import { expect, jest, test, vi } from "bun:test";
      ${mocks}
      test("a", () => {
        ${configure}
      });
    `;
    const resetsInATest = (mocks: string, reset: string) => `
      import { expect, jest, test, vi } from "bun:test";
      ${mocks}
      test("it is still configured", () => expect(${seen}).toEqual(${configured}));
      test("b", () => {
        jest.resetAllMocks();
        expect(${seen}).toEqual(${reset});
      });
    `;
    const resetsBeforeEach = (mocks: string, reset: string) => `
      import { beforeEach, expect, jest, test, vi } from "bun:test";
      ${mocks}
      beforeEach(() => {
        jest.resetAllMocks();
      });
      test("b", () => expect(${seen}).toEqual(${reset}));
    `;

    describe.each([
      [
        "jest.fn()",
        `{ plain: jest.fn(), initial: jest.fn(() => "initial") }`,
        `[[undefined, undefined], [undefined, undefined]]`,
      ],
      [
        "vi.fn()",
        `{ plain: vi.fn(), initial: vi.fn(() => "initial") }`,
        `[[undefined, undefined], ["initial", "initial"]]`,
      ],
    ])("%s", (_, make, reset) => {
      test.each([
        ["in a module that both import", `import { mocks } from "./shared.ts";`, []],
        ["on an object that both reach", `const mocks = (globalThis.mocks ??= ${make});`, []],
        ["that a preload has made", `const { mocks } = globalThis;`, ["--preload", "./preload.ts"]],
      ])("%s", async (_, mocks, args) => {
        for (const b of [resetsInATest, resetsBeforeEach]) {
          using dir = tempDir("mocks-of-a-file", {
            "shared.ts": `import { jest, vi } from "bun:test"; export const mocks = ${make};`,
            "preload.ts": `import { jest, vi } from "bun:test"; globalThis.mocks = ${make};`,
            "a.test.ts": a(mocks),
            "b.test.ts": b(mocks, reset),
          });
          const { stderr, exitCode } = await runTests(String(dir), args, ["./a.test.ts", "./b.test.ts"]);
          expect({ results: results(stderr).filter(result => !result.includes("still")), exitCode }).toEqual({
            results: ["(pass) a", "(pass) b"],
            exitCode: 0,
          });
        }
      });

      test("between --rerun-each repeats", async () => {
        using dir = tempDir("mocks-of-a-file", {
          "a.test.ts": `
            import { expect, jest, test, vi } from "bun:test";
            const mocks = (globalThis.mocks ??= ${make});
            test("a", () => {
              jest.resetAllMocks();
              expect(${seen}).toEqual(${reset});
              ${configure}
            });
          `,
        });
        const { stderr, exitCode } = await runTests(String(dir), ["--rerun-each=3"], ["./a.test.ts"]);
        expect({ results: results(stderr), exitCode }).toEqual({ results: ["(pass) a"], exitCode: 0 });
      });
    });

    test("a mock name", async () => {
      using dir = tempDir("mocks-of-a-file", {
        "shared.ts": `import { jest, vi } from "bun:test"; export const mocks = [jest.fn(), vi.fn()];`,
        "a.test.ts": `
          import { test } from "bun:test";
          import { mocks } from "./shared.ts";
          test("a", () => mocks.forEach(mocked => mocked.mockName("named")));
        `,
        "b.test.ts": `
          import { expect, jest, test } from "bun:test";
          import { mocks } from "./shared.ts";
          test("b", () => {
            expect(mocks.map(mocked => mocked.getMockName())).toEqual(["named", "named"]);
            jest.resetAllMocks();
            expect(mocks.map(mocked => mocked.getMockName())).toEqual(["jest.fn()", "vi.fn()"]);
          });
        `,
      });
      const { stderr, exitCode } = await runTests(String(dir), [], ["./a.test.ts", "./b.test.ts"]);
      expect({ results: results(stderr), exitCode }).toEqual({ results: ["(pass) a", "(pass) b"], exitCode: 0 });
    });

    test("once", async () => {
      using dir = tempDir("mocks-of-a-file", {
        "a.test.ts": `
          import { test, vi } from "bun:test";
          test("a", () => {
            globalThis.prototypeReads = 0;
            const implementation = new Proxy(function () {}, {
              get(target, key, receiver) {
                if (key === "prototype") prototypeReads++;
                return Reflect.get(target, key, receiver);
              },
            });
            globalThis.mocked = vi.fn(implementation).mockReturnValue("configured");
            mocked.prototype;
          });
        `,
        "b.test.ts": `
          import { expect, test, vi } from "bun:test";
          test("b", () => {
            prototypeReads = 0;
            vi.resetAllMocks();
            expect([prototypeReads, mocked()]).toEqual([1, undefined]);
            vi.resetAllMocks();
            vi.resetAllMocks();
            expect(prototypeReads).toBe(1);
          });
        `,
      });
      const { stderr, exitCode } = await runTests(String(dir), [], ["./a.test.ts", "./b.test.ts"]);
      expect({ results: results(stderr), exitCode }).toEqual({ results: ["(pass) a", "(pass) b"], exitCode: 0 });
    });
  });
});

// The recorder's store relies on flock, so recording and reuse are Unix only: on Windows,
// `--reuse` says it is unavailable and every file runs.
describe.concurrent.skipIf(isWindows)("BUN_TEST_INPUT_RECORD_DIR writes one record of inputs per test file", () => {
  const recorderFixtures = {
    "package.json": `{ "name": "recorded" }`,
    "shared.ts": `export const value = 1;\n`,
    "a.test.ts": `
      import { expect, test } from "bun:test";
      import { value } from "./shared";
      test("a", () => {
        expect(() => require("./missing")).toThrow();
        expect(value).toBe(1);
      });
    `,
    "b.test.ts": `
      import { expect, test } from "bun:test";
      import { value } from "./shared";
      test("b", () => expect(value).toBe(1));
      test.skip("skipped", () => {});
    `,
  };
  const sha256 = (dir: string, file: string) =>
    new Bun.CryptoHasher("sha256").update(fs.readFileSync(join(dir, file))).digest("hex");

  function readRecords(dir: string) {
    const records = join(dir, "records");
    const names = fs.existsSync(records)
      ? fs
          .readdirSync(records)
          .filter(name => name.endsWith(".json"))
          .sort()
      : [];
    return names.map(name => {
      const record = JSON.parse(fs.readFileSync(join(records, name), "utf8"));
      const local = (p: string) =>
        p === record.root ? "." : p.startsWith(record.root + "/") ? p.slice(record.root.length + 1) : p;
      return {
        name,
        file: record.file,
        outcome: record.outcome,
        resolutions: record.resolutions.map((r: any) => [r.kind, local(r.specifier), local(r.importer), r.answer]),
        modules: record.modules,
      };
    });
  }

  function expected(dir: string, sharedCachedInB: boolean) {
    const shared = { path: "shared.ts", sha256: sha256(dir, "shared.ts"), loader: "ts" };
    return [
      {
        name: "a.test.ts.json",
        file: "a.test.ts",
        outcome: { pass: 1, fail: 0, skip: 0, todo: 0, expectations: 2, unhandledErrors: 0 },
        resolutions: [
          ["entry", "a.test.ts", ".", "a.test.ts"],
          ["import", "a.test.ts", "", "a.test.ts"],
          ["import", "./shared", "a.test.ts", "shared.ts"],
          ["require", "./missing", "a.test.ts", null],
        ],
        modules: [{ path: "a.test.ts", sha256: sha256(dir, "a.test.ts"), loader: "ts" }, shared],
      },
      {
        name: "b.test.ts.json",
        file: "b.test.ts",
        outcome: { pass: 1, fail: 0, skip: 1, todo: 0, expectations: 1, unhandledErrors: 0 },
        resolutions: [
          ["entry", "b.test.ts", ".", "b.test.ts"],
          ["import", "b.test.ts", "", "b.test.ts"],
          ["import", "./shared", "b.test.ts", "shared.ts"],
        ],
        modules: [
          { path: "b.test.ts", sha256: sha256(dir, "b.test.ts"), loader: "ts" },
          sharedCachedInB ? { ...shared, cached: true } : shared,
        ],
      },
    ];
  }

  test("--isolate records resolutions, hashed sources and outcomes, including sources served from the cache", async () => {
    using dir = tempDir("input-record", recorderFixtures);
    const env = { ...bunEnv, BUN_TEST_INPUT_RECORD_DIR: "records", BUN_TEST_INPUT_RECORD_JSON: "1" };
    const { stderr, exitCode } = await runTests(String(dir), ["--isolate"], ["./a.test.ts", "./b.test.ts"], env);
    expect({ records: readRecords(String(dir)), exitCode }).toEqual({
      records: expected(String(dir), true),
      exitCode: 0,
    });
    expect(stderr).toContain("2 pass");
  });

  test("--parallel=2 records the same questions and sources from every worker", async () => {
    using dir = tempDir("input-record-parallel", recorderFixtures);
    const env = { ...bunEnv, BUN_TEST_INPUT_RECORD_DIR: "records", BUN_TEST_INPUT_RECORD_JSON: "1" };
    const { exitCode } = await runTests(String(dir), ["--parallel=2"], ["./a.test.ts", "./b.test.ts"], env);
    const records = readRecords(String(dir)).map(r => ({ ...r, modules: r.modules.map(({ cached, ...m }: any) => m) }));
    expect({ records, exitCode }).toEqual({ records: expected(String(dir), false), exitCode: 0 });
  });

  test("a module that a finished file is still loading is not credited to the next file", async () => {
    using dir = tempDir("input-record-leftover", {
      "late.ts": `export const late = 1;\n`,
      "a.test.ts": `
        import { test } from "bun:test";
        test("a", () => {
          import("./late");
        });
      `,
      "b.test.ts": `
        import { test } from "bun:test";
        test("b", async () => {
          await Bun.sleep(1);
        });
      `,
    });
    const env = { ...bunEnv, BUN_TEST_INPUT_RECORD_DIR: "records", BUN_TEST_INPUT_RECORD_JSON: "1" };
    const { exitCode } = await runTests(String(dir), ["--isolate"], ["./a.test.ts", "./b.test.ts"], env);
    const records = readRecords(String(dir));
    expect({
      files: records.map(r => r.file),
      modulesOfB: records[1]?.modules.map((m: any) => m.path),
      exitCode,
    }).toEqual({ files: ["a.test.ts", "b.test.ts"], modulesOfB: ["b.test.ts"], exitCode: 0 });
  });

  test("without --isolate nothing is recorded", async () => {
    using dir = tempDir("input-record-off", recorderFixtures);
    const env = { ...bunEnv, BUN_TEST_INPUT_RECORD_DIR: "records", BUN_TEST_INPUT_RECORD_JSON: "1" };
    const { exitCode } = await runTests(String(dir), [], ["./a.test.ts", "./b.test.ts"], env);
    expect({ exists: fs.existsSync(join(String(dir), "records")), exitCode }).toEqual({ exists: false, exitCode: 0 });
  });
});

// The recorder's store relies on flock, so recording and reuse are Unix only: on Windows,
// `--reuse` says it is unavailable and every file runs.
describe.concurrent.skipIf(isWindows)("BUN_TEST_INPUT_REUSE skips test files whose record still holds", () => {
  const files = {
    "package.json": `{ "name": "reused" }`,
    "shared.ts": `export const value = 1;\n`,
    "only-c.ts": `export const c = 1;\n`,
    "a.test.ts": `
      import { expect, test } from "bun:test";
      import { value } from "./shared";
      test("a", () => expect(value).toBe(1));
    `,
    "b.test.ts": `
      import { expect, test } from "bun:test";
      import { value } from "./shared";
      test("b", () => expect(value).toBe(1));
      test.skip("skipped", () => {});
    `,
    "c.test.ts": `
      import { expect, test } from "bun:test";
      import { c } from "./only-c";
      test("c", () => expect(c).toBe(1));
    `,
    "spawns.test.ts": `
      import { expect, test } from "bun:test";
      test("spawns", () => expect(Bun.spawnSync({ cmd: [process.execPath, "--version"] }).exitCode).toBe(0));
    `,
  };
  const names = ["./a.test.ts", "./b.test.ts", "./c.test.ts", "./spawns.test.ts"];
  const record = { ...bunEnv, BUN_TEST_INPUT_RECORD_DIR: "records" };
  const reuse = { ...record, BUN_TEST_INPUT_REUSE: "explain" };
  const reusedFiles = (stderr: string) => [...stderr.matchAll(/^(\S+): reused, /gm)].map(m => m[1]).sort();

  test("a file whose modules and answers are unchanged is reused, one whose module changed runs", async () => {
    using dir = tempDir("input-reuse", files);
    const first = await runTests(String(dir), ["--isolate"], names, record);
    fs.writeFileSync(join(String(dir), "only-c.ts"), `export const c = 2;\n`);
    const { stderr, exitCode } = await runTests(String(dir), ["--isolate"], names, reuse);
    expect({ first: first.exitCode, reused: reusedFiles(stderr), exitCode }).toEqual({
      first: 0,
      reused: ["a.test.ts", "b.test.ts"],
      exitCode: 1,
    });
    expect(stderr).toContain("reuse: spawns.test.ts runs: mark spawn");
    expect(stderr).toContain("2 files reused, not run");
    expect(stderr).toMatch(/3 pass\s+1 skip\s+1 fail/);
  });

  test("a file whose import now resolves to another file runs", async () => {
    using dir = tempDir("input-reuse-shadow", files);
    await runTests(String(dir), ["--isolate"], names, record);
    fs.writeFileSync(join(String(dir), "shared.tsx"), `export const value = 1;\n`);
    fs.rmSync(join(String(dir), "shared.ts"));
    const { stderr, exitCode } = await runTests(String(dir), ["--isolate"], names, reuse);
    expect({ reused: reusedFiles(stderr), exitCode }).toEqual({ reused: ["c.test.ts"], exitCode: 0 });
  });

  test("a record holds in another checkout of the same files", async () => {
    using dir = tempDir("input-reuse-moved", { here: files });
    const here = join(String(dir), "here");
    await runTests(here, ["--isolate"], names, record);
    fs.cpSync(here, join(String(dir), "there"), { recursive: true });
    const { stderr, exitCode } = await runTests(join(String(dir), "there"), ["--isolate"], names, reuse);
    expect({ reused: reusedFiles(stderr), exitCode }).toEqual({
      reused: ["a.test.ts", "b.test.ts", "c.test.ts"],
      exitCode: 0,
    });
  });

  test("--shard deals the files before reuse, so shards with their own stores each reuse and report only their own", async () => {
    const four = Object.fromEntries(
      ["a", "b", "c", "d"].map(name => [
        `${name}.test.ts`,
        `import { expect, test } from "bun:test";\ntest("${name}", () => expect(1).toBe(1));\n`,
      ]),
    );
    using dir = tempDir("input-reuse-shard", { "package.json": `{ "name": "sharded" }`, ...four });
    const all = ["./a.test.ts", "./b.test.ts", "./c.test.ts", "./d.test.ts"];
    const shard = (n: number, mode?: string) =>
      runTests(String(dir), ["--isolate", `--shard=${n}/2`], all, {
        ...bunEnv,
        BUN_TEST_INPUT_RECORD_DIR: `records-${n}`,
        BUN_TEST_INPUT_REUSE: mode,
      });
    await shard(1);
    await shard(2);
    const [one, two] = [await shard(1, "explain"), await shard(2, "explain")];
    const runs = (stderr: string) => [...stderr.matchAll(/^reuse: (\S+) runs: /gm)].map(m => m[1]);
    expect({
      one: reusedFiles(one.stderr),
      oneRuns: runs(one.stderr),
      two: reusedFiles(two.stderr),
      twoRuns: runs(two.stderr),
    }).toEqual({ one: ["a.test.ts", "c.test.ts"], oneRuns: [], two: ["b.test.ts", "d.test.ts"], twoRuns: [] });
    expect(one.stderr).toMatch(/2 pass/);
    expect(two.stderr).toMatch(/2 pass/);
  });

  test("a write that fails leaves what is there an input", async () => {
    using dir = tempDir("input-reuse-failed-write", {
      "package.json": `{ "name": "failed-write" }`,
      "fixtures/data.json": `{ "v": 1 }`,
      "fixtures/mod.ts": `export const m = 1;\n`,
      "w.test.ts": `
        import { expect, test } from "bun:test";
        import { mkdirSync, readFileSync, rmdirSync, symlinkSync, linkSync, promises } from "node:fs";
        test("ensure the directory, then use it", async () => {
          const dir = import.meta.dir + "/fixtures";
          try { mkdirSync(dir); } catch {}
          try { rmdirSync(dir); } catch {}
          try { symlinkSync("elsewhere", dir + "/data.json"); } catch {}
          try { linkSync(dir + "/mod.ts", dir + "/data.json"); } catch {}
          await promises.mkdir(dir).catch(() => {});
          expect(JSON.parse(readFileSync(dir + "/data.json", "utf8")).v).toBe(1);
          const { m } = await import("./fixtures/mod.ts");
          expect(m).toBe(1);
        });
      `,
    });
    const one = ["./w.test.ts"];
    await runTests(String(dir), ["--isolate"], one, record);
    const unchanged = await runTests(String(dir), ["--isolate"], one, reuse);
    fs.writeFileSync(join(String(dir), "fixtures", "data.json"), `{ "v": 2 }`);
    const data = await runTests(String(dir), ["--isolate"], one, reuse);
    fs.writeFileSync(join(String(dir), "fixtures", "data.json"), `{ "v": 1 }`);
    await runTests(String(dir), ["--isolate"], one, record);
    fs.writeFileSync(join(String(dir), "fixtures", "mod.ts"), `export const m = 2;\n`);
    const mod = await runTests(String(dir), ["--isolate"], one, reuse);
    expect({
      unchanged: reusedFiles(unchanged.stderr),
      data: reusedFiles(data.stderr),
      mod: reusedFiles(mod.stderr),
    }).toEqual({ unchanged: ["w.test.ts"], data: [], mod: [] });
    expect(data.stderr).toContain("reuse: w.test.ts runs: own-read content fixtures/data.json");
    expect(mod.stderr).toContain("reuse: w.test.ts runs: changed fixtures/mod.ts");
  });

  test("what a link, a rename or a merging copy brings into the file's own paths is still an input", async () => {
    const body = (name: string, code: string) => `
      import { expect, test } from "bun:test";
      import * as fs from "node:fs";
      import { tmpdir } from "node:os";
      import { join, relative } from "node:path";
      test("${name}", async () => {
        const fixtures = join(import.meta.dir, "fixtures");
        ${code}
      });
    `;
    using dir = tempDir("input-reuse-links", {
      "package.json": `{ "name": "links" }`,
      "fixtures/sym.txt": "sym-v1",
      "fixtures/hard.txt": "hard-v1",
      "fixtures/moved.txt": "moved-v1",
      "fixtures/merge/pre.txt": "pre-v1",
      "fixtures/copied/other.txt": "other",
      "fixtures/linked-dir/inner.txt": "inner-v1",
      "fixtures/into/pre.txt": "into-v1",
      "sym.test.ts": body(
        "symlink into a temp directory",
        `const tmp = fs.mkdtempSync(join(tmpdir(), "sym-"));
        fs.symlinkSync(join(fixtures, "sym.txt"), join(tmp, "data.txt"));
        fs.symlinkSync(relative(tmp, join(fixtures, "linked-dir")), join(tmp, "dir"));
        expect(fs.readFileSync(join(tmp, "data.txt"), "utf8")).toBe("sym-v1");
        expect(fs.readFileSync(join(tmp, "dir", "inner.txt"), "utf8")).toBe("inner-v1");`,
      ),
      "hard.test.ts": body(
        "hard link into a temp directory",
        `const tmp = fs.mkdtempSync(join(tmpdir(), "hard-"));
        fs.linkSync(join(fixtures, "hard.txt"), join(tmp, "x"));
        expect(fs.readFileSync(join(tmp, "x"), "utf8")).toBe("hard-v1");`,
      ),
      "rename.test.ts": body(
        "rename there and back",
        `fs.renameSync(join(fixtures, "moved.txt"), join(fixtures, "moved2.txt"));
        const text = fs.readFileSync(join(fixtures, "moved2.txt"), "utf8");
        fs.renameSync(join(fixtures, "moved2.txt"), join(fixtures, "moved.txt"));
        expect(text).toBe("moved-v1");`,
      ),
      "cp.test.ts": body(
        "copy into a directory that is there",
        `await fs.promises.cp(join(fixtures, "copied"), join(fixtures, "merge"), { recursive: true });
        fs.cpSync(join(fixtures, "copied"), join(fixtures, "merge"), { recursive: true });
        expect(fs.readFileSync(join(fixtures, "merge", "pre.txt"), "utf8")).toBe("pre-v1");
        fs.rmSync(join(fixtures, "merge", "other.txt"));`,
      ),
      "extract.test.ts": body(
        "extract into a directory that is there",
        `await new Bun.Archive({ "new.txt": "new" }).extract(join(fixtures, "into"));
        expect(fs.readFileSync(join(fixtures, "into", "pre.txt"), "utf8")).toBe("into-v1");
        fs.rmSync(join(fixtures, "into", "new.txt"));`,
      ),
    });
    const five = ["./sym.test.ts", "./hard.test.ts", "./rename.test.ts", "./cp.test.ts", "./extract.test.ts"];
    await runTests(String(dir), ["--isolate"], five, record);
    const unchanged = await runTests(String(dir), ["--isolate"], five, reuse);
    const edit = (file: string, text: string) => fs.writeFileSync(join(String(dir), "fixtures", file), text);
    edit("sym.txt", "sym-v2");
    edit("hard.txt", "hard-v2");
    edit("moved.txt", "moved-v2");
    edit("merge/pre.txt", "pre-v2");
    edit("into/pre.txt", "into-v2");
    const edited = await runTests(String(dir), ["--isolate"], five, reuse);
    edit("sym.txt", "sym-v1");
    edit("hard.txt", "hard-v1");
    edit("moved.txt", "moved-v1");
    edit("merge/pre.txt", "pre-v1");
    edit("into/pre.txt", "into-v1");
    await runTests(String(dir), ["--isolate"], five, record);
    edit("linked-dir/inner.txt", "inner-v2");
    const inner = await runTests(String(dir), ["--isolate"], five, reuse);
    expect({
      unchanged: reusedFiles(unchanged.stderr),
      edited: reusedFiles(edited.stderr),
      inner: reusedFiles(inner.stderr),
    }).toEqual({
      // What an extract writes into a directory that was there stays an input too, so that file
      // runs every time; it must not be reused when what was there changed.
      unchanged: ["cp.test.ts", "hard.test.ts", "rename.test.ts", "sym.test.ts"],
      edited: [],
      inner: ["cp.test.ts", "hard.test.ts", "rename.test.ts"],
    });
  });

  test("mkdtemp marks the directory it made, not every path that starts with its prefix", async () => {
    using dir = tempDir("input-reuse-mkdtemp", {
      "package.json": `{ "name": "mkdtemp" }`,
      "late.ts": `export const late = 1;\n`,
      "run-old/data.txt": "old-v1",
      "t.test.ts": `
        import { expect, test } from "bun:test";
        import { mkdtempSync, readFileSync } from "node:fs";
        import { dirname, sep } from "node:path";
        test("a prefix that is a directory, and a prefix of siblings", async () => {
          mkdtempSync(dirname(import.meta.dir) + sep);
          mkdtempSync(import.meta.dir + sep + "run-");
          expect(readFileSync(import.meta.dir + "/run-old/data.txt", "utf8")).toBe("old-v1");
          const { late } = await import("./late.ts");
          expect(late).toBe(1);
        });
      `,
    });
    const one = ["./t.test.ts"];
    await runTests(String(dir), ["--isolate"], one, record);
    const unchanged = await runTests(String(dir), ["--isolate"], one, reuse);
    fs.writeFileSync(join(String(dir), "late.ts"), `export const late = 2;\n`);
    const late = await runTests(String(dir), ["--isolate"], one, reuse);
    fs.writeFileSync(join(String(dir), "late.ts"), `export const late = 1;\n`);
    await runTests(String(dir), ["--isolate"], one, record);
    fs.writeFileSync(join(String(dir), "run-old", "data.txt"), "old-v2");
    const sibling = await runTests(String(dir), ["--isolate"], one, reuse);
    expect({
      unchanged: reusedFiles(unchanged.stderr),
      late: reusedFiles(late.stderr),
      sibling: reusedFiles(sibling.stderr),
    }).toEqual({ unchanged: ["t.test.ts"], late: [], sibling: [] });
  });

  test("a content look at a device is its kind: nothing is read from it", async () => {
    using dir = tempDir("input-reuse-devices", {
      "package.json": `{ "name": "devices" }`,
      "dev.test.ts": `
        import { expect, test } from "bun:test";
        import { appendFileSync } from "node:fs";
        test("devices", async () => {
          // Not /dev/stdout or /dev/stderr: on Linux they do not open when the descriptor is a
          // socket, as it is for a child spawned with piped stdio.
          await Bun.write(Bun.file("/dev/null"), "to null\\n");
          appendFileSync("/dev/null", "to null\\n");
          expect(Bun.file("/dev/urandom").name).toBe("/dev/urandom");
          expect(Bun.file("/dev/zero").name).toBe("/dev/zero");
        });
      `,
    });
    const one = ["./dev.test.ts"];
    const first = await runTests(String(dir), ["--isolate"], one, { ...record, BUN_TEST_INPUT_RECORD_JSON: "1" });
    const again = await runTests(String(dir), ["--isolate"], one, reuse);
    const json = JSON.parse(fs.readFileSync(join(String(dir), "records", "dev.test.ts.json"), "utf8"));
    expect({
      first: first.exitCode,
      reused: reusedFiles(again.stderr),
      reads: json.reads
        .filter((it: any) => it.look === "content" && !it.extra)
        .map((it: any) => [it.path, it.value])
        .sort(),
    }).toEqual({
      first: 0,
      reused: ["dev.test.ts"],
      reads: [
        ["/dev/null", "not a file"],
        ["/dev/urandom", "not a file"],
        ["/dev/zero", "not a file"],
      ],
    });
  });

  test("an HTML import, a module with no file and a resolution that throws make the record not reusable", async () => {
    using dir = tempDir("input-reuse-unseen", {
      "package.json": `{ "name": "unseen" }`,
      "index.html": `<!doctype html><html><head><script type="module" src="./app.ts"></script></head></html>`,
      "app.ts": `console.log("app");\n`,
      "html.test.ts": `
        import { expect, test } from "bun:test";
        import page from "./index.html";
        test("html", () => expect(page).toBeDefined());
      `,
      "ns.test.ts": `
        import { expect, test } from "bun:test";
        Bun.plugin({
          name: "virtual namespace",
          setup(build) {
            build.onLoad({ filter: /.*/, namespace: "virt" }, () => ({ contents: "export default 1;", loader: "js" }));
          },
        });
        test("namespace", async () => expect((await import("virt:thing")).default).toBe(1));
      `,
      "throws.test.ts": `
        import { expect, test } from "bun:test";
        Bun.plugin({
          name: "throws",
          setup(build) {
            build.onResolve({ filter: /^boom$/ }, () => { throw new Error("boom"); });
          },
        });
        test("throws", async () => expect(import("boom")).rejects.toThrow("boom"));
      `,
    });
    const three = ["./html.test.ts", "./ns.test.ts", "./throws.test.ts"];
    const first = await runTests(String(dir), ["--isolate"], three, record);
    const again = await runTests(String(dir), ["--isolate"], three, reuse);
    expect({ first: first.exitCode, reused: reusedFiles(again.stderr) }).toEqual({ first: 0, reused: [] });
    expect(again.stderr).toContain("reuse: html.test.ts runs: mark html-bundle");
    expect(again.stderr).toContain("reuse: ns.test.ts runs: mark module-without-file");
    expect(again.stderr).toContain("reuse: throws.test.ts runs: mark resolve-threw");
  });

  test("the owner's permission bits and access() with a mode are inputs", async () => {
    using dir = tempDir("input-reuse-mode", {
      "package.json": `{ "name": "mode" }`,
      "bin/cli.sh": "#!/bin/sh\n",
      "stat.test.ts": `
        import { expect, test } from "bun:test";
        import { statSync } from "node:fs";
        test("executable by mode", () => expect(statSync(import.meta.dir + "/bin/cli.sh").mode & 0o100).toBe(0o100));
      `,
      "access.test.ts": `
        import { expect, test } from "bun:test";
        import { accessSync, constants } from "node:fs";
        test("executable by access", () => expect(() => accessSync(import.meta.dir + "/bin/cli.sh", constants.X_OK)).not.toThrow());
      `,
    });
    const cli = join(String(dir), "bin", "cli.sh");
    fs.chmodSync(cli, 0o755);
    const two = ["./access.test.ts", "./stat.test.ts"];
    await runTests(String(dir), ["--isolate"], two, record);
    const unchanged = await runTests(String(dir), ["--isolate"], two, reuse);
    fs.chmodSync(cli, 0o644);
    const dropped = await runTests(String(dir), ["--isolate"], two, reuse);
    expect({
      unchanged: reusedFiles(unchanged.stderr),
      dropped: [reusedFiles(dropped.stderr), dropped.exitCode],
    }).toEqual({ unchanged: ["access.test.ts", "stat.test.ts"], dropped: [[], 1] });
    expect(dropped.stderr).toContain("reuse: stat.test.ts runs: own-read stat bin/cli.sh");
    expect(dropped.stderr).toContain("reuse: access.test.ts runs: own-read access bin/cli.sh");
  });

  test("BUN_TEST_INPUT_REUSE off values reuse nothing, and an unknown value is an error", async () => {
    using dir = tempDir("input-reuse-switch", files);
    await runTests(String(dir), ["--isolate"], names, record);
    const off = await Promise.all(
      ["0", "false", "no", "off"].map(async value => {
        const { stderr } = await runTests(String(dir), ["--isolate"], names, {
          ...record,
          BUN_TEST_INPUT_REUSE: value,
        });
        return reusedFiles(stderr).length;
      }),
    );
    const on = await runTests(String(dir), ["--isolate"], names, { ...record, BUN_TEST_INPUT_REUSE: "true" });
    const typo = await runTests(String(dir), ["--isolate"], names, { ...record, BUN_TEST_INPUT_REUSE: "flase" });
    expect({
      off,
      on: reusedFiles(on.stderr),
      typo: typo.exitCode,
    }).toEqual({ off: [0, 0, 0, 0], on: ["a.test.ts", "b.test.ts", "c.test.ts"], typo: 1 });
    expect(typo.stderr).toContain("BUN_TEST_INPUT_REUSE=flase is not one of");
  });

  test("paths are kept from the repository root, so imports and reads outside the package hold in another checkout", async () => {
    using dir = tempDir("input-reuse-repo", {
      here: {
        "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
        "config.txt": "v1",
        "node_modules/dep/package.json": `{ "name": "dep", "main": "index.js" }`,
        "node_modules/dep/index.js": `module.exports = "dep";\n`,
        "packages/lib/index.ts": `export const lib = "lib-v1";\n`,
        "packages/app/package.json": `{ "name": "app" }`,
        "packages/app/local.ts": `export const local = 1;\n`,
        "packages/app/a.test.ts": `
          import { expect, test } from "bun:test";
          import { readFileSync } from "node:fs";
          import { lib } from "../lib/index.ts";
          import dep from "dep";
          test("a", () => expect([lib, dep, readFileSync(import.meta.dir + "/../../config.txt", "utf8")]).toEqual(["lib-v1", "dep", "v1"]));
        `,
        "packages/app/b.test.ts": `
          import { expect, test } from "bun:test";
          import { local } from "./local";
          test("b", () => expect(local).toBe(1));
        `,
      },
    });
    const pair = ["./a.test.ts", "./b.test.ts"];
    await runTests(join(String(dir), "here", "packages", "app"), ["--isolate"], pair, record);
    fs.cpSync(join(String(dir), "here"), join(String(dir), "there"), { recursive: true });
    const there = join(String(dir), "there", "packages", "app");
    const moved = await runTests(there, ["--isolate"], pair, reuse);
    fs.writeFileSync(join(String(dir), "there", "config.txt"), "v2");
    const edited = await runTests(there, ["--isolate"], pair, reuse);
    expect({ moved: reusedFiles(moved.stderr), edited: reusedFiles(edited.stderr) }).toEqual({
      moved: ["a.test.ts", "b.test.ts"],
      edited: ["b.test.ts"],
    });
    expect(edited.stderr).toContain("reuse: a.test.ts runs: own-read content ");
  });

  test("with every file reused the run passes, and a failed file is never reused", async () => {
    using dir = tempDir("input-reuse-fail", {
      ...files,
      "fails.test.ts": `
        import { expect, test } from "bun:test";
        test("fails", () => expect(1).toBe(2));
      `,
    });
    await runTests(String(dir), ["--isolate"], ["./a.test.ts", "./fails.test.ts"], record);
    const onlyA = await runTests(String(dir), ["--isolate"], ["./a.test.ts"], reuse);
    const both = await runTests(String(dir), ["--isolate"], ["./a.test.ts", "./fails.test.ts"], reuse);
    expect({
      onlyA: [reusedFiles(onlyA.stderr), onlyA.exitCode],
      both: [reusedFiles(both.stderr), both.exitCode],
    }).toEqual({ onlyA: [["a.test.ts"], 0], both: [["a.test.ts"], 1] });
    expect(both.stderr).toContain("reuse: fails.test.ts runs: failed");
  });

  test("check runs every file and fails when one whose record held now has other counts", async () => {
    using dir = tempDir("input-reuse-check", {
      ...files,
      "flavor.test.ts": `
        import { expect, test } from "bun:test";
        test("flavor", () => expect(process.env.FLAVOR).toBe("a"));
      `,
    });
    const these = ["./a.test.ts", "./flavor.test.ts", "./spawns.test.ts"];
    await runTests(String(dir), ["--isolate"], these, { ...record, FLAVOR: "a" });
    const report = join(String(dir), "report.jsonl");
    const check = { ...record, BUN_TEST_INPUT_REUSE: "check", BUN_TEST_INPUT_REUSE_REPORT: report };
    const same = await runTests(String(dir), ["--isolate"], these, { ...check, FLAVOR: "a" });
    const differs = await runTests(String(dir), ["--isolate"], these, { ...check, FLAVOR: "b" });
    const lines = fs
      .readFileSync(report, "utf8")
      .trim()
      .split("\n")
      .map(line => JSON.parse(line));
    expect({
      same: [same.exitCode, same.stderr.includes("reuse check: would reuse 2, mismatches 0")],
      differs: [differs.exitCode, differs.stderr.includes("reuse check: would reuse 2, mismatches 1")],
      ran: differs.stderr.match(/(\d+) pass/)?.[1],
      lines,
    }).toEqual({
      same: [0, true],
      differs: [1, true],
      ran: "2",
      lines: [
        { file: "a.test.ts", held: true },
        { file: "flavor.test.ts", held: true },
        { file: "spawns.test.ts", held: false, why: "mark", detail: "spawn" },
        { file: "a.test.ts", check: "same" },
        {
          file: "flavor.test.ts",
          check: "differs",
          recorded: { pass: 1, fail: 0, skip: 0, todo: 0, expectations: 1, unhandledErrors: 0 },
          thisRun: { pass: 0, fail: 1, skip: 0, todo: 0, expectations: 1, unhandledErrors: 0 },
        },
      ],
    });
    expect(differs.stderr).toContain("flavor.test.ts would have been reused, but its outcome differs");
    expect(differs.stderr).not.toContain("<red>");
  });

  test("a file runs again when what its own code read changed, not when it only read what it wrote", async () => {
    using dir = tempDir("input-reuse-own-reads", {
      ...files,
      "data.txt": "v1",
      "listed/one": "",
      "reads.test.ts": `
        import { expect, test } from "bun:test";
        import * as fs from "node:fs";
        test("reads", async () => {
          expect(fs.readFileSync(import.meta.dir + "/data.txt", "utf8")).toBe("v1");
          expect(await fs.promises.readdir(import.meta.dir + "/listed")).toEqual(["one"]);
        });
      `,
      "writes.test.ts": `
        import { expect, test } from "bun:test";
        import * as fs from "node:fs";
        test("writes", async () => {
          fs.mkdirSync(import.meta.dir + "/out", { recursive: true });
          fs.writeFileSync(import.meta.dir + "/out/w.txt", String(Date.now()));
          expect(fs.readFileSync(import.meta.dir + "/out/w.txt", "utf8").length).toBeGreaterThan(0);
          await Bun.write(import.meta.dir + "/out/b.txt", String(Math.random()));
          expect((await Bun.file(import.meta.dir + "/out/b.txt").text()).length).toBeGreaterThan(0);
        });
      `,
    });
    const these = ["./a.test.ts", "./reads.test.ts", "./writes.test.ts"];
    await runTests(String(dir), ["--isolate"], these, record);
    const unchanged = await runTests(String(dir), ["--isolate"], these, reuse);
    fs.writeFileSync(join(String(dir), "data.txt"), "v2");
    const content = await runTests(String(dir), ["--isolate"], these, reuse);
    fs.writeFileSync(join(String(dir), "data.txt"), "v1");
    await runTests(String(dir), ["--isolate"], these, record);
    fs.writeFileSync(join(String(dir), "listed/two"), "");
    const listing = await runTests(String(dir), ["--isolate"], these, reuse);
    expect({
      unchanged: reusedFiles(unchanged.stderr),
      content: [reusedFiles(content.stderr), content.exitCode],
      listing: [reusedFiles(listing.stderr), listing.exitCode],
    }).toEqual({
      unchanged: ["a.test.ts", "reads.test.ts", "writes.test.ts"],
      content: [["a.test.ts", "writes.test.ts"], 1],
      listing: [["a.test.ts", "writes.test.ts"], 1],
    });
    expect(content.stderr).toContain("reuse: reads.test.ts runs: own-read content data.txt");
    expect(listing.stderr).toContain("reuse: reads.test.ts runs: own-read list listed");
  });

  test("a file with module mocks is reused, and runs again when its manual mock changes or appears", async () => {
    using dir = tempDir("input-reuse-mocks", {
      ...files,
      "dep.ts": `export const dep = "real";\n`,
      "user.ts": `import { dep } from "./dep";\nexport const use = () => "user:" + dep;\n`,
      "auto.ts": `export const auto = "real";\n`,
      "plain.ts": `export const plain = "real";\n`,
      "__mocks__/auto.ts": `export const auto = "manual";\n`,
      "factory.test.ts": `
        import { expect, mock, test } from "bun:test";
        test("factory", async () => {
          mock.module("./dep", () => ({ dep: "mocked" }));
          expect((await import("./user")).use()).toBe("user:mocked");
        });
      `,
      "manual.test.ts": `
        import { expect, test, vi } from "bun:test";
        test("manual", async () => {
          vi.mock("./auto");
          vi.mock("./plain");
          expect([(await import("./auto")).auto, (await import("./plain")).plain]).toEqual(["manual", "real"]);
        });
      `,
    });
    const these = ["./factory.test.ts", "./manual.test.ts"];
    await runTests(String(dir), ["--isolate"], these, record);
    const unchanged = await runTests(String(dir), ["--isolate"], these, reuse);
    fs.writeFileSync(join(String(dir), "__mocks__/plain.ts"), `export const plain = "manual";\n`);
    const appeared = await runTests(String(dir), ["--isolate"], these, reuse);
    expect({
      unchanged: reusedFiles(unchanged.stderr),
      appeared: [reusedFiles(appeared.stderr), appeared.exitCode],
    }).toEqual({ unchanged: ["factory.test.ts", "manual.test.ts"], appeared: [["factory.test.ts"], 1] });
  });

  test("a store of another format or records of another fingerprint are ignored, and the run says so once without explain", async () => {
    using dir = tempDir("input-reuse-ignored", files);
    const two = ["./a.test.ts", "./c.test.ts"];
    const plain = { ...record, BUN_TEST_INPUT_REUSE: "1" };
    await runTests(String(dir), ["--isolate"], two, record);
    const storeFile = join(String(dir), "records", "store.btis");
    const bytes = fs.readFileSync(storeFile);
    bytes.writeUInt32LE(0, 4);
    fs.writeFileSync(storeFile, bytes);
    const format = await runTests(String(dir), ["--isolate"], two, plain);
    const replaced = await runTests(String(dir), ["--isolate"], two, plain);
    const salted = await runTests(String(dir), ["--isolate"], two, { ...plain, BUN_TEST_INPUT_RECORD_SALT: "other" });
    expect({
      format: reusedFiles(format.stderr),
      replaced: reusedFiles(replaced.stderr),
      salted: reusedFiles(salted.stderr),
    }).toEqual({
      format: [],
      replaced: ["a.test.ts", "c.test.ts"],
      salted: [],
    });
    expect(format.stderr).toContain(
      "reuse: 1 file of another record store format ignored; this run's records replace it",
    );
    expect(replaced.stderr).not.toContain("ignored");
    expect(salted.stderr).toContain("2 records ignored: written by another build or with other settings");
  });

  test("an addon that Bun refuses to load is no mark, and its file is an input", async () => {
    using dir = tempDir("input-reuse-refused-addon", {
      ...files,
      "build/better_sqlite3.node": "not an addon v1",
      "refused.test.ts": `
        import { expect, test } from "bun:test";
        test("falls back", () => {
          expect(() => require("./build/better_sqlite3.node")).toThrow("not yet supported in Bun");
        });
      `,
    });
    const these = ["./a.test.ts", "./refused.test.ts"];
    await runTests(String(dir), ["--isolate"], these, record);
    const unchanged = await runTests(String(dir), ["--isolate"], these, reuse);
    fs.writeFileSync(join(String(dir), "build/better_sqlite3.node"), "not an addon v2");
    const edited = await runTests(String(dir), ["--isolate"], these, reuse);
    expect({
      unchanged: reusedFiles(unchanged.stderr),
      edited: [reusedFiles(edited.stderr), edited.exitCode],
    }).toEqual({ unchanged: ["a.test.ts", "refused.test.ts"], edited: [["a.test.ts"], 0] });
    expect(edited.stderr).toContain("reuse: refused.test.ts runs: changed build/better_sqlite3.node");
  });

  test("a module the file wrote before importing it is no input, and what it imports still is", async () => {
    using dir = tempDir("input-reuse-generated", {
      ...files,
      "dep.ts": `export const dep = "v1";\n`,
      "late.ts": `export const late = "late-v1";\n`,
      "temp.test.ts": `
        import { expect, test } from "bun:test";
        import { mkdtempSync, writeFileSync } from "node:fs";
        import { tmpdir } from "node:os";
        import { join } from "node:path";
        test("temp", async () => {
          const file = join(mkdtempSync(join(tmpdir(), "generated-")), "m.mjs");
          writeFileSync(file, "export { dep } from " + JSON.stringify(join(import.meta.dir, "dep.ts")) + ";");
          expect((await import(file)).dep).toBe("v1");
        });
      `,
      "inside.test.ts": `
        import { expect, test } from "bun:test";
        import { mkdirSync, writeFileSync } from "node:fs";
        test("inside", async () => {
          mkdirSync(import.meta.dir + "/gen", { recursive: true });
          const file = import.meta.dir + "/gen/m" + Math.random().toString(36).slice(2) + ".mjs";
          writeFileSync(file, "export { dep } from '../dep.ts';");
          expect((await import(file)).dep).toBe("v1");
        });
      `,
      "late.test.ts": `
        import { expect, test } from "bun:test";
        import { readFileSync, writeFileSync } from "node:fs";
        import { late } from "./late";
        test("late", () => {
          writeFileSync(import.meta.dir + "/late.ts", readFileSync(import.meta.dir + "/late.ts", "utf8"));
          expect(late).toBe("late-v1");
        });
      `,
    });
    const these = ["./a.test.ts", "./temp.test.ts", "./inside.test.ts", "./late.test.ts"];
    await runTests(String(dir), ["--isolate"], these, record);
    const first = await runTests(String(dir), ["--isolate"], these, reuse);
    const second = await runTests(String(dir), ["--isolate"], these, reuse);
    fs.writeFileSync(join(String(dir), "dep.ts"), `export const dep = "v2";\n`);
    const dep = await runTests(String(dir), ["--isolate"], these, reuse);
    fs.writeFileSync(join(String(dir), "dep.ts"), `export const dep = "v1";\n`);
    fs.writeFileSync(join(String(dir), "late.ts"), `export const late = "late-v2";\n`);
    const late = await runTests(String(dir), ["--isolate"], these, reuse);
    const all = ["a.test.ts", "inside.test.ts", "late.test.ts", "temp.test.ts"];
    expect({
      first: reusedFiles(first.stderr),
      second: reusedFiles(second.stderr),
      dep: [reusedFiles(dep.stderr), dep.exitCode],
      late: [reusedFiles(late.stderr), late.exitCode],
    }).toEqual({
      first: all,
      second: all,
      dep: [["a.test.ts", "late.test.ts"], 1],
      late: [["a.test.ts", "inside.test.ts", "temp.test.ts"], 1],
    });
    expect(dep.stderr).toContain("reuse: temp.test.ts runs: changed dep.ts");
    expect(dep.stderr).toContain("reuse: inside.test.ts runs: changed dep.ts");
  });

  test("check says a different number of expect() calls alone, without failing the run", async () => {
    using dir = tempDir("input-reuse-check-expectations", {
      ...files,
      "varies.test.ts": `
        import { expect, test } from "bun:test";
        test("varies", () => {
          for (let i = 0; i < Number(process.env.EXPECTS ?? 1); i++) expect(i).toBe(i);
        });
      `,
    });
    const these = ["./a.test.ts", "./varies.test.ts"];
    await runTests(String(dir), ["--isolate"], these, { ...record, EXPECTS: "1" });
    const check = await runTests(String(dir), ["--isolate"], these, {
      ...record,
      BUN_TEST_INPUT_REUSE: "check",
      EXPECTS: "3",
    });
    expect(check.exitCode).toBe(0);
    expect(check.stderr).toContain(
      "reuse check: varies.test.ts has the recorded outcome, with 3 expect() calls where the record has 1",
    );
    expect(check.stderr).toContain("reuse check: would reuse 2, mismatches 0, other expect() counts 1");
    expect(check.stderr).not.toContain("would have been reused, but its outcome differs");
  });

  test("a text file imported with ?raw by several files, some from the cache, is reused and reruns them when edited", async () => {
    const raw = `
      import { expect, test } from "bun:test";
      import changelog from "./CHANGELOG.md?raw";
      test("raw", () => expect(String(changelog)).toContain("v1"));
    `;
    using dir = tempDir("input-reuse-raw", {
      ...files,
      "CHANGELOG.md": "# Changelog\n\nv1\n",
      "r1.test.ts": raw,
      "r2.test.ts": raw,
      "r3.test.ts": raw,
    });
    const these = ["./r1.test.ts", "./r2.test.ts", "./r3.test.ts"];
    await runTests(String(dir), ["--isolate"], these, record);
    const unchanged = await runTests(String(dir), ["--isolate"], these, reuse);
    fs.writeFileSync(join(String(dir), "CHANGELOG.md"), "# Changelog\n\nv2\n");
    const edited = await runTests(String(dir), ["--isolate"], these, reuse);
    expect({
      unchanged: reusedFiles(unchanged.stderr),
      edited: [reusedFiles(edited.stderr), edited.exitCode],
    }).toEqual({ unchanged: ["r1.test.ts", "r2.test.ts", "r3.test.ts"], edited: [[], 1] });
    expect(edited.stderr).toContain("reuse: r2.test.ts runs: changed CHANGELOG.md");
  });

  test("going to a failing state and back reuses the pass recorded before", async () => {
    using dir = tempDir("input-reuse-back", files);
    const three = ["./a.test.ts", "./b.test.ts", "./c.test.ts"];
    await runTests(String(dir), ["--isolate"], three, record);
    fs.writeFileSync(join(String(dir), "shared.ts"), `export const value = 2;\n`);
    const failing = await runTests(String(dir), ["--isolate"], three, reuse);
    const failingAgain = await runTests(String(dir), ["--isolate"], three, reuse);
    fs.writeFileSync(join(String(dir), "shared.ts"), `export const value = 1;\n`);
    const back = await runTests(String(dir), ["--isolate"], three, reuse);
    expect({
      failing: [reusedFiles(failing.stderr), failing.exitCode],
      failingAgain: [reusedFiles(failingAgain.stderr), failingAgain.exitCode],
      back: [reusedFiles(back.stderr), back.exitCode],
    }).toEqual({
      failing: [["c.test.ts"], 1],
      failingAgain: [["c.test.ts"], 1],
      back: [["a.test.ts", "b.test.ts", "c.test.ts"], 0],
    });
    expect(failing.stderr).toContain("reuse: a.test.ts runs: changed shared.ts");
    expect(failingAgain.stderr).toContain("reuse: a.test.ts runs: failed");
  });

  test("list says which files would run and why, and runs none", async () => {
    using dir = tempDir("input-reuse-list", {
      ...files,
      "preload.ts": `require("node:fs").writeFileSync(import.meta.dir + "/preloaded", "");\n`,
    });
    const flags = ["--isolate", "--preload", "./preload.ts"];
    await runTests(String(dir), flags, names, record);
    fs.rmSync(join(String(dir), "preloaded"));
    fs.writeFileSync(join(String(dir), "only-c.ts"), `export const c = 2;\n`);
    const store = fs.readFileSync(join(String(dir), "records", "store.btis"));
    const list = await runTests(String(dir), flags, names, { ...record, BUN_TEST_INPUT_REUSE: "list" });
    expect({
      exitCode: list.exitCode,
      lines: list.stdout
        .trim()
        .split("\n")
        .filter(line => !line.startsWith("bun test"))
        .sort(),
      ran: /\d+ pass/.test(list.stderr) || fs.existsSync(join(String(dir), "preloaded")),
      storeKept: fs.readFileSync(join(String(dir), "records", "store.btis")).equals(store),
      segments: fs.readdirSync(join(String(dir), "records", "segments")),
    }).toEqual({
      exitCode: 0,
      // The preload's write is gone, and each file's run made it.
      lines: [
        "a.test.ts: runs: own-write content preloaded",
        "b.test.ts: runs: own-write content preloaded",
        "c.test.ts: runs: changed only-c.ts",
        "spawns.test.ts: runs: mark spawn",
      ],
      ran: false,
      storeKept: true,
      segments: [],
    });
    expect(list.stderr).toMatch(/reuse list: store of 4 states, \d+ entries and \d+ strings/);
  });

  test("two runs at once in one record directory, one with --parallel workers, lose no records", async () => {
    using dir = tempDir("input-reuse-concurrent", files);
    const [both, alone] = await Promise.all([
      runTests(String(dir), ["--parallel=2"], ["./a.test.ts", "./b.test.ts"], record),
      runTests(String(dir), ["--isolate"], ["./c.test.ts"], record),
    ]);
    const later = await runTests(String(dir), ["--isolate"], names, reuse);
    expect({
      exits: [both.exitCode, alone.exitCode],
      reused: reusedFiles(later.stderr),
      segments: fs.readdirSync(join(String(dir), "records", "segments")),
    }).toEqual({ exits: [0, 0], reused: ["a.test.ts", "b.test.ts", "c.test.ts"], segments: [] });
  });

  test("the original of a mocked module, served from the cache, is the same input as its file", async () => {
    const mocking = `
      import { expect, mock, test } from "bun:test";
      mock.module("./dep", async (importOriginal) => ({ ...(await importOriginal<any>()), extra: 1 }));
      test("original", async () => {
        const m: any = await import("./dep");
        expect([m.dep, m.extra]).toEqual(["real", 1]);
      });
    `;
    using dir = tempDir("input-reuse-actual", {
      ...files,
      "dep.ts": `export const dep = "real";\n`,
      "first.test.ts": mocking,
      "second.test.ts": mocking,
    });
    const these = ["./first.test.ts", "./second.test.ts"];
    await runTests(String(dir), ["--isolate"], these, { ...record, BUN_TEST_INPUT_RECORD_JSON: "1" });
    const second = JSON.parse(fs.readFileSync(join(String(dir), "records", "second.test.ts.json"), "utf8"));
    const unchanged = await runTests(String(dir), ["--isolate"], these, reuse);
    fs.writeFileSync(join(String(dir), "dep.ts"), `export const dep = "edited";\n`);
    const edited = await runTests(String(dir), ["--isolate"], these, reuse);
    expect({
      modules: second.modules.map((m: any) => [m.path, typeof m.sha256, !!m.cached]),
      unchanged: reusedFiles(unchanged.stderr),
      edited: [reusedFiles(edited.stderr), edited.exitCode],
    }).toEqual({
      modules: [
        ["second.test.ts", "string", false],
        ["dep.ts", "string", true],
      ],
      unchanged: ["first.test.ts", "second.test.ts"],
      edited: [[], 1],
    });
  });

  test("a changed .env file or listed variable runs every file, an unlisted variable does not", async () => {
    using dir = tempDir("input-reuse-env", files);
    const two = ["./a.test.ts", "./c.test.ts"];
    const listed = { ...reuse, BUN_TEST_INPUT_RECORD_ENV: "DB_NAME", DB_NAME: "one" };
    await runTests(String(dir), ["--isolate"], two, {
      ...record,
      BUN_TEST_INPUT_RECORD_ENV: "DB_NAME",
      DB_NAME: "one",
    });
    const unlisted = await runTests(String(dir), ["--isolate"], two, { ...listed, DB_PORT: "5433" });
    const variable = await runTests(String(dir), ["--isolate"], two, { ...listed, DB_NAME: "two" });
    const again = await runTests(String(dir), ["--isolate"], two, { ...listed, DB_NAME: "two" });
    fs.writeFileSync(join(String(dir), ".env"), "X=1\n");
    const envFile = await runTests(String(dir), ["--isolate"], two, { ...listed, DB_NAME: "two" });
    expect({
      unlisted: reusedFiles(unlisted.stderr),
      variable: reusedFiles(variable.stderr),
      again: reusedFiles(again.stderr),
      envFile: reusedFiles(envFile.stderr),
    }).toEqual({ unlisted: ["a.test.ts", "c.test.ts"], variable: [], again: ["a.test.ts", "c.test.ts"], envFile: [] });
  });

  // Records leave out the JSX and decorator settings a resolver result carries per module, because
  // `bun test` transpiles every module with the root tsconfig.json's settings, which are in the
  // fingerprint. If a nested tsconfig.json starts to count here, reuse can keep a stale outcome.
  test("a nested tsconfig.json changes neither JSX nor decorators at run time", async () => {
    const runtime = (flavor: string) => ({
      "package.json": `{ "name": "jsx-${flavor}", "exports": { "./jsx-runtime": "./rt.js", "./jsx-dev-runtime": "./rt.js" } }`,
      "rt.js": `export const jsx = () => "${flavor}", jsxs = jsx, jsxDEV = jsx, Fragment = null;\n`,
    });
    using dir = tempDir("input-reuse-nested-tsconfig", {
      "package.json": `{ "name": "nested" }`,
      "tsconfig.json": JSON.stringify({
        compilerOptions: { jsx: "react-jsx", jsxImportSource: "jsx-a", experimentalDecorators: true },
      }),
      "node_modules/jsx-a": runtime("a"),
      "node_modules/jsx-b": runtime("b"),
      "nest/tsconfig.json": JSON.stringify({
        compilerOptions: { jsx: "react-jsx", jsxImportSource: "jsx-b", experimentalDecorators: false },
      }),
      "nest/nested.test.tsx": `
        import { expect, test } from "bun:test";
        let args = 0;
        const count = (...rest: unknown[]) => { args = rest.length; };
        class C { @count method() {} }
        test("nested", () => expect({ flavor: <div />, args }).toEqual({ flavor: "a", args: 3 }));
      `,
    });
    const { stdout, stderr, exitCode } = await runTests(String(dir), ["--isolate"], ["./nest/nested.test.tsx"], bunEnv);
    expect({ exitCode, stderr: exitCode === 0 ? "" : stdout + stderr }).toEqual({ exitCode: 0, stderr: "" });
  });

  test("a name a call needs free is looked at as lstat sees it, so a dangling link left there reruns the file", async () => {
    const body = (code: string) => `
      import { expect, test } from "bun:test";
      import * as fs from "node:fs";
      import { join } from "node:path";
      test("make a name, then remove it", () => {
        const fixtures = join(import.meta.dir, "fixtures");
        ${code}
      });
    `;
    using dir = tempDir("input-reuse-free-name", {
      "package.json": `{ "name": "free-name" }`,
      "fixtures/src.txt": "src",
      "sym.test.ts": body(`fs.symlinkSync("anything", join(fixtures, "sym-name"));
        fs.unlinkSync(join(fixtures, "sym-name"));`),
      "link.test.ts": body(`fs.linkSync(join(fixtures, "src.txt"), join(fixtures, "link-name"));
        fs.unlinkSync(join(fixtures, "link-name"));`),
      "mkdir.test.ts": body(`fs.mkdirSync(join(fixtures, "mkdir-name"));
        fs.rmdirSync(join(fixtures, "mkdir-name"));`),
      "excl.test.ts": body(`fs.writeFileSync(join(fixtures, "excl-name"), "x", { flag: "wx" });
        fs.unlinkSync(join(fixtures, "excl-name"));`),
      "copy.test.ts":
        body(`fs.copyFileSync(join(fixtures, "src.txt"), join(fixtures, "copy-name"), fs.constants.COPYFILE_EXCL);
        fs.unlinkSync(join(fixtures, "copy-name"));`),
    });
    const names = ["./sym.test.ts", "./link.test.ts", "./mkdir.test.ts", "./excl.test.ts", "./copy.test.ts"];
    await runTests(String(dir), ["--isolate"], names, record);
    const unchanged = await runTests(String(dir), ["--isolate"], names, reuse);
    for (const name of ["sym-name", "link-name", "mkdir-name", "excl-name", "copy-name"]) {
      fs.symlinkSync("missing-target", join(String(dir), "fixtures", name));
    }
    const dangling = await runTests(String(dir), ["--isolate"], names, reuse);
    expect({
      unchanged: reusedFiles(unchanged.stderr),
      dangling: [reusedFiles(dangling.stderr), dangling.exitCode],
    }).toEqual({
      unchanged: ["copy.test.ts", "excl.test.ts", "link.test.ts", "mkdir.test.ts", "sym.test.ts"],
      dangling: [[], 1],
    });
    expect(dangling.stderr).toContain("reuse: sym.test.ts runs: own-read lstat fixtures/sym-name");
  });

  test("a Bun.write, an Archive write or extract, or a Blob unlink that fails leaves what is there an input", async () => {
    const body = (code: string) => `
      import { expect, test } from "bun:test";
      import { join } from "node:path";
      test("a write that fails, then a read", async () => {
        const fixtures = join(import.meta.dir, "fixtures");
        ${code}
      });
    `;
    using dir = tempDir("input-reuse-failed-bun-write", {
      "package.json": `{ "name": "failed-bun-write" }`,
      "fixtures/write.txt": "v1",
      "fixtures/archive.tar": "v1",
      "fixtures/extract.txt": "v1",
      "fixtures/locked/unlink.txt": "v1",
      "fixtures/done.txt": "old",
      "write.test.ts": body(`try { await Bun.write(join(fixtures, "write.txt"), "new"); } catch {}
        expect(await Bun.file(join(fixtures, "write.txt")).text()).toBe("v1");`),
      "archive.test.ts":
        body(`try { await Bun.Archive.write(join(fixtures, "archive.tar"), { "a.txt": "a" }); } catch {}
        expect(await Bun.file(join(fixtures, "archive.tar")).text()).toBe("v1");`),
      "extract.test.ts":
        body(`try { await new Bun.Archive({ "a.txt": "a" }).extract(join(fixtures, "extract.txt")); } catch {}
        expect(await Bun.file(join(fixtures, "extract.txt")).text()).toBe("v1");`),
      "unlink.test.ts": body(`try { await Bun.file(join(fixtures, "locked", "unlink.txt")).unlink(); } catch {}
        expect(await Bun.file(join(fixtures, "locked", "unlink.txt")).text()).toBe("v1");`),
      "done.test.ts": body(`await Bun.write(join(fixtures, "done.txt"), "fresh");
        expect(await Bun.file(join(fixtures, "done.txt")).text()).toBe("fresh");`),
    });
    const fixtures = join(String(dir), "fixtures");
    fs.chmodSync(join(fixtures, "write.txt"), 0o444);
    fs.chmodSync(join(fixtures, "archive.tar"), 0o444);
    fs.chmodSync(join(fixtures, "locked"), 0o555);
    try {
      const names = ["./write.test.ts", "./archive.test.ts", "./extract.test.ts", "./unlink.test.ts", "./done.test.ts"];
      const first = await runTests(String(dir), ["--isolate"], names, record);
      const unchanged = await runTests(String(dir), ["--isolate"], names, reuse);
      for (const name of ["write.txt", "archive.tar", "extract.txt", "locked/unlink.txt", "done.txt"]) {
        const path = join(fixtures, name);
        const mode = fs.statSync(path).mode & 0o777;
        fs.chmodSync(path, 0o644);
        fs.writeFileSync(path, "v2");
        fs.chmodSync(path, mode);
      }
      const edited = await runTests(String(dir), ["--isolate"], names, reuse);
      expect({
        first: first.exitCode,
        unchanged: reusedFiles(unchanged.stderr),
        edited: [reusedFiles(edited.stderr), edited.exitCode],
      }).toEqual({
        first: 0,
        unchanged: ["archive.test.ts", "done.test.ts", "extract.test.ts", "unlink.test.ts", "write.test.ts"],
        edited: [[], 1],
      });
      // What a write that succeeded left is the file's own product, not an input: done.test.ts
      // runs because what it wrote is gone, not because it read an edited file.
      expect(edited.stderr).toContain("reuse: done.test.ts runs: own-write content fixtures/done.txt");
    } finally {
      fs.chmodSync(join(fixtures, "locked"), 0o755);
    }
  });

  test("a look through a symbolic link the file made lands where the kernel takes it", async () => {
    const body = (code: string) => `
      import { expect, test } from "bun:test";
      import * as fs from "node:fs";
      import { tmpdir } from "node:os";
      import { join } from "node:path";
      test("read through own links", () => {
        const fixtures = join(import.meta.dir, "fixtures");
        ${code}
      });
    `;
    using dir = tempDir("input-reuse-land", {
      "package.json": `{ "name": "land" }`,
      "fixtures/renamed.txt": "renamed-v1",
      "fixtures/data.txt": "lexical",
      "fixtures/real/data.txt": "physical-v1",
      "fixtures/real/deep/.keep": "",
      "fixtures/chain.txt": "chain-v1",
      "fixtures/one/file.txt": "one",
      "fixtures/two/file.txt": "two",
      "renamed.test.ts": body(`const tmp = fs.mkdtempSync(join(tmpdir(), "renamed-"));
        fs.symlinkSync(join(fixtures, "renamed.txt"), join(tmp, "a"));
        fs.renameSync(join(tmp, "a"), join(tmp, "b"));
        expect(fs.readFileSync(join(tmp, "b"), "utf8")).toBe("renamed-v1");`),
      "updir.test.ts": body(`fs.symlinkSync("../data.txt", join(fixtures, "linkdir", "l"));
        const text = fs.readFileSync(join(fixtures, "linkdir", "l"), "utf8");
        fs.unlinkSync(join(fixtures, "linkdir", "l"));
        expect(text).toBe("physical-v1");`),
      "chain.test.ts": body(`const tmp = fs.mkdtempSync(join(tmpdir(), "chain-"));
        for (let i = 0; i < 12; i++) fs.symlinkSync(i === 11 ? join(fixtures, "chain.txt") : join(tmp, "l" + (i + 1)), join(tmp, "l" + i));
        expect(fs.readFileSync(join(tmp, "l0"), "utf8")).toBe("chain-v1");`),
      "via.test.ts": body(`const tmp = fs.mkdtempSync(join(tmpdir(), "via-"));
        fs.symlinkSync(join(fixtures, "via", "file.txt"), join(tmp, "x"));
        expect(fs.readFileSync(join(tmp, "x"), "utf8")).toBe("one");`),
    });
    const fixtures = join(String(dir), "fixtures");
    fs.symlinkSync("real/deep", join(fixtures, "linkdir"));
    fs.symlinkSync("one", join(fixtures, "via"));
    const names = ["./renamed.test.ts", "./updir.test.ts", "./chain.test.ts", "./via.test.ts"];
    const first = await runTests(String(dir), ["--isolate"], names, record);
    const unchanged = await runTests(String(dir), ["--isolate"], names, reuse);
    fs.writeFileSync(join(fixtures, "renamed.txt"), "renamed-v2");
    fs.writeFileSync(join(fixtures, "real", "data.txt"), "physical-v2");
    fs.writeFileSync(join(fixtures, "chain.txt"), "chain-v2");
    fs.unlinkSync(join(fixtures, "via"));
    fs.symlinkSync("two", join(fixtures, "via"));
    const edited = await runTests(String(dir), ["--isolate"], names, reuse);
    expect({
      first: first.exitCode,
      unchanged: reusedFiles(unchanged.stderr),
      edited: [reusedFiles(edited.stderr), edited.exitCode],
    }).toEqual({
      first: 0,
      unchanged: ["chain.test.ts", "renamed.test.ts", "updir.test.ts", "via.test.ts"],
      edited: [[], 1],
    });
    expect(edited.stderr).toContain("reuse: via.test.ts runs: own-read readlink fixtures/via");
  });

  for (const parallel of [[], ["--parallel=2"]]) {
    test(`a reused file whose inputs a file that ran has changed runs after it ${parallel.join(" ") || "(serial)"}`, async () => {
      const flags = ["--isolate", ...parallel];
      using dir = tempDir("input-reuse-after", {
        "package.json": `{ "name": "after" }`,
        "src.txt": "hello",
        "out/gen.txt": "hello",
        "out/gen2.txt": "hello",
        "a.test.ts": `
          import { test } from "bun:test";
          import { readFileSync, writeFileSync } from "node:fs";
          test("writes gen from src", () => writeFileSync("out/gen.txt", readFileSync("src.txt", "utf8")));
        `,
        "b1.test.ts": `
          import { test } from "bun:test";
          import { readFileSync, writeFileSync } from "node:fs";
          test("writes gen2 from gen", () => writeFileSync("out/gen2.txt", readFileSync("out/gen.txt", "utf8")));
        `,
        "b2.test.ts": `
          import { expect, test } from "bun:test";
          import { readFileSync } from "node:fs";
          test("reads gen", () => expect(readFileSync("out/gen.txt", "utf8")).toBe("hello"));
        `,
        "e.test.ts": `
          import { expect, test } from "bun:test";
          import { readFileSync } from "node:fs";
          test("reads gen2", () => expect(readFileSync("out/gen2.txt", "utf8")).toBe("hello"));
        `,
        "c.test.ts": `
          import { expect, test } from "bun:test";
          test("always runs", () => expect(Bun.spawnSync({ cmd: [process.execPath, "--version"] }).exitCode).toBe(0));
        `,
      });
      const names = ["./a.test.ts", "./b1.test.ts", "./b2.test.ts", "./c.test.ts", "./e.test.ts"];
      await runTests(String(dir), flags, names, record);
      const unchanged = await runTests(String(dir), flags, names, reuse);
      fs.writeFileSync(join(String(dir), "src.txt"), "bye");
      const changed = await runTests(String(dir), flags, names, reuse);
      expect({
        unchanged: [reusedFiles(unchanged.stderr), unchanged.exitCode],
        changed: [reusedFiles(changed.stderr), changed.exitCode],
      }).toEqual({
        unchanged: [["a.test.ts", "b1.test.ts", "b2.test.ts", "e.test.ts"], 0],
        changed: [[], 1],
      });
      expect(changed.stderr).toContain("reuse: b2.test.ts runs after the others: own-read content out/gen.txt");
      expect(changed.stderr).toContain("reuse: e.test.ts runs after the others: own-read content out/gen2.txt");
      expect(changed.stderr).toContain("2 fail");
      expect(changed.stderr).toContain("Ran 5 tests across 5 files");
    });
  }

  test("a record root that is not the project directory or above it is an error", async () => {
    using dir = tempDir("input-reuse-root-elsewhere", {
      "package.json": `{ "name": "root-elsewhere" }`,
      "app/a.test.ts": `
        import { expect, test } from "bun:test";
        test("a", () => expect(1).toBe(1));
      `,
      "elsewhere/.keep": "",
    });
    const app = join(String(dir), "app");
    const above = await runTests(app, ["--isolate"], ["./a.test.ts"], { ...record, BUN_TEST_INPUT_RECORD_ROOT: ".." });
    const elsewhere = await runTests(app, ["--isolate"], ["./a.test.ts"], {
      ...record,
      BUN_TEST_INPUT_RECORD_ROOT: "../elsewhere",
    });
    expect({ above: above.exitCode, elsewhere: elsewhere.exitCode }).toEqual({ above: 0, elsewhere: 1 });
    expect(elsewhere.stderr).toContain(
      "error: BUN_TEST_INPUT_RECORD_ROOT=../elsewhere is not the project directory or a directory above it",
    );
  });

  test("the check after the run sees a module a worker wrote, not the coordinator's cached directory", async () => {
    using dir = tempDir("input-reuse-dir-cache", {
      "package.json": `{ "name": "dir-cache" }`,
      "src.txt": "skip",
      "gen.js": `export const v = "js";\n`,
      "a.test.ts": `
        import { expect, test } from "bun:test";
        import { readFileSync, rmSync, writeFileSync } from "node:fs";
        test("makes gen.ts when src.txt says so", () => {
          if (readFileSync(import.meta.dir + "/src.txt", "utf8").trim() === "make") {
            writeFileSync(import.meta.dir + "/gen.ts", 'export const v = "ts";');
          } else {
            rmSync(import.meta.dir + "/gen.ts", { force: true });
          }
          expect(1).toBe(1);
        });
      `,
      "b.test.ts": `
        import { expect, test } from "bun:test";
        import { v } from "./gen";
        test("imports ./gen", () => expect(v).toBe("js"));
      `,
      "c.test.ts": `
        import { expect, test } from "bun:test";
        test("always runs", () => expect(Bun.spawnSync({ cmd: [process.execPath, "--version"] }).exitCode).toBe(0));
      `,
    });
    const names = ["./a.test.ts", "./b.test.ts", "./c.test.ts"];
    const flags = ["--isolate", "--parallel=2"];
    await runTests(String(dir), flags, names, record);
    fs.writeFileSync(join(String(dir), "src.txt"), "make");
    const made = await runTests(String(dir), flags, names, reuse);
    expect({ reused: reusedFiles(made.stderr), exitCode: made.exitCode }).toEqual({ reused: [], exitCode: 1 });
    expect(made.stderr).toContain("reuse: b.test.ts runs after the others: answer import ./gen from b.test.ts");
  });

  // Serial only: under --parallel the writer and the reader run at once, in a plain run too.
  test("a reused file whose writes are gone runs, so a file that reads them sees them again", async () => {
    const flags = ["--isolate"];
    using dir = tempDir("input-reuse-left", {
      "package.json": `{ "name": "left" }`,
      "src.txt": "hello",
      "out/gen.txt": "hello",
      "a.test.ts": `
        import { expect, test } from "bun:test";
        import { readFileSync, writeFileSync } from "node:fs";
        test("writes gen from src", () => {
          const text = readFileSync(import.meta.dir + "/src.txt", "utf8");
          writeFileSync(import.meta.dir + "/out/gen.txt", text);
          expect(text).toBe("hello");
        });
      `,
      "b.test.ts": `
        import { expect, test } from "bun:test";
        import { readFileSync } from "node:fs";
        test("reads gen", () => expect(readFileSync(import.meta.dir + "/out/gen.txt", "utf8")).toBe("hello"));
      `,
      "c.test.ts": `
        import { expect, test } from "bun:test";
        test("always runs", () => expect(Bun.spawnSync({ cmd: [process.execPath, "--version"] }).exitCode).toBe(0));
      `,
    });
    const names = ["./a.test.ts", "./b.test.ts", "./c.test.ts"];
    await runTests(String(dir), flags, names, record);
    fs.writeFileSync(join(String(dir), "src.txt"), "bye");
    const bye = await runTests(String(dir), flags, names, reuse);
    fs.writeFileSync(join(String(dir), "src.txt"), "hello");
    const back = await runTests(String(dir), flags, names, reuse);
    const again = await runTests(String(dir), flags, names, reuse);
    fs.rmSync(join(String(dir), "out", "gen.txt"));
    const gone = await runTests(String(dir), flags, names, reuse);
    expect({
      bye: bye.exitCode,
      back: [reusedFiles(back.stderr), back.exitCode],
      again: [reusedFiles(again.stderr), again.exitCode],
      gone: [reusedFiles(gone.stderr), gone.exitCode],
    }).toEqual({
      bye: 1,
      back: [[], 0],
      again: [["a.test.ts", "b.test.ts"], 0],
      gone: [[], 0],
    });
    expect(gone.stderr).toContain("reuse: a.test.ts runs: own-write content out/gen.txt");
  });

  test("a write that failed leaves only an lstat look, not a tree of what was there", async () => {
    using dir = tempDir("input-reuse-failed-mkdir", {
      "package.json": `{ "name": "failed-mkdir" }`,
      "shared/x.txt": "v1",
      "m.test.ts": `
        import { expect, test } from "bun:test";
        import { mkdirSync } from "node:fs";
        test("a mkdir that fails on a directory that is there", () => {
          let code = "";
          try {
            mkdirSync(import.meta.dir + "/shared");
          } catch (error) {
            code = (error as NodeJS.ErrnoException).code ?? "";
          }
          expect(code).toBe("EEXIST");
        });
      `,
    });
    const one = ["./m.test.ts"];
    await runTests(String(dir), ["--isolate"], one, { ...record, BUN_TEST_INPUT_RECORD_JSON: "1" });
    const json = JSON.parse(fs.readFileSync(join(String(dir), "records", "m.test.ts.json"), "utf8"));
    fs.writeFileSync(join(String(dir), "shared", "x.txt"), "v2, another file wrote here");
    const edited = await runTests(String(dir), ["--isolate"], one, reuse);
    fs.rmSync(join(String(dir), "shared"), { recursive: true });
    const removed = await runTests(String(dir), ["--isolate"], one, reuse);
    expect({
      after: json.reads.filter((it: any) => it.extra === "after").map((it: any) => [it.look, it.path]),
      edited: [reusedFiles(edited.stderr), edited.exitCode],
      removed: [reusedFiles(removed.stderr), removed.exitCode],
    }).toEqual({ after: [["lstat", "shared"]], edited: [["m.test.ts"], 0], removed: [[], 1] });
  });

  test("a path the test passes with .. after a symbolic link is looked at where the kernel goes", async () => {
    using dir = tempDir("input-reuse-dotdot", {
      "package.json": `{ "name": "dotdot" }`,
      "data.txt": "lexical",
      "real/data.txt": "physical-v1",
      "real/deep/.keep": "",
      "dd.test.ts": `
        import { expect, test } from "bun:test";
        import { readFileSync } from "node:fs";
        test("a literal .. after a symlinked directory", () => {
          expect(readFileSync("linkdir/../data.txt", "utf8")).toBe("physical-v1");
        });
      `,
    });
    fs.symlinkSync("real/deep", join(String(dir), "linkdir"));
    const one = ["./dd.test.ts"];
    const first = await runTests(String(dir), ["--isolate"], one, record);
    const unchanged = await runTests(String(dir), ["--isolate"], one, reuse);
    fs.writeFileSync(join(String(dir), "real", "data.txt"), "physical-v2");
    const edited = await runTests(String(dir), ["--isolate"], one, reuse);
    expect({
      first: first.exitCode,
      unchanged: reusedFiles(unchanged.stderr),
      edited: [reusedFiles(edited.stderr), edited.exitCode],
    }).toEqual({ first: 0, unchanged: ["dd.test.ts"], edited: [[], 1] });
    expect(edited.stderr).toContain("reuse: dd.test.ts runs: own-read content real/data.txt");
  });

  test("a write the test makes with .. after a symbolic link is left where the kernel put it", async () => {
    using dir = tempDir("input-reuse-dotdot-write", {
      "package.json": `{ "name": "dotdot-write" }`,
      "real/deep/.keep": "",
      "w.test.ts": `
        import { expect, test } from "bun:test";
        import { writeFileSync } from "node:fs";
        test("a write through a literal .. after a symlinked directory", () => {
          writeFileSync("linkdir/../out.txt", "made");
          expect(1).toBe(1);
        });
      `,
    });
    fs.symlinkSync("real/deep", join(String(dir), "linkdir"));
    const one = ["./w.test.ts"];
    const first = await runTests(String(dir), ["--isolate"], one, record);
    const unchanged = await runTests(String(dir), ["--isolate"], one, reuse);
    fs.rmSync(join(String(dir), "real", "out.txt"));
    const gone = await runTests(String(dir), ["--isolate"], one, reuse);
    expect({
      first: first.exitCode,
      folded: fs.existsSync(join(String(dir), "out.txt")),
      unchanged: reusedFiles(unchanged.stderr),
      gone: [reusedFiles(gone.stderr), gone.exitCode],
      again: fs.readFileSync(join(String(dir), "real", "out.txt"), "utf8"),
    }).toEqual({ first: 0, folded: false, unchanged: ["w.test.ts"], gone: [[], 0], again: "made" });
    expect(gone.stderr).toContain("reuse: w.test.ts runs: own-write content real/out.txt");
  });

  test("after --bail, a reused file whose record no longer holds is said not to have run", async () => {
    using dir = tempDir("input-reuse-bail", {
      "package.json": `{ "name": "bail" }`,
      "src.txt": "hello",
      "out/gen.txt": "hello",
      "a.test.ts": `
        import { expect, test } from "bun:test";
        import { readFileSync, writeFileSync } from "node:fs";
        test("writes gen from src", () => {
          const text = readFileSync(import.meta.dir + "/src.txt", "utf8");
          writeFileSync(import.meta.dir + "/out/gen.txt", text);
          expect(text).toBe("hello");
        });
      `,
      "b.test.ts": `
        import { expect, test } from "bun:test";
        import { readFileSync } from "node:fs";
        test("reads gen", () => expect(readFileSync(import.meta.dir + "/out/gen.txt", "utf8")).toBe("hello"));
      `,
      "c.test.ts": `
        import { expect, test } from "bun:test";
        test("always runs", () => expect(Bun.spawnSync({ cmd: [process.execPath, "--version"] }).exitCode).toBe(0));
      `,
    });
    const names = ["./a.test.ts", "./b.test.ts", "./c.test.ts"];
    const flags = ["--isolate", "--parallel=2", "--bail=1"];
    await runTests(String(dir), flags, names, record);
    fs.writeFileSync(join(String(dir), "src.txt"), "bye");
    const bailed = await runTests(String(dir), flags, names, reuse);
    expect({ reused: reusedFiles(bailed.stderr), exitCode: bailed.exitCode }).toEqual({ reused: [], exitCode: 1 });
    expect(bailed.stderr).toContain("b.test.ts: not run after --bail: own-read content out/gen.txt");
  });

  test("a Bun.write still pending at a look applies when a later look finds it fulfilled", async () => {
    using dir = tempDir("input-reuse-pending-write", {
      "package.json": `{ "name": "pending-write" }`,
      "fixtures/other.txt": "other",
      "p.test.ts": `
        import { expect, test } from "bun:test";
        import { readFileSync } from "node:fs";
        test("a large write, a look while it is pending, then a read after it", async () => {
          const path = import.meta.dir + "/fixtures/out.bin";
          const written = Bun.write(path, new Uint8Array(64 * 1024 * 1024).fill(7));
          expect(Bun.peek.status(written)).toBe("pending");
          readFileSync(import.meta.dir + "/fixtures/other.txt");
          await written;
          expect(readFileSync(path).length).toBe(64 * 1024 * 1024);
        });
      `,
    });
    const one = ["./p.test.ts"];
    const first = await runTests(String(dir), ["--isolate"], one, { ...record, BUN_TEST_INPUT_RECORD_JSON: "1" });
    const json = JSON.parse(fs.readFileSync(join(String(dir), "records", "p.test.ts.json"), "utf8"));
    expect({
      first: first.exitCode,
      inputs: json.reads
        .filter((it: any) => !it.extra)
        .map((it: any) => [it.look, it.path])
        .sort(),
    }).toEqual({ first: 0, inputs: [["content", "fixtures/other.txt"]] });
  });

  test("a Bun.write still pending when the file ends makes the record not hold", async () => {
    // The source is a stream that never closes, so the write is pending when the file ends on any
    // machine, however fast its disk: what it leaves can't be known when the record is written.
    using dir = tempDir("input-reuse-pending-at-end", {
      "package.json": `{ "name": "pending-at-end" }`,
      "fixtures/.keep": "",
      "p.test.ts": `
        import { expect, test } from "bun:test";
        test("a write from a stream that never closes", async () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(64 * 1024).fill(7));
            },
          });
          const written = Bun.write(import.meta.dir + "/fixtures/out.bin", new Response(stream));
          await Bun.sleep(10);
          expect(Bun.peek.status(written)).toBe("pending");
        });
      `,
    });
    const one = ["./p.test.ts"];
    const first = await runTests(String(dir), ["--isolate"], one, { ...record, BUN_TEST_INPUT_RECORD_JSON: "1" });
    const json = JSON.parse(fs.readFileSync(join(String(dir), "records", "p.test.ts.json"), "utf8"));
    const again = await runTests(String(dir), ["--isolate"], one, reuse);
    expect({
      first: first.exitCode,
      marks: json.marks,
      reads: json.reads.filter((it: any) => !it.extra).map((it: any) => [it.look, it.path]),
      again: [reusedFiles(again.stderr), again.exitCode],
    }).toEqual({ first: 0, marks: ["pending-write"], reads: [], again: [[], 0] });
    expect(again.stderr).toContain("reuse: p.test.ts runs: mark pending-write");
  });

  test.skipIf(isWindows)(
    "an async node:fs write still under way when the file ends makes the record not hold",
    async () => {
      // Each call opens a named pipe nobody reads, so it waits in the open until the process ends, on
      // any machine: when the file ends its effect is not applied and what it leaves is not known.
      using dir = tempDir("input-reuse-node-fs-in-flight", {
        "package.json": `{ "name": "node-fs-in-flight" }`,
        "out/.keep": "",
        "p.test.ts": `
        import { expect, test } from "bun:test";
        import { promises } from "node:fs";
        test("fs.promises.writeFile not awaited", () => {
          promises.writeFile(import.meta.dir + "/out/p-pipe", "x");
          expect(1).toBe(1);
        });
      `,
        "s.test.ts": `
        import { expect, test } from "bun:test";
        import { createWriteStream } from "node:fs";
        test("a write stream not ended", () => {
          createWriteStream(import.meta.dir + "/out/s-pipe").write("x");
          expect(1).toBe(1);
        });
      `,
      });
      for (const name of ["p-pipe", "s-pipe"]) {
        expect(Bun.spawnSync(["mkfifo", join(String(dir), "out", name)]).exitCode).toBe(0);
      }
      const both = ["./p.test.ts", "./s.test.ts"];
      const first = await runTests(String(dir), ["--isolate"], both, { ...record, BUN_TEST_INPUT_RECORD_JSON: "1" });
      const marks = (name: string) =>
        JSON.parse(fs.readFileSync(join(String(dir), "records", `${name}.json`), "utf8")).marks;
      const again = await runTests(String(dir), ["--isolate"], both, reuse);
      expect({
        first: first.exitCode,
        marks: [marks("p.test.ts"), marks("s.test.ts")],
        again: [reusedFiles(again.stderr), again.exitCode],
      }).toEqual({ first: 0, marks: [["pending-write"], ["pending-write"]], again: [[], 0] });
      expect(again.stderr).toContain("reuse: p.test.ts runs: mark pending-write");
      expect(again.stderr).toContain("reuse: s.test.ts runs: mark pending-write");
    },
  );

  test.skipIf(isWindows)(
    "an async node:fs read still under way when the file ends is no write in flight, and a write through a descriptor is",
    async () => {
      // r's readFile opens a named pipe nobody writes, so it waits in the open until the process ends.
      // It and an unawaited stat only read, and r is reused. w writes more than a pipe holds through a
      // descriptor of a pipe nobody reads, so its write waits until the process ends.
      using dir = tempDir("input-reuse-node-fs-read-in-flight", {
        "package.json": `{ "name": "node-fs-read-in-flight" }`,
        "in/.keep": "",
        "r.test.ts": `
        import { expect, test } from "bun:test";
        import { promises } from "node:fs";
        test("fs.promises.readFile and stat not awaited", () => {
          promises.readFile(import.meta.dir + "/in/r-pipe").catch(() => {});
          promises.stat(import.meta.path);
          expect(1).toBe(1);
        });
      `,
        "w.test.ts": `
        import { expect, test } from "bun:test";
        import { openSync, write } from "node:fs";
        test("fs.write through a descriptor not completed", () => {
          const fd = openSync(import.meta.dir + "/in/w-pipe", "r+");
          write(fd, Buffer.alloc(1 << 20), () => {});
          expect(1).toBe(1);
        });
      `,
      });
      for (const name of ["r-pipe", "w-pipe"]) {
        expect(Bun.spawnSync(["mkfifo", join(String(dir), "in", name)]).exitCode).toBe(0);
      }
      const both = ["./r.test.ts", "./w.test.ts"];
      const first = await runTests(String(dir), ["--isolate"], both, { ...record, BUN_TEST_INPUT_RECORD_JSON: "1" });
      const marks = (name: string) =>
        JSON.parse(fs.readFileSync(join(String(dir), "records", `${name}.json`), "utf8")).marks;
      const again = await runTests(String(dir), ["--isolate"], both, reuse);
      expect({
        first: first.exitCode,
        marks: [marks("r.test.ts"), marks("w.test.ts")],
        again: [reusedFiles(again.stderr), again.exitCode],
      }).toEqual({ first: 0, marks: [[], ["pending-write"]], again: [["r.test.ts"], 0] });
      expect(again.stderr).toContain("reuse: w.test.ts runs: mark pending-write");
    },
  );

  test("a path a file in another worker changed after this file read it makes the record not hold", async () => {
    // b reads "old" and passes; a, in the other worker, writes "new", the same size, before b
    // ends. A record holding the bytes at b's end would pair b's pass with bytes it never saw, and
    // b would be reused where running it fails. Each waits for the other, so the order is fixed.
    using dir = tempDir("input-reuse-changed-during-run", {
      "package.json": `{ "name": "changed-during-run" }`,
      "gen.txt": "old",
      "a.test.ts": `
        import { test } from "bun:test";
        import { existsSync, writeFileSync } from "node:fs";
        test("writes gen.txt once b has read it", async () => {
          while (!existsSync(import.meta.dir + "/b-read")) await Bun.sleep(5);
          writeFileSync(import.meta.dir + "/gen.txt", "new");
        });
      `,
      "b.test.ts": `
        import { expect, test } from "bun:test";
        import { readFileSync, writeFileSync } from "node:fs";
        test("reads gen.txt as old", async () => {
          const path = import.meta.dir + "/gen.txt";
          const seen = readFileSync(path, "utf8");
          expect(seen).toBe("old");
          writeFileSync(import.meta.dir + "/b-read", "");
          while (readFileSync(path, "utf8") === seen) await Bun.sleep(5);
        });
      `,
    });
    const both = ["./a.test.ts", "./b.test.ts"];
    const flags = ["--parallel=2"];
    const scale = { BUN_TEST_PARALLEL_SCALE_MS: "0" };
    const first = await runTests(String(dir), flags, both, { ...record, ...scale, BUN_TEST_INPUT_RECORD_JSON: "1" });
    const json = JSON.parse(fs.readFileSync(join(String(dir), "records", "b.test.ts.json"), "utf8"));
    const again = await runTests(String(dir), flags, both, { ...reuse, ...scale });
    expect({
      first: first.exitCode,
      marks: json.marks,
      bReused: reusedFiles(again.stderr).includes("b.test.ts"),
      again: again.exitCode,
    }).toEqual({ first: 0, marks: ["changed-during-run"], bReused: false, again: 1 });
    expect(again.stderr).toContain("reuse: b.test.ts runs: mark changed-during-run");
  });
  test("a path read again after a write nearby took its value is stamped again, so a change in between is seen", async () => {
    // b reads data/gen.txt, and its recursive mkdir of data/ takes that read's value then. a, in the
    // other worker, changes the file before b reads it again. b's second read must see the change,
    // although its first one already has a value.
    using dir = tempDir("input-reuse-read-again", {
      "package.json": `{ "name": "read-again" }`,
      "data/gen.txt": "old",
      "a.test.ts": `
        import { test } from "bun:test";
        import { existsSync, writeFileSync } from "node:fs";
        test("writes data/gen.txt once b has made its directory", async () => {
          while (!existsSync(import.meta.dir + "/b-ready")) await Bun.sleep(5);
          writeFileSync(import.meta.dir + "/data/gen.txt", "new");
        });
      `,
      "b.test.ts": `
        import { expect, test } from "bun:test";
        import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
        test("reads data/gen.txt, makes sure of its directory, and reads it until it changes", async () => {
          const data = import.meta.dir + "/data";
          expect(readFileSync(data + "/gen.txt", "utf8")).toBe("old");
          mkdirSync(data, { recursive: true });
          writeFileSync(import.meta.dir + "/b-ready", "");
          while (readFileSync(data + "/gen.txt", "utf8") === "old") await Bun.sleep(5);
        });
      `,
    });
    const both = ["./a.test.ts", "./b.test.ts"];
    const flags = ["--parallel=2"];
    const scale = { BUN_TEST_PARALLEL_SCALE_MS: "0" };
    const first = await runTests(String(dir), flags, both, { ...record, ...scale, BUN_TEST_INPUT_RECORD_JSON: "1" });
    const json = JSON.parse(fs.readFileSync(join(String(dir), "records", "b.test.ts.json"), "utf8"));
    const again = await runTests(String(dir), flags, both, { ...reuse, ...scale });
    expect({
      first: first.exitCode,
      marks: json.marks,
      bReused: reusedFiles(again.stderr).includes("b.test.ts"),
    }).toEqual({ first: 0, marks: ["changed-during-run"], bReused: false });
    expect(again.stderr).toContain("reuse: b.test.ts runs: mark changed-during-run");
  });
});

// The recorder's store relies on flock, so recording and reuse are Unix only: on Windows,
// `--reuse` says it is unavailable and every file runs.
describe.concurrent.skipIf(isWindows)("bun test --reuse", () => {
  const files = {
    "package.json": `{ "name": "reuse-flag" }`,
    "shared.ts": `export const value = 1;\n`,
    "only-c.ts": `export const c = 1;\n`,
    "a.test.ts": `
      import { expect, test } from "bun:test";
      import { value } from "./shared";
      test("a", () => expect(value).toBe(1));
    `,
    "b.test.ts": `
      import { expect, test } from "bun:test";
      import { value } from "./shared";
      test("b", () => expect(value).toBe(1));
    `,
    "c.test.ts": `
      import { expect, test } from "bun:test";
      import { c } from "./only-c";
      test("c", () => expect(c).toBe(1));
    `,
  };
  const names = ["./a.test.ts", "./b.test.ts", "./c.test.ts"];
  const reusedFiles = (stderr: string) => [...stderr.matchAll(/^(\S+): reused, /gm)].map(m => m[1]).sort();
  const store = (dir: string) => join(dir, "node_modules", ".cache", "bun-test-reuse");
  const listed = (stdout: string) =>
    stdout
      .split(/\r?\n/)
      .filter(line => / (would be reused|runs: .*)$/.test(line))
      .sort();

  test("records into node_modules/.cache/bun-test-reuse without --isolate, and skips the files whose inputs are unchanged", async () => {
    using dir = tempDir("reuse-flag", files);
    const first = await runTests(String(dir), ["--reuse"], names);
    const recorded = fs.existsSync(store(String(dir)));
    fs.writeFileSync(join(String(dir), "only-c.ts"), `export const c = 1; // edited\n`);
    const explain = await runTests(String(dir), ["--reuse=explain"], names);
    const again = await runTests(String(dir), ["--reuse"], names);
    expect({
      first: [reusedFiles(first.stderr), first.exitCode],
      recorded,
      explain: [reusedFiles(explain.stderr), explain.exitCode],
      again: [reusedFiles(again.stderr), again.exitCode],
    }).toEqual({
      first: [[], 0],
      recorded: true,
      explain: [["a.test.ts", "b.test.ts"], 0],
      again: [["a.test.ts", "b.test.ts", "c.test.ts"], 0],
    });
    expect(explain.stderr).toContain("reuse: c.test.ts runs: changed only-c.ts");
    expect(again.stderr).toContain("3 files reused, not run");
  });

  test("--reuse=list names what would run and runs nothing, and --reuse=check runs every file", async () => {
    using dir = tempDir("reuse-flag-modes", files);
    await runTests(String(dir), ["--reuse"], names);
    fs.writeFileSync(join(String(dir), "only-c.ts"), `export const c = 1; // edited\n`);
    const list = await runTests(String(dir), ["--reuse=list"], names);
    const check = await runTests(String(dir), ["--reuse=check"], names);
    expect({
      list: [listed(list.stdout), list.exitCode],
      check: [reusedFiles(check.stderr), check.exitCode],
    }).toEqual({
      list: [["a.test.ts: would be reused", "b.test.ts: would be reused", "c.test.ts: runs: changed only-c.ts"], 0],
      check: [[], 0],
    });
    expect(check.stderr).toMatch(/3 pass/);
  });

  test("--reuse with --parallel records in every worker and reuses in the coordinator", async () => {
    using dir = tempDir("reuse-flag-parallel", files);
    const first = await runTests(String(dir), ["--reuse", "--parallel=2"], names);
    const again = await runTests(String(dir), ["--reuse", "--parallel=2"], names);
    expect({ first: first.exitCode, reused: reusedFiles(again.stderr), again: again.exitCode }).toEqual({
      first: 0,
      reused: ["a.test.ts", "b.test.ts", "c.test.ts"],
      again: 0,
    });
  });

  test("the variables override the store directory and the mode of --reuse", async () => {
    using dir = tempDir("reuse-flag-variables", files);
    await runTests(String(dir), ["--reuse"], names, { ...bunEnv, BUN_TEST_INPUT_RECORD_DIR: "records" });
    const off = await runTests(String(dir), ["--reuse"], names, {
      ...bunEnv,
      BUN_TEST_INPUT_RECORD_DIR: "records",
      BUN_TEST_INPUT_REUSE: "0",
    });
    const on = await runTests(String(dir), ["--reuse"], names, { ...bunEnv, BUN_TEST_INPUT_RECORD_DIR: "records" });
    expect({
      records: fs.existsSync(join(String(dir), "records")),
      defaultStore: fs.existsSync(store(String(dir))),
      off: [reusedFiles(off.stderr), off.exitCode],
      on: [reusedFiles(on.stderr), on.exitCode],
    }).toEqual({
      records: true,
      defaultStore: false,
      off: [[], 0],
      on: [["a.test.ts", "b.test.ts", "c.test.ts"], 0],
    });
  });

  test("an unknown mode and --no-isolate are errors", async () => {
    using dir = tempDir("reuse-flag-errors", files);
    const [mode, noIsolate] = await Promise.all([
      runTests(String(dir), ["--reuse=sometimes"], names),
      runTests(String(dir), ["--reuse", "--parallel=2", "--no-isolate"], names),
    ]);
    expect({
      mode: [mode.stderr.trim(), mode.exitCode],
      noIsolate: [noIsolate.stderr.trim(), noIsolate.exitCode],
      stored: fs.existsSync(store(String(dir))),
    }).toEqual({
      mode: ['error: --reuse expects "explain", "check" or "list", received "sometimes"', 1],
      noIsolate: ["error: --reuse needs --isolate and cannot be used with --no-isolate", 1],
      stored: false,
    });
  });

  test("[test] reuse in bunfig.toml turns it on, takes a mode, and --reuse overrides it", async () => {
    using dir = tempDir("reuse-bunfig", { ...files, "bunfig.toml": `[test]\nreuse = true\n` });
    const first = await runTests(String(dir), [], names);
    fs.writeFileSync(join(String(dir), "only-c.ts"), `export const c = 1; // edited\n`);
    fs.writeFileSync(join(String(dir), "bunfig.toml"), `[test]\nreuse = "explain"\n`);
    const explain = await runTests(String(dir), [], names);
    const list = await runTests(String(dir), ["--reuse=list"], names);
    fs.writeFileSync(join(String(dir), "bunfig.toml"), `[test]\nreuse = false\n`);
    const off = await runTests(String(dir), [], names);
    fs.writeFileSync(join(String(dir), "bunfig.toml"), `[test]\nreuse = "sometimes"\n`);
    const invalid = await runTests(String(dir), [], names);
    expect({
      first: [fs.existsSync(store(String(dir))), first.exitCode],
      explain: [reusedFiles(explain.stderr), explain.exitCode],
      list: [listed(list.stdout), list.exitCode],
      off: [reusedFiles(off.stderr), off.exitCode],
      invalid: invalid.exitCode,
    }).toEqual({
      first: [true, 0],
      explain: [["a.test.ts", "b.test.ts"], 0],
      list: [["a.test.ts: would be reused", "b.test.ts: would be reused", "c.test.ts: would be reused"], 0],
      off: [[], 0],
      invalid: 1,
    });
    expect(explain.stderr).toContain("reuse: c.test.ts runs: changed only-c.ts");
    expect(invalid.stderr).toContain(
      'expected "reuse" to be a boolean, "explain", "check" or "list" but received "sometimes"',
    );
  });
});
