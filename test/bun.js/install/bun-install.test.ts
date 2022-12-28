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
        expect(request.headers.get("npm-auth-type")).toBe(null);
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
    cmd: [bunExe(), "install", "foo", "--config", import.meta.dir + "/basic.toml"],
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

test("bun install @scoped", async () => {
  let seen_token = false;
  const url = "http://localhost:54321/@foo/bar";
  const urls = [];
  const server = Bun.serve({
    async fetch(request) {
      try {
        expect(request.method).toBe("GET");
        expect(request.headers.get("accept")).toBe("application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*");
        if (request.url === url) {
          expect(request.headers.get("authorization")).toBe("Bearer bar");
          expect(request.headers.get("npm-auth-type")).toBe("legacy");
          seen_token = true;
        } else {
          expect(request.headers.get("npm-auth-type")).toBe(null);
        }
        expect(await request.text()).toBe("");
        urls.push(request.url);
        return new Response("Tea?", { status: 418 });
      } finally {
        server.stop();
      }
    },
    port: 54321,
  });
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install", "@foo/bar", "--config", import.meta.dir + "/basic.toml"],
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
  expect(err.split(/\n/)).toContain(`GET ${url} - 418`);
  expect(urls).toContain(url);
  expect(seen_token).toBe(true);
  expect(await exited).toBe(1);
});
