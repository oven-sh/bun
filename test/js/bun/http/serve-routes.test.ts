import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("server.routes getter", () => {
  test("should return empty array when no routes are defined", async () => {
    using dir = tempDir("serve-routes-test", {
      "server.js": `
        const server = Bun.serve({
          port: 0,
          fetch(req) {
            return new Response("Hello");
          }
        });
        console.log(JSON.stringify(server.routes));
        server.stop();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "server.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("[]");
    expect(exitCode).toBe(0);
  });

  test("should return array with static route paths", async () => {
    using dir = tempDir("serve-routes-test", {
      "server.js": `
        const server = Bun.serve({
          port: 0,
          routes: {
            "/api/users": () => new Response("users"),
            "/api/posts": () => new Response("posts"),
            "/api/comments": () => new Response("comments"),
          },
          fetch(req) {
            return new Response("fallback");
          }
        });
        const routes = server.routes;
        console.log(JSON.stringify(routes.sort()));
        server.stop();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "server.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const routes = JSON.parse(stdout.trim());
    expect(routes).toEqual(["/api/comments", "/api/posts", "/api/users"]);
    expect(exitCode).toBe(0);
  });

  test("should work with parameterized routes", async () => {
    using dir = tempDir("serve-routes-test", {
      "server.js": `
        const server = Bun.serve({
          port: 0,
          routes: {
            "/users/:id": (req) => new Response("user"),
            "/posts/:postId/comments/:commentId": (req) => new Response("comment"),
          },
          fetch(req) {
            return new Response("fallback");
          }
        });
        const routes = server.routes;
        console.log(JSON.stringify(routes.sort()));
        server.stop();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "server.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const routes = JSON.parse(stdout.trim());
    expect(routes).toEqual(["/posts/:postId/comments/:commentId", "/users/:id"]);
    expect(exitCode).toBe(0);
  });

  test("should work with HTTP method specific routes", async () => {
    using dir = tempDir("serve-routes-test", {
      "server.js": `
        const server = Bun.serve({
          port: 0,
          routes: {
            "/api": {
              GET: () => new Response("GET"),
              POST: () => new Response("POST"),
              PUT: () => new Response("PUT"),
            },
            "/users/:id": {
              GET: (req) => new Response("get user"),
              DELETE: (req) => new Response("delete user"),
            }
          },
          fetch(req) {
            return new Response("fallback");
          }
        });
        const routes = server.routes;
        console.log(JSON.stringify(routes.sort()));
        server.stop();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "server.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const routes = JSON.parse(stdout.trim());
    expect(routes).toContain("/api");
    expect(routes).toContain("/users/:id");
    expect(exitCode).toBe(0);
  });

  test("should work with mixed static and function routes", async () => {
    using dir = tempDir("serve-routes-test", {
      "server.js": `
        const server = Bun.serve({
          port: 0,
          routes: {
            "/static": () => new Response("static"),
            "/another": () => new Response("another"),
          },
          fetch(req) {
            return new Response("fallback");
          }
        });
        const routes = server.routes;
        console.log(JSON.stringify(routes.sort()));
        server.stop();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "server.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const routes = JSON.parse(stdout.trim());
    expect(routes).toEqual(["/another", "/static"]);
    expect(exitCode).toBe(0);
  });

  test("should return array that can be iterated", async () => {
    using dir = tempDir("serve-routes-test", {
      "server.js": `
        const server = Bun.serve({
          port: 0,
          routes: {
            "/api/a": () => new Response("a"),
            "/api/b": () => new Response("b"),
            "/api/c": () => new Response("c"),
          },
          fetch(req) {
            return new Response("fallback");
          }
        });
        const routes = server.routes;
        console.log(Array.isArray(routes));
        console.log(routes.length);
        console.log(typeof routes[0]);
        server.stop();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "server.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("true");
    expect(lines[1]).toBe("3");
    expect(lines[2]).toBe("string");
    expect(exitCode).toBe(0);
  });

  test("should work after server reload", async () => {
    using dir = tempDir("serve-routes-test", {
      "server.js": `
        const server = Bun.serve({
          port: 0,
          routes: {
            "/before": () => new Response("before"),
          },
          fetch(req) {
            return new Response("fallback");
          }
        });
        console.log(JSON.stringify(server.routes.sort()));

        server.reload({
          routes: {
            "/after": () => new Response("after"),
          },
          fetch(req) {
            return new Response("fallback");
          }
        });
        console.log(JSON.stringify(server.routes.sort()));
        server.stop();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "server.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(JSON.parse(lines[0])).toEqual(["/before"]);
    expect(JSON.parse(lines[1])).toEqual(["/after"]);
    expect(exitCode).toBe(0);
  });
});
