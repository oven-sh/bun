import { sleep } from "bun";
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { tmpdir } from "os";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/2462
test("custom registry doesn't have multiple trailing slashes in pathname", async () => {
  var urls: string[] = [];

  var server = Bun.serve({
    port: 0,
    async fetch(req) {
      urls.push(req.url);
      return new Response("ok");
    },
  });
  const { port, hostname } = server;
  const package_dir = join(tmpdir(), mkdtempSync("bun-install-path"));
  try {
    mkdirSync(package_dir, { recursive: true });
  } catch {}
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

  await sleep(10);

  server.stop(true);
  expect(urls.length).toBeGreaterThan(0);
  expect(urls[0]).toBe(`http://${hostname}:${port}/prefixed-route/react`);
  rmSync(package_dir, { recursive: true, force: true });
});
