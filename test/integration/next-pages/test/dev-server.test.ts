import { afterAll, beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isCI, isWindows, tmpdirSync, toMatchNodeModulesAt } from "../../../harness";
import { Subprocess } from "bun";
import { copyFileSync } from "fs";
import { join } from "path";
import { StringDecoder } from "string_decoder";
import { cp, rm } from "fs/promises";
import { install_test_helpers } from "bun:internal-for-testing";
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
  console.log("Starting Next.js dev server");
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
      console.log("Closing Next.js dev server");
      dev_server = undefined;
      dev_server_pid = undefined;
    });

  async function readStream() {
    const string_decoder = new StringDecoder("utf-8");
    const stdout = dev_server!.stdout!;
    for await (const chunk of stdout) {
      const str = string_decoder.write(chunk);
      console.error(str);

      if (!hasLoaded) {
        let match = str.match(/http:\/\/localhost:\d+/);
        if (match) {
          baseUrl = match[0];
        }
        if (str.toLowerCase().includes("ready")) {
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

beforeAll(async () => {
  copyFileSync(join(root, "src/Counter1.txt"), join(root, "src/Counter.tsx"));

  const install = Bun.spawnSync([bunExe(), "i"], {
    cwd: root,
    env: { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(root, ".bun-install") },
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
});

afterAll(() => {
  if (dev_server_pid) {
    process?.kill?.(dev_server_pid);
    dev_server_pid = undefined;
  }
});

// Chrome for Testing doesn't support arm64 yet
//
// https://github.com/GoogleChromeLabs/chrome-for-testing/issues/1
// https://github.com/puppeteer/puppeteer/issues/7740
const puppeteer_unsupported = process.platform === "linux" && process.arch === "arm64";

// https://github.com/oven-sh/bun/issues/11255
test.skipIf(puppeteer_unsupported || (isWindows && isCI))(
  "hot reloading works on the client (+ tailwind hmr)",
  async () => {
    expect(dev_server).not.toBeUndefined();
    expect(baseUrl).not.toBeUndefined();

    const lockfile = parseLockfile(root);
    expect(lockfile).toMatchNodeModulesAt(root);
    expect(lockfile).toMatchSnapshot();

    var pid: number, exited;
    let timeout = setTimeout(() => {
      if (timeout && pid) {
        process.kill?.(pid);
        pid = 0;

        if (dev_server_pid) {
          process?.kill?.(dev_server_pid);
          dev_server_pid = undefined;
        }
      }
    }, 30000).unref();

    ({ exited, pid } = Bun.spawn([bunExe(), "test/dev-server-puppeteer.ts", baseUrl], {
      cwd: root,
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit"],
    }));

    expect(await exited).toBe(0);
    pid = 0;
    clearTimeout(timeout);
    // @ts-expect-error
    timeout = undefined;
  },
  100_000,
);
