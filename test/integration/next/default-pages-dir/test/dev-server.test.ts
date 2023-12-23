import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "../../../../harness";
import { Subprocess } from "bun";
import { copyFileSync, rmSync } from "fs";
import { join } from "path";

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
  for await (const chunk of dev_server.stdout) {
    console.error({ chunk: new TextDecoder().decode(chunk) });
    const str = new TextDecoder().decode(chunk);
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

test("ssr works for 100 requests", async () => {
  expect(dev_server).not.toBeUndefined();
  expect(baseUrl).not.toBeUndefined();

  const promises = [];
  for (let i = 0; i < 100; i++) {
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

  const x = await Promise.allSettled(promises);
  for (const y of x) {
    expect(y.status).toBe("fulfilled");
  }
}, 10000);

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
  Bun.spawnSync(["pkill", "-P", dev_server!.pid.toString()]);
});
