import { spawn, spawnSync } from "bun";
import { describe, expect, it, test } from "bun:test";
import { bunExe } from "bunExe";

test("bun install", async () => {
  const urls = [];
  const server = Bun.serve({
    async fetch(request) {
      try {
        expect(request.method).toBe("GET");
        expect(request.headers.get("accept")).toBe("application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*");
        expect(await request.text()).toBe("");
        urls.push(request.url);
        return new Response("bar", { status: 404 });
      } finally {
        server.stop();
      }
    },
    port: 54321,
  });
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "foo", "--config", import.meta.dir + "/bun-install.toml"],
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      BUN_DEBUG_QUIET_LOGS: "1",
    },
  });
  expect(stdout).toBeDefined();
  expect(stderr).toBeDefined();
  expect(await new Response(stdout).text()).toBe("");
  var err = await new Response(stderr).text();
  expect(err.split(/\n/)).toContain('error: package "foo" not found localhost/foo 404');
  expect(urls).toContain("http://localhost:54321/foo");
  expect(await exited).toBe(1);
});
