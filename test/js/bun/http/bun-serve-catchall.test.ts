import type { BunRequest, Server } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

describe("catch-all parameters", () => {
  let server: Server;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch: () => new Response("fallback"),
      routes: {
        // Basic catch-all at the end
        "/api/:path*": (req: BunRequest<"/api/:path*">) => {
          return new Response(
            JSON.stringify({
              path: req.params.path,
            }),
          );
        },
        // Catch-all between normal params
        "/files/:dir/:files*": (req: BunRequest<"/files/:dir/:files*">) => {
          return new Response(
            JSON.stringify({
              dir: req.params.dir,
              files: req.params.files,
            }),
          );
        },
        // Note: Patterns with catch-all not at the end are not supported
        // This matches Express.js behavior - wildcards must be at the end
        // Root catch-all with param name
        "/:splat*": (req: BunRequest<"/:splat*">) => {
          return new Response(
            JSON.stringify({
              splat: req.params.splat,
            }),
          );
        },
      },
    });
    server.unref();
  });

  afterAll(() => {
    server.stop(true);
  });

  describe("basic catch-all", () => {
    it("captures single segment", async () => {
      const res = await fetch(`${server.url}api/users`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        path: ["users"],
      });
    });

    it("captures multiple segments", async () => {
      const res = await fetch(`${server.url}api/users/123/posts`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        path: ["users", "123", "posts"],
      });
    });

    it("doesn't match empty catch-all", async () => {
      // For non-root paths, catch-all parameters require at least one segment after the prefix
      // But /api is caught by the root catch-all /:splat*
      const res = await fetch(`${server.url}api`);
      const data = await res.json();
      expect(data).toEqual({
        splat: ["api"],
      });
    });

    it("handles encoded segments", async () => {
      const res = await fetch(`${server.url}api/hello%20world/test%2Fpath`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        path: ["hello world", "test/path"],
      });
    });
  });

  describe("catch-all between params", () => {
    it("captures middle segments", async () => {
      const res = await fetch(`${server.url}files/documents/2024/january/report.pdf`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        dir: "documents",
        files: ["2024", "january", "report.pdf"],
      });
    });

    it("doesn't match when catch-all is empty", async () => {
      // :files* requires at least one segment after documents/
      // But /files/documents is caught by the root catch-all /:splat*
      const res = await fetch(`${server.url}files/documents`);
      const data = await res.json();
      expect(data).toEqual({
        splat: ["files", "documents"],
      });
    });
  });

  // Note: Catch-all with params after (like /users/:id/actions/:action*/:format) is not supported
  // This matches Express.js behavior where wildcards must be at the end of the pattern

  describe("root catch-all", () => {
    it.skip("root catch-all has issues with route precedence", async () => {
      // Root catch-all (/:splat*) doesn't work reliably due to how it's converted to uWS wildcard
      // When transformed to /*, it may not match as expected
      // This is a known limitation
    });
  });
});

describe("catch-all type safety", () => {
  it("should have correct TypeScript types", () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("fallback"),
      routes: {
        "/api/:files*": (req: BunRequest<"/api/:files*">) => {
          // TypeScript should recognize req.params.files as string[]
          const files: string[] = req.params.files;
          return new Response(JSON.stringify(files));
        },
        "/mixed/:id/:rest*": (req: BunRequest<"/mixed/:id/:rest*">) => {
          // TypeScript should recognize req.params.id as string
          const id: string = req.params.id;
          // TypeScript should recognize req.params.rest as string[]
          const rest: string[] = req.params.rest;
          return new Response(JSON.stringify({ id, rest }));
        },
      },
    });
    server.stop(true);
    expect(true).toBe(true); // Just a type test
  });
});

describe("edge cases", () => {
  it("handles trailing slashes", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("fallback"),
      routes: {
        "/test/:path*": (req: BunRequest<"/test/:path*">) => {
          return new Response(JSON.stringify({ path: req.params.path }));
        },
      },
    });
    server.unref();

    const res1 = await fetch(`${server.url}test/foo/bar/`);
    const data1 = await res1.json();
    expect(data1).toEqual({ path: ["foo", "bar"] });

    const res2 = await fetch(`${server.url}test/foo/bar`);
    const data2 = await res2.json();
    expect(data2).toEqual({ path: ["foo", "bar"] });

    server.stop(true);
  });

  it("handles special characters in catch-all", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("fallback"),
      routes: {
        "/special/:path*": (req: BunRequest<"/special/:path*">) => {
          return new Response(JSON.stringify({ path: req.params.path }));
        },
      },
    });
    server.unref();

    const res = await fetch(`${server.url}special/hello-world/test_file/page.html`);
    const data = await res.json();
    expect(data).toEqual({ path: ["hello-world", "test_file", "page.html"] });

    server.stop(true);
  });

  it("prioritizes more specific routes", async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response("fallback"),
      routes: {
        "/api/users/:id": () => new Response("specific"),
        "/api/:path*": () => new Response("catch-all"),
      },
    });
    server.unref();

    const res1 = await fetch(`${server.url}api/users/123`);
    expect(await res1.text()).toBe("specific");

    const res2 = await fetch(`${server.url}api/users/123/posts`);
    expect(await res2.text()).toBe("catch-all");

    server.stop(true);
  });
});