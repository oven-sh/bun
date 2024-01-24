// @known-failing-on-windows: 1 failing
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "../../../../harness";
import { Subprocess } from "bun";
import { copyFileSync, rmSync } from "fs";
import { join } from "path";
import { StringDecoder } from "string_decoder";

const root = join(import.meta.dir, "../");
let dev_server: undefined | Subprocess<"ignore", "pipe", "inherit">;
let baseUrl: string;

test("the dev server can start", async () => {
  rmSync(join(root, ".next"), { recursive: true, force: true });
  copyFileSync(join(root, "src/Counter1.txt"), join(root, "src/Counter.tsx"));

  const install = Bun.spawnSync([bunExe(), "i"], { cwd: root, env: bunEnv });
  if (install.exitCode !== 0) {
    throw new Error("Failed to install dependencies");
  }
  dev_server = Bun.spawn([bunExe(), "--bun", "node_modules/.bin/next", "dev"], {
    cwd: root,
    env: bunEnv,
    stdio: ["ignore", "pipe", "inherit"],
  });
  dev_server.exited.then(() => {
    dev_server = undefined;
  });

  var string_decoder = new StringDecoder("utf-8");
  for await (const chunk of dev_server.stdout) {
    const str = string_decoder.write(chunk);
    console.error(str);
    let match = str.match(/http:\/\/localhost:\d+/);
    if (match) {
      baseUrl = match[0];
    }
    if (str.toLowerCase().includes("ready")) {
      return;
    }
  }
  console.error("Failed to start dev server :/");
  dev_server.kill();
  dev_server = undefined;
}, 30000);

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

  const result = Bun.spawnSync([bunExe(), "test/dev-server-puppeteer.ts", baseUrl], {
    cwd: root,
    env: bunEnv,
    stdio: ["ignore", "inherit", "inherit"],
  });
  expect(result.exitCode).toBe(0);
}, 30000);

afterAll(() => {
  const pid = dev_server?.pid?.toString?.()!;
  if (pid) Bun.spawnSync(["pkill", "-P", pid]);
});
