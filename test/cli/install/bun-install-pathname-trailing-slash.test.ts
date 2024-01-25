import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { join } from "path";
import { tmpdirSync } from "./dummy.registry";

let package_dir: string;

beforeEach(() => {
  package_dir = tmpdirSync("bun-install-path");
});

afterEach(() => {
  rmSync(package_dir, { recursive: true, force: true });
});

// https://github.com/oven-sh/bun/issues/2462
test("custom registry doesn't have multiple trailing slashes in pathname", async () => {
  const urls: string[] = [];

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      urls.push(req.url);
      return new Response("ok");
    },
  });
  const { port, hostname } = server;
  await Bun.write(
    join(package_dir, "bunfig.toml"),
    `
[install]
cache = false
registry = "http://${hostname}:${port}/prefixed-route/"
`,
  );
  await Bun.write(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "test",
      version: "0.0.0",
      dependencies: {
        "react": "my-custom-tag",
      },
    }),
  );

  Bun.spawnSync({
    cmd: [bunExe(), "install", "--force"],
    env: bunEnv,
    cwd: package_dir,
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });

  server.stop(true);
  expect(urls.length).toBe(1);
  expect(urls).toEqual([`http://${hostname}:${port}/prefixed-route/react`]);
});
