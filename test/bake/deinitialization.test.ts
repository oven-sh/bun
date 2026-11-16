import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { writeFileSync } from "node:fs";
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

test.skipIf(!isASAN)(
  'dev server frees the task that generates the proxy of a "use client" module',
  async () => {
    // Several, one at a time: a stale pointer in the pool's queues can hide a task from LSan.
    const names = ["a", "b", "c", "d", "e", "f"];
    using dir = tempDir("bake-client-reference-task", {
      ...Object.fromEntries(
        names.flatMap(name => [
          [`${name}.ts`, `"use client"; export function ${name}() {}`],
          [
            `routes/${name}.ts`,
            `import { ${name} } from "../${name}"; export default () => new Response(${name}.uid);`,
          ],
        ]),
      ),
      "fixture.ts": `
        const serverEntryPoint = ${JSON.stringify(path.join(import.meta.dir, "minimal.server.ts"))};
        const framework = {
          fileSystemRouterTypes: [{ root: "routes", style: "nextjs-pages", serverEntryPoint }],
          serverComponents: {
            separateSSRGraph: true,
            serverRuntimeImportSource: serverEntryPoint,
            serverRegisterClientReferenceExport: "registerClientReference",
          },
        };
        using server = Bun.serve({ port: 0, app: { framework } });
        for (const name of ${JSON.stringify(names)}) console.log(await (await fetch(server.url + name)).text());
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        BUN_DESTRUCT_VM_ON_EXIT: "1",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${path.join(import.meta.dir, "../leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe(names.join("\n") + "\n");
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

test.skipIf(isWindows)("a dev server that fails to start leaves no descriptor open", async () => {
  using dir = tempDir("bake-failed-start-descriptors", {
    "bunfig.toml": `[serve.static]\ndefine = { A = "{{" }`,
    "index.html": `<!DOCTYPE html>`,
    "fixture.ts": `
      import { readdirSync } from "node:fs";
      import html from "./index.html";

      const openDescriptors = () => readdirSync(process.platform === "linux" ? "/proc/self/fd" : "/dev/fd").length;
      function start() {
        try {
          Bun.serve({ port: 0, development: true, routes: { "/": html } });
        } catch (error) {
          return error.message;
        }
      }
      console.log(start());
      const before = openDescriptors();
      for (let i = 0; i < 20; i++) start();
      console.log(openDescriptors() - before < 10 ? "closed" : "left open");
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

  expect(stdout).toBe("ParserError while initializing development server\nclosed\n");
  expect(exitCode).toBe(0);
});

// /proc/self/fd is Linux-only.
test.skipIf(!isLinux).each([
  ["a file", (name: string) => writeFileSync(name, "")],
  ["a FIFO", mkfifo],
])("an import through %s fails and does not leave it open", async (_, create) => {
  using dir = tempDir("bake-import-through-non-directory", {
    "index.html": `<!DOCTYPE html><script type="module" src="./index.ts"></script>`,
    "index.ts": `import "./not-a-directory/a";`,
    "fixture.ts": `
      import { readdirSync, readlinkSync } from "node:fs";
      import html from "./index.html";

      using server = Bun.serve({ port: 0, development: true, routes: { "/": html } });
      console.log((await fetch(server.url)).status);
      const open = readdirSync("/proc/self/fd").map(fd => {
        try {
          return readlinkSync("/proc/self/fd/" + fd);
        } catch {}
      });
      console.log(["index.ts", "not-a-directory"].map(name => open.some(target => target?.endsWith(name))).join());
    `,
  });
  create(path.join(String(dir), "not-a-directory"));

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain(`Could not resolve: "./not-a-directory/a"`);
  expect(stdout).toBe("500\ntrue,false\n");
  expect(exitCode).toBe(0);
});

// /proc/self/fd is Linux-only.
test.skipIf(!isLinux || !isASAN)("the watcher of a stopped dev server releases what it watched", async () => {
  using dir = tempDir("bake-stopped-watcher", {
    "index.html": `<!DOCTYPE html><script type="module" src="./index.ts"></script>`,
    "index.ts": `import "./a/missing"; import "./b/missing"; import "./c/missing";`,
    "a/.keep": "",
    "b/.keep": "",
    "c/.keep": "",
    "fixture.ts": `
      import { readdirSync, readlinkSync, writeFileSync } from "node:fs";
      import html from "./index.html";

      const watched = () =>
        readdirSync("/proc/self/fd").filter(fd => {
          try {
            return readlinkSync("/proc/self/fd/" + fd).startsWith(import.meta.dir);
          } catch {}
        }).length;
      await (async () => {
        using server = Bun.serve({ port: 0, development: true, routes: { "/": html } });
        await (await fetch(server.url, { keepalive: false })).text();
        console.log(watched() >= 3);
      })();
      // The watcher thread ends at the first change after the server is collected.
      for (let i = 0; i < 200 && watched() > 0; i++) {
        Bun.gc(true);
        writeFileSync("a/.keep", "");
        await Bun.sleep(1);
      }
      console.log(watched() === 0 ? "closed" : "left open");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_DESTRUCT_VM_ON_EXIT: "1",
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
      LSAN_OPTIONS: `print_suppressions=0:suppressions=${path.join(import.meta.dir, "../leaksan.supp")}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("true\nclosed\n");
  expect(stderr.match(/^(Direct|Indirect) leak of .*/gm) ?? []).toEqual([]);
  expect(exitCode).toBe(0);
});

test("a file that is created after its import failed stays watched", async () => {
  using dir = tempDir("bake-import-created-later", {
    "index.html": `<!DOCTYPE html><script type="module" src="./index.ts"></script>`,
    "index.ts": `import "./sub/later";`,
    "sub/.keep": "",
    "fixture.ts": `
      import { writeFileSync } from "node:fs";
      import html from "./index.html";

      using server = Bun.serve({ port: 0, development: true, routes: { "/": html } });
      const text = url => fetch(new URL(url, server.url)).then(res => res.text());
      async function bundled(marker) {
        while (true) {
          const script = (await text("/")).match(/\\/_bun\\/client\\/[^"]+\\.js/)?.[0];
          if (script && (await text(script)).includes(marker)) return;
        }
      }

      const status = (await fetch(server.url)).status;
      for (let i = 0; i < 4; i++) {
        writeFileSync("sub/later.ts", 'console.log("v' + i + '!");');
        await bundled("v" + i + "!");
      }
      console.log(status, "then bundled");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain(`Could not resolve: "./sub/later"`);
  expect(stdout).toEndWith("500 then bundled\n");
  expect(exitCode).toBe(0);
});

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

test("an HMR upgrade on the last connection of a stopped server", async () => {
  using dir = tempDir("dev-server-upgrade-after-stop", {
    "index.html": `<!DOCTYPE html><html><body></body></html>`,
    "fixture.ts": `
      import { getDevServerDeinitCount } from "bun:internal-for-testing";
      import { once } from "node:events";
      import net from "node:net";
      import html from "./index.html";

      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        development: true,
        routes: { "/": html },
        fetch: () => new Response("ok"),
      });
      const sock = net.connect(server.port, "127.0.0.1");
      let response = "";
      let closed = false;
      sock.on("data", data => (response += data.toString("latin1")));
      sock.on("error", () => {});
      sock.on("close", () => (closed = true));
      await once(sock, "connect");
      await new Promise(resolve => sock.write("GET /_bun/hmr HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\n", resolve));
      // Connections are accepted in order, so the server has accepted the first one after this.
      await (await fetch(new URL("/other", server.url), { keepalive: false })).text();

      const deinitsBefore = getDevServerDeinitCount();
      server.stop();
      const deinitsAtStop = getDevServerDeinitCount() - deinitsBefore;
      sock.write(
        "Connection: Upgrade\\r\\nUpgrade: websocket\\r\\nSec-WebSocket-Version: 13\\r\\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\n\\r\\n",
      );
      const deadline = Date.now() + 2000;
      while (!closed && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
      const deinits = getDevServerDeinitCount() - deinitsBefore;
      console.log(JSON.stringify({ status: response.split("\\r\\n")[0], deinitsAtStop, deinits, closed }));
      process.exit(0);
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

  expect(stdout).toBe('{"status":"HTTP/1.1 101 Switching Protocols","deinitsAtStop":0,"deinits":1,"closed":true}\n');
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows)("a client that leaves while the page of a failed bundle is still being sent", async () => {
  using dir = tempDir("dev-server-failure-page-abort", {
    "server.ts": `export function render(req: Request, meta: any) { return meta.pageModule.default(req, meta); }`,
    // About 500 KB of errors, more than a unix socket buffers.
    "routes/index.ts": Array.from({ length: 1000 }, (_, i) => `import "./${i}${Buffer.alloc(200, "a")}";`).join("\n"),
    // Not watched, so removing the socket does not wake the watcher.
    "run": {},
    "fixture.ts": `
      import net from "node:net";

      const fsr = { root: "routes", style: "nextjs-pages", serverEntryPoint: "./server.ts" };
      const server = Bun.serve({
        unix: "run/dev.sock",
        development: true,
        app: { framework: { fileSystemRouterTypes: [fsr] } },
      });

      const sock = net.connect("run/dev.sock", () => sock.write("GET / HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n"));
      const status = await new Promise((resolve, reject) => {
        sock.on("error", reject);
        sock.on("close", () => resolve("closed without a response"));
        sock.once("data", d => {
          sock.destroy();
          resolve(d.toString("latin1").split("\\r\\n")[0]);
        });
      });
      const during = server.pendingRequests;
      const deadline = Date.now() + 2000;
      while (server.pendingRequests > 0 && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
      console.log(JSON.stringify({ status, during, after: server.pendingRequests }));
      server.stop(true);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    // The bundler reports the unresolved imports here.
    stderr: "ignore",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(JSON.parse(stdout)).toEqual({ status: "HTTP/1.1 500 Internal Server Error", during: 1, after: 0 });
  expect(exitCode).toBe(0);
});
