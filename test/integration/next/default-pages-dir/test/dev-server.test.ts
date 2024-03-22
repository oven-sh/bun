// @known-failing-on-windows: 1 failing
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "../../../../harness";
import { Subprocess } from "bun";
import { copyFileSync, rmSync } from "fs";
import { join } from "path";
import { StringDecoder } from "string_decoder";
import { cp, rm } from "fs/promises";

import { tmpdir } from "node:os";

let root = join(
  tmpdir(),
  "bun-next-default-pages-dir-" + Math.random().toString(36).slice(2) + "-" + Date.now().toString(36),
);

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
  dev_server = Bun.spawn([bunExe(), "--bun", "node_modules/.bin/next", "dev", "--port=0"], {
    cwd: root,
    env: {
      ...bunEnv,
      NEXT_TELEMETRY_DISABLED: "1",
      // Print lots of debug logs in next.js:
      // "DEBUG": "*",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  dev_server.unref();
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

  readStream();
  await promise;
  return baseUrl;
}

beforeAll(async () => {
  copyFileSync(join(root, "src/Counter1.txt"), join(root, "src/Counter.tsx"));

  const install = Bun.spawnSync([bunExe(), "i"], {
    cwd: root,
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  if (!install.success) {
    throw new Error("Failed to install dependencies");
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

test("ssr works for 100-ish requests", async () => {
  expect(dev_server).not.toBeUndefined();
  expect(baseUrl).not.toBeUndefined();

  const batchSize = 16;
  const promises = [];
  for (let j = 0; j < 100; j += batchSize) {
    for (let i = j; i < j + batchSize; i++) {
      promises.push(
        (async () => {
          const x = await fetch(`${baseUrl}/?i=${i}`, {
            headers: {
              "Cache-Control": "private, no-cache, no-store, must-revalidate",
            },
          });
          expect(x.status).toBe(200);
          const text = await x.text();
          console.count("Completed request");
          expect(text).toContain(`>${Bun.version}</code>`);
        })(),
      );
    }
    await Promise.allSettled(promises);
  }

  const x = await Promise.allSettled(promises);
  const failing = x.filter(x => x.status === "rejected").map(x => x.reason!);
  if (failing.length) {
    throw new AggregateError(failing, failing.length + " requests failed", {});
  }
  for (const y of x) {
    expect(y.status).toBe("fulfilled");
  }
}, 100000);

test("hot reloading works on the client (+ tailwind hmr)", async () => {
  expect(dev_server).not.toBeUndefined();
  expect(baseUrl).not.toBeUndefined();
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
}, 30000);
