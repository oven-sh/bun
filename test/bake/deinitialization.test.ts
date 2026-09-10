import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
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

// inotify watches a plugin-served file by path, so its watchlist entry holds no
// descriptor. The watcher thread closes the watchlist once it sees the shutdown,
// which is on its next event. Linux-only: the fixture finds that thread in /proc.
test.skipIf(!isLinux)("dev server shutdown closes a watchlist that holds a plugin-served file", async () => {
  using dir = tempDir("dev-server-plugin-watch-shutdown", {
    "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
    "plugin.ts": `
      export default {
        name: "data-loader",
        setup(build) {
          build.onLoad({ filter: /\\.data$/ }, () => ({ contents: "export default 'from plugin';", loader: "js" }));
        },
      };
    `,
    "index.html": `<!DOCTYPE html><html><body><script type="module" src="./app.ts"></script></body></html>`,
    "app.ts": `import data from "./foo.data";\nconsole.log(data);\n`,
    "foo.data": ``,
    "shutdown-fixture.ts": `
      import { getDevServerDeinitCount } from "bun:internal-for-testing";
      import { appendFileSync, readdirSync, readFileSync } from "node:fs";
      import html from "./index.html";

      function watcherThreads() {
        return readdirSync("/proc/self/task").filter(tid => {
          try {
            return readFileSync("/proc/self/task/" + tid + "/comm", "utf8").trim() === "File Watcher";
          } catch {
            return false;
          }
        }).length;
      }

      const server = Bun.serve({ development: true, port: 0, routes: { "/": html } });
      const page = await (await fetch(server.url)).text();
      const script = page.match(/src="([^"]+)"/)?.[1];
      if (!script) throw new Error("no script in " + page);
      const bundle = await (await fetch(new URL(script, server.url))).text();
      if (!bundle.includes("from plugin")) throw new Error("plugin did not serve foo.data");
      if (watcherThreads() !== 1) throw new Error("expected one watcher thread, found " + watcherThreads());

      const deinits = getDevServerDeinitCount();
      server.stop(true);
      while (getDevServerDeinitCount() === deinits) await Bun.sleep(1);

      appendFileSync("app.ts", "// wake the watcher thread\\n");
      while (watcherThreads() !== 0) await Bun.sleep(1);
      console.log("watcher thread exited");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "shutdown-fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The first request logs "Bundled page in Nms: index.html" to stderr.
  const rest = stderr
    .split("\n")
    .filter(line => !line.startsWith("Bundled page in "))
    .join("\n");
  expect(rest).toBe("");
  expect(stdout).toBe("watcher thread exited\n");
  expect(exitCode).toBe(0);
});
