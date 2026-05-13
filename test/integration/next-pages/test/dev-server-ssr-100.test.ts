import { Subprocess } from "bun";
import { install_test_helpers } from "bun:internal-for-testing";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { copyFileSync } from "fs";
import { cp, rm } from "fs/promises";
import PQueue from "p-queue";
import { join } from "path";
import { StringDecoder } from "string_decoder";
import { bunEnv, bunExe, tmpdirSync, toMatchNodeModulesAt } from "../../../harness";
const { parseLockfile } = install_test_helpers;

expect.extend({ toMatchNodeModulesAt });

let root = tmpdirSync();

beforeAll(async () => {
  await rm(root, { recursive: true, force: true });
  await cp(join(import.meta.dir, "../"), root, { recursive: true, force: true });
  await rm(join(root, ".next"), { recursive: true, force: true });
  console.log("Copied to:", root);
});

let dev_server: undefined | Subprocess<"ignore", "pipe", "inherit">;
let baseUrl: string;
let dev_server_pid: number | undefined = undefined;
async function getDevServerURL() {
  console.log("Starting dev server");
  dev_server = Bun.spawn([bunExe(), "--bun", "run", "next", "dev", "--port=0"], {
    cwd: root,
    env: {
      ...bunEnv,
      NEXT_TELEMETRY_DISABLED: "1",
      // Print lots of debug logs in next.js:
      // "DEBUG": "*",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  dev_server.stdout?.unref?.();
  var hasLoaded = false;
  dev_server_pid = dev_server.pid;

  const { resolve: loaded, promise, reject } = Promise.withResolvers();
  dev_server.exited
    .catch(e => {
      dev_server_pid = undefined;
      dev_server = undefined;

      if (hasLoaded) {
        reportError(e);
      } else {
        reject(e);
      }
    })
    .finally(() => {
      console.log("Dev server exited");
      dev_server = undefined;
      dev_server_pid = undefined;
    });

  async function readStream() {
    const string_decoder = new StringDecoder("utf-8");
    const stdout = dev_server!.stdout!;
    let accumulated = "";
    for await (const chunk of stdout) {
      const str = string_decoder.write(chunk);
      console.error(str);

      if (!hasLoaded) {
        accumulated += str;
        let match = accumulated.match(/http:\/\/localhost:\d+/);
        if (match) {
          baseUrl = match[0];
        }
        if (accumulated.toLowerCase().includes("ready") && baseUrl) {
          hasLoaded = true;
          loaded();
        }
      }
    }
  }

  readStream()
    .catch(e => reject(e))
    .finally(() => {
      dev_server.unref?.();
    });
  await promise;
  return baseUrl;
}

async function startDevServer() {
  copyFileSync(join(root, "src/Counter1.txt"), join(root, "src/Counter.tsx"));

  const install = Bun.spawnSync([bunExe(), "i"], {
    cwd: root,
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(root, "bunstall") },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  if (!install.success) {
    const reason = install.signalCode || `code ${install.exitCode}`;
    throw new Error(`Failed to install dependencies: ${reason}`);
  }

  try {
    await getDevServerURL();
  } catch (e) {
    console.error("Failed to start dev server :/");
    dev_server?.kill?.();
    dev_server = undefined;
  }
  return {
    [Symbol.dispose]: () => {
      stopDevServer();
    },
  };
}

function stopDevServer() {
  if (dev_server_pid) {
    const pid = dev_server_pid;
    dev_server_pid = undefined;
    process?.kill?.(pid);
  }
}

afterAll(stopDevServer);

// This test installs deps, cold-starts the Next.js dev server (which recompiles
// per request), then makes 100 SSR requests at concurrency 4. The wall-clock
// time legitimately varies a lot with CI runner load, so the release-build
// budget is generous (5min) to avoid the bun:test per-test timeout firing on a
// slow runner. Debug builds keep their existing larger budget.
const timeout = Bun.version.includes("debug") ? 1_000_000 : 300_000;
test(
  "ssr works for 100-ish requests",
  async () => {
    using devServer = await startDevServer();
    const { resolve, reject, promise } = Promise.withResolvers();
    expect(dev_server).not.toBeUndefined();
    expect(baseUrl).not.toBeUndefined();
    const lockfile = parseLockfile(root);
    expect(lockfile).toMatchNodeModulesAt(root);
    expect(lockfile).toMatchSnapshot();
    const controller = new AbortController();

    // On an arm64 mac, it doesn't get faster if you increase it beyond 4 as of August, 2025.
    const queue = new PQueue({ concurrency: 4 });

    async function run(i: number) {
      // Next's dev server can emit a transient 5xx while it's recompiling under
      // concurrent load. Retry a small bounded number of times on 5xx only; a
      // persistent 5xx (or a non-200 that isn't 5xx) still fails the test below.
      let x: Response;
      for (let attempt = 0; ; attempt++) {
        x = await fetch(`${baseUrl}/?i=${i}`, {
          headers: {
            "Cache-Control": "private, no-cache, no-store, must-revalidate",
          },
          signal: controller.signal,
        });
        if (x.status < 500 || attempt >= 3) break;
        await x.arrayBuffer().catch(() => {});
      }
      expect(x.status).toBe(200);
      const text = await x.text();
      console.count("Completed request");
      expect(text).toContain(`>${Bun.version}</code>`);
    }

    for (let i = 0; i < 100; i++) {
      queue.add(
        async () => {
          await run(i);
        },
        { signal: controller.signal },
      );
    }
    queue.once("error", e => {
      reject(e);
    });
    queue.onEmpty().then(resolve);
    await promise;
  },
  timeout,
);
