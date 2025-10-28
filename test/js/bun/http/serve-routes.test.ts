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
        console.log(JSON.stringify([...routes].sort()));
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
        console.log(JSON.stringify([...routes].sort()));
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
        console.log(JSON.stringify([...routes].sort()));
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
    // Should deduplicate paths - each path should appear only once
    expect(routes.length).toBe(2);
    expect(new Set(routes).size).toBe(2);
    expect(routes).toEqual(["/api", "/users/:id"]);
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
        console.log(JSON.stringify([...routes].sort()));
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
        console.log(JSON.stringify([...server.routes].sort()));

        server.reload({
          routes: {
            "/after": () => new Response("after"),
          },
          fetch(req) {
            return new Response("fallback");
          }
        });
        console.log(JSON.stringify([...server.routes].sort()));
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

  test("should return routes immediately after creation", async () => {
    using dir = tempDir("serve-routes-test", {
      "server.js": `
        const server = Bun.serve({
          port: 0,
          routes: {
            "/immediate": () => new Response("test"),
            "/another": () => new Response("test2"),
          },
          fetch(req) {
            return new Response("fallback");
          }
        });
        // Check routes immediately without making any requests
        console.log(JSON.stringify([...server.routes].sort()));
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
    expect(routes).toEqual(["/another", "/immediate"]);
    expect(exitCode).toBe(0);
  });

  test("should handle very long route paths", async () => {
    using dir = tempDir("serve-routes-test", {
      "server.js": `
        const longPath = "/" + "segment/".repeat(50) + "end";
        const server = Bun.serve({
          port: 0,
          routes: {
            [longPath]: () => new Response("long"),
            "/short": () => new Response("short"),
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
    const expectedLongPath = "/" + "segment/".repeat(50) + "end";
    expect(routes.length).toBe(2);
    expect(routes).toContain("/short");
    expect(routes).toContain(expectedLongPath);
    expect(routes.find(r => r.length > 400)).toBe(expectedLongPath);
    expect(exitCode).toBe(0);
  });

  test("should handle duplicate deduplication correctly", async () => {
    using dir = tempDir("serve-routes-test", {
      "server.js": `
        const server = Bun.serve({
          port: 0,
          routes: {
            "/duplicate": {
              GET: () => new Response("GET"),
              POST: () => new Response("POST"),
              PUT: () => new Response("PUT"),
              DELETE: () => new Response("DELETE"),
              PATCH: () => new Response("PATCH"),
            }
          },
          fetch(req) {
            return new Response("fallback");
          }
        });
        const routes = server.routes;
        console.log(routes.length);
        console.log(new Set(routes).size);
        console.log(JSON.stringify(routes));
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
    expect(lines[0]).toBe("1"); // Only 1 unique route
    expect(lines[1]).toBe("1"); // Set size confirms uniqueness
    expect(JSON.parse(lines[2])).toEqual(["/duplicate"]);
    expect(exitCode).toBe(0);
  });

  test("should include wildcard routes", async () => {
    using dir = tempDir("serve-routes-test", {
      "server.js": `
        const server = Bun.serve({
          port: 0,
          routes: {
            "/*": () => new Response("wildcard"),
            "/specific": () => new Response("specific"),
          },
          fetch(req) {
            return new Response("fallback");
          }
        });
        console.log(JSON.stringify([...server.routes].sort()));
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
    expect(routes).toContain("/*");
    expect(routes).toContain("/specific");
    expect(routes.length).toBe(2);
    expect(exitCode).toBe(0);
  });
});
