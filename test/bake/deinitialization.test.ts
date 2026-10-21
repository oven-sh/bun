import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import path from "node:path";

test("dev server deinitializes itself", () => {
  const result = Bun.spawnSync({
    cmd: [bunExe(), "test", path.join(import.meta.dir, "fixtures/deinitialization/test.ts")],
    env: bunEnv,
    stdio: ["inherit", "inherit", "inherit"],
    cwd: path.join(import.meta.dir, "fixtures/deinitialization"),
  });
  expect(result.signalCode).toBeUndefined();
  expect(result.exitCode).toBe(0);
  // The child runs a whole `bun test` suite (nine GC-heavy cases plus leak
  // reporting at exit), which takes longer than the 5s default under ASAN.
}, 60_000);

test("dev server is deinitialized before its arena when listen fails", async () => {
  using dir = tempDir("dev-server-listen-fails", {
    "index.html": `<!DOCTYPE html><html><body></body></html>`,
    "listen-fails-fixture.ts": `
      import { getDevServerDeinitCount } from "bun:internal-for-testing";
      import html from "./index.html";

      const taken = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("taken") });
      const deinitsBefore = getDevServerDeinitCount();
      let code = "listen succeeded";
      try {
        Bun.serve({ development: true, hostname: "127.0.0.1", port: taken.port, routes: { "/": html } }).stop(true);
      } catch (e) {
        code = e.code;
      }
      const deinits = getDevServerDeinitCount() - deinitsBefore;
      taken.stop(true);
      console.log(JSON.stringify({ code, deinits }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "listen-fails-fixture.ts"],
    // A read of a freed arena then faults in debug builds instead of seeing stale bytes.
    env: { ...bunEnv, MIMALLOC_PURGE_DELAY: "0" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe('{"code":"EADDRINUSE","deinits":1}\n');
  expect(exitCode).toBe(0);
});

// Every dev server registers its server runtime under the key "bake://server-runtime.js",
// so the source map table points to the most recently started server.
// Malloc=1 makes JSC allocate with the system malloc so that ASAN can detect a use-after-free.
test.skipIf(!isASAN)(
  "a stopped dev server unregisters its server runtime's source provider",
  async () => {
    using dir = tempDir("bake-deinit-source-provider", {
      "server.ts": `
        export function render(req, meta) {
          return meta.pageModule.default(req, meta);
        }
        export function registerClientReference(value, file, uid) {
          return { value, file, uid };
        }
      `,
      "routes/index.ts": `
        export default function () {
          return new Response(new Error("probe").stack);
        }
      `,
      "fixture.ts": `
        import { getDevServerDeinitCount } from "bun:internal-for-testing";
        import path from "node:path";

        const serverEntryPoint = path.join(import.meta.dir, "server.ts");
        const framework = {
          fileSystemRouterTypes: [{ root: "routes", style: "nextjs-pages", serverEntryPoint }],
          serverComponents: {
            separateSSRGraph: false,
            serverRuntimeImportSource: serverEntryPoint,
            serverRegisterClientReferenceExport: "registerClientReference",
          },
        };
        const start = () => Bun.serve({ port: 0, app: { framework } });

        async function collect(isDone) {
          for (let i = 0; i < 200 && !isDone(); i++) {
            Bun.gc(true);
            await new Promise(resolve => setTimeout(resolve, 1));
          }
          if (!isDone()) throw new Error("dev server was not deinitialized");
        }

        const survivor = start();

        // The second server's provider replaces the survivor's table entry.
        const deinitsBefore = getDevServerDeinitCount();
        const survivorDebugHooks = globalThis.DEBUG;
        (function startAndStop() {
          start().stop(true);
        })();
        // In a debug build, globalThis.DEBUG.ASSERT is a function from the last runtime that ran,
        // which would keep the second server's provider alive.
        globalThis.DEBUG = survivorDebugHooks;
        await collect(() => getDevServerDeinitCount() > deinitsBefore);
        // A few more collections sweep the runtime's functions and free the provider.
        for (let i = 0; i < 5; i++) {
          Bun.gc(true);
          await new Promise(resolve => setTimeout(resolve, 1));
        }

        const response = await fetch(survivor.url);
        const stack = await response.text();
        survivor.stop(true);
        console.log("status:", response.status);
        console.log("runtime frame:", stack.includes("bake://server-runtime.js"));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        Malloc: "1",
        // Malloc=1 exposes JSC's process-lifetime allocations to LSAN.
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
      },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    // Remapping the runtime frame in the stack trace reads the table entry.
    expect(stdout).toEndWith("status: 200\nruntime frame: true\n");
    expect(exitCode).toBe(0);
  },
  60_000,
);

test.skipIf(isWindows)(
  "dev server closes the descriptor it opens to bundle an edited file again",
  async () => {
    using dir = tempDir("bake-reload-descriptors", {
      "index.html": `<!DOCTYPE html><html><body><script type="module" src="./entry.ts"></script></body></html>`,
      "entry.ts": `console.log("v0!");`,
      "fixture.ts": `
      import { readdirSync, writeFileSync } from "node:fs";
      import html from "./index.html";

      const server = Bun.serve({ port: 0, development: true, routes: { "/": html } });
      const text = url => fetch(new URL(url, server.url)).then(res => res.text());
      const openDescriptors = () => readdirSync(process.platform === "linux" ? "/proc/self/fd" : "/dev/fd").length;
      async function bundled(marker) {
        while (true) {
          const script = (await text("/")).match(/\\/_bun\\/client\\/[^"]+\\.js/)?.[0];
          if (script && (await text(script)).includes(marker)) return;
        }
      }

      await bundled("v0!");
      const before = openDescriptors();
      for (let i = 1; i <= 20; i++) {
        writeFileSync("entry.ts", 'console.log("v' + i + '!");');
        await bundled("v" + i + "!");
      }
      console.log(openDescriptors() - before < 10 ? "closed" : "left open");
      await server.stop(true);
    `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toEndWith("closed\n");
    expect(exitCode).toBe(0);
  },
  60_000,
);

test("a request that crosses maxRequestBodySize while it waits for a bundle that fails", async () => {
  using dir = tempDir("dev-server-deferred-limit", {
    "server.ts": `export function render(req: Request, meta: any) { return meta.pageModule.default(req, meta); }`,
    "routes/index.ts": `export default () => new Response("page" ;;; ))`,
    "fixture.ts": `
      import net from "node:net";

      const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" };
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        maxRequestBodySize: 32,
        development: true,
        app: { framework: { fileSystemRouterTypes: [fsr] } },
      });

      const upload = await new Promise(resolve => {
        const chunks = [];
        const sock = net.connect(server.port, "127.0.0.1", () => {
          const head = "POST / HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n";
          sock.end(head + "30\\r\\n" + Buffer.alloc(48, "x") + "\\r\\n");
        });
        sock.on("data", d => chunks.push(d));
        sock.on("error", () => {});
        sock.on("close", () => resolve(Buffer.concat(chunks).toString("latin1").split("\\r\\n")[0]));
      });
      // The bundle is done when the route answers.
      const next = (await fetch(server.url)).status;
      const deadline = Date.now() + 2000;
      while (server.pendingRequests > 0 && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
      console.log(JSON.stringify({ upload, next, pendingRequests: server.pendingRequests }));
      server.stop(true);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    // The bundler reports the syntax error of the route here.
    stderr: "ignore",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(JSON.parse(stdout)).toEqual({ upload: "HTTP/1.1 413 Payload Too Large", next: 500, pendingRequests: 0 });
  expect(exitCode).toBe(0);
});
