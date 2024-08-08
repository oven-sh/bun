import { afterEach, beforeEach, expect, test } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

let package_dir: string;

beforeEach(() => {
  package_dir = tmpdirSync();
});

// https://github.com/oven-sh/bun/issues/2462
test("custom registry doesn't have multiple trailing slashes in pathname", async () => {
  const urls: string[] = [];

  using server = Bun.serve({
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

  expect(urls.length).toBe(1);
  expect(urls).toEqual([`http://${hostname}:${port}/prefixed-route/react`]);
});
