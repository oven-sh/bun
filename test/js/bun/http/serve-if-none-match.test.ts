import { afterAll, beforeAll, describe, expect, it } from "bun:test";

describe("If-None-Match Support", () => {
  let server: Server;

  const testContent = "Hello, World!";
  const routes = {
    "/basic": new Response(testContent, {
      headers: {
        "Content-Type": "text/plain",
      },
    }),
    "/with-etag": new Response("Custom content", {
      headers: {
        "Content-Type": "text/plain",
        "ETag": '"custom-etag"',
      },
    }),
    "/weak-etag": new Response("Weak content", {
      headers: {
        "Content-Type": "text/plain",
        "ETag": 'W/"weak-etag"',
      },
    }),
  };

  beforeAll(async () => {
    server = Bun.serve({
      static: routes,
      port: 0,
      fetch: () => new Response("Not Found", { status: 404 }),
    });
    server.unref();
  });

  afterAll(() => {
    server.stop(true);
  });

  describe("ETag Generation", () => {
    it("should automatically generate ETag for static responses", async () => {
      const res = await fetch(`${server.url}basic`);
      expect(res.status).toBe(200);
      expect(res.headers.get("ETag")).toBeDefined();
      expect(res.headers.get("ETag")).toMatch(/^"[a-f0-9]+"$/);
      expect(await res.text()).toBe(testContent);
    });

    it("should preserve existing ETag headers", async () => {
      const res = await fetch(`${server.url}with-etag`);
      expect(res.status).toBe(200);
      expect(res.headers.get("ETag")).toBe('"custom-etag"');
      expect(await res.text()).toBe("Custom content");
    });

    it("should preserve weak ETag headers", async () => {
      const res = await fetch(`${server.url}weak-etag`);
      expect(res.status).toBe(200);
      expect(res.headers.get("ETag")).toBe('W/"weak-etag"');
      expect(await res.text()).toBe("Weak content");
    });
  });

  describe("If-None-Match Evaluation", () => {
    it("should return 304 when If-None-Match matches ETag", async () => {
      // First request to get the ETag
      const initialRes = await fetch(`${server.url}basic`);
      const etag = initialRes.headers.get("ETag");
      expect(etag).toBeDefined();

      // Second request with If-None-Match
      const res = await fetch(`${server.url}basic`, {
        headers: {
          "If-None-Match": etag!,
        },
      });

      expect(res.status).toBe(304);
      expect(res.headers.get("ETag")).toBe(etag);
      expect(await res.text()).toBe("");
    });

    it("should return 304 when If-None-Match matches custom ETag", async () => {
      const res = await fetch(`${server.url}with-etag`, {
        headers: {
          "If-None-Match": '"custom-etag"',
        },
      });

      expect(res.status).toBe(304);
      expect(res.headers.get("ETag")).toBe('"custom-etag"');
      expect(await res.text()).toBe("");
    });

    it("should return 304 for weak ETag comparison", async () => {
      const res = await fetch(`${server.url}weak-etag`, {
        headers: {
          "If-None-Match": 'W/"weak-etag"',
        },
      });

      expect(res.status).toBe(304);
      expect(res.headers.get("ETag")).toBe('W/"weak-etag"');
      expect(await res.text()).toBe("");
    });

    it("should return 304 when comparing strong vs weak ETags", async () => {
      const res = await fetch(`${server.url}weak-etag`, {
        headers: {
          "If-None-Match": '"weak-etag"', // Strong comparison with weak ETag
        },
      });

      expect(res.status).toBe(304);
      expect(res.headers.get("ETag")).toBe('W/"weak-etag"');
      expect(await res.text()).toBe("");
    });

    it("should return 304 for '*' wildcard", async () => {
      const res = await fetch(`${server.url}basic`, {
        headers: {
          "If-None-Match": "*",
        },
      });

      expect(res.status).toBe(304);
      expect(await res.text()).toBe("");
    });

    it("should handle multiple ETags in If-None-Match", async () => {
      const initialRes = await fetch(`${server.url}basic`);
      const etag = initialRes.headers.get("ETag");

      const res = await fetch(`${server.url}basic`, {
        headers: {
          "If-None-Match": `"non-matching-etag", ${etag}, "another-etag"`,
        },
      });

      expect(res.status).toBe(304);
      expect(await res.text()).toBe("");
    });

    it("should return 200 when If-None-Match does not match", async () => {
      const res = await fetch(`${server.url}basic`, {
        headers: {
          "If-None-Match": '"non-matching-etag"',
        },
      });

      expect(res.status).toBe(200);
      expect(await res.text()).toBe(testContent);
    });

    it("should handle malformed If-None-Match headers gracefully", async () => {
      const res = await fetch(`${server.url}basic`, {
        headers: {
          "If-None-Match": "malformed-etag-without-quotes",
        },
      });

      expect(res.status).toBe(200);
      expect(await res.text()).toBe(testContent);
    });

    it("should handle whitespace in If-None-Match", async () => {
      const initialRes = await fetch(`${server.url}basic`);
      const etag = initialRes.headers.get("ETag");

      const res = await fetch(`${server.url}basic`, {
        headers: {
          "If-None-Match": `  ${etag}  `,
        },
      });

      expect(res.status).toBe(304);
      expect(await res.text()).toBe("");
    });
  });

  describe("HEAD Requests", () => {
    it("should support If-None-Match with HEAD requests", async () => {
      const initialRes = await fetch(`${server.url}basic`, { method: "HEAD" });
      const etag = initialRes.headers.get("ETag");
      expect(etag).toBeDefined();

      const res = await fetch(`${server.url}basic`, {
        method: "HEAD",
        headers: {
          "If-None-Match": etag!,
        },
      });

      expect(res.status).toBe(304);
      expect(res.headers.get("ETag")).toBe(etag);
      expect(await res.text()).toBe("");
    });

    it("should return 200 for HEAD when If-None-Match does not match", async () => {
      const res = await fetch(`${server.url}basic`, {
        method: "HEAD",
        headers: {
          "If-None-Match": '"non-matching-etag"',
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Length")).toBe(testContent.length.toString());
      expect(await res.text()).toBe("");
    });
  });

  describe("Non-200 Status Codes", () => {
    it("should not apply If-None-Match to redirects", async () => {
      const redirectRoutes = {
        "/redirect": Response.redirect("/basic", 302),
      };

      const redirectServer = Bun.serve({
        static: redirectRoutes,
        port: 0,
        fetch: () => new Response("Not Found", { status: 404 }),
      });

      try {
        const res = await fetch(`${redirectServer.url}redirect`, {
          redirect: "manual",
          headers: {
            "If-None-Match": "*",
          },
        });

        expect(res.status).toBe(302);
        expect(res.headers.get("Location")).toBe("/basic");
      } finally {
        redirectServer.stop(true);
      }
    });
  });

  describe("Other HTTP Methods", () => {
    it("should not apply If-None-Match to POST requests", async () => {
      const res = await fetch(`${server.url}basic`, {
        method: "POST",
        headers: {
          "If-None-Match": "*",
        },
      });

      // POST requests to static routes return the content normally (no If-None-Match applied)
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(testContent);
    });

    it("should not apply If-None-Match to PUT requests", async () => {
      const res = await fetch(`${server.url}basic`, {
        method: "PUT",
        headers: {
          "If-None-Match": "*",
        },
      });

      // PUT requests to static routes return the content normally (no If-None-Match applied)
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(testContent);
    });
  });
});
