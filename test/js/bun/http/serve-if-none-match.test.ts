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
    "/comma-etag": new Response("Comma content", {
      headers: {
        "Content-Type": "text/plain",
        "ETag": '"ab,cd"',
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

    it("should not 304 when a list member merely contains the ETag between commas", async () => {
      // RFC 9110 §8.8.3: a comma is a legal byte inside a quoted opaque-tag, so
      // `"a,xx,b"` is ONE tag, not a list whose members include the server tag.
      const etag = (await fetch(`${server.url}basic`)).headers.get("ETag")!;
      const inner = etag.slice(1, -1); // strip surrounding quotes

      const res = await fetch(`${server.url}basic`, {
        headers: {
          "If-None-Match": `"a,${inner},b"`,
        },
      });

      expect(res.status).toBe(200);
      expect(await res.text()).toBe(testContent);
    });

    it("should 304 when a comma-containing ETag is echoed back exactly", async () => {
      const res = await fetch(`${server.url}comma-etag`, {
        headers: {
          "If-None-Match": '"ab,cd"',
        },
      });

      expect(res.status).toBe(304);
      expect(res.headers.get("ETag")).toBe('"ab,cd"');
      expect(await res.text()).toBe("");
    });

    it("should 304 when a comma-containing ETag is a member of a list", async () => {
      const res = await fetch(`${server.url}comma-etag`, {
        headers: {
          "If-None-Match": '"zzz", "ab,cd"',
        },
      });

      expect(res.status).toBe(304);
      expect(res.headers.get("ETag")).toBe('"ab,cd"');
      expect(await res.text()).toBe("");
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

  // RFC 9110 §13.2.2 step 4 / §13.1.3: when If-None-Match is absent, an origin
  // MUST evaluate If-Modified-Since against the selected representation's
  // Last-Modified and MUST answer 304 when Last-Modified <= the field date.
  describe("If-Modified-Since Evaluation", () => {
    const LM = "Wed, 01 Jan 2020 00:00:00 GMT";
    const EARLIER = "Tue, 01 Jan 2019 00:00:00 GMT";
    const LATER = "Fri, 01 Jan 2027 00:00:00 GMT";
    let imsServer: Server;

    beforeAll(() => {
      imsServer = Bun.serve({
        port: 0,
        development: false,
        static: {
          "/lm": new Response("hello static route", {
            headers: { "Content-Type": "text/plain", "Last-Modified": LM },
          }),
          "/no-lm": new Response("no last-modified", {
            headers: { "Content-Type": "text/plain" },
          }),
        },
        fetch: () => new Response("Not Found", { status: 404 }),
      });
      imsServer.unref();
    });

    afterAll(() => {
      imsServer.stop(true);
    });

    it("should return 304 when If-Modified-Since equals Last-Modified (GET)", async () => {
      const res = await fetch(`${imsServer.url}lm`, {
        headers: { "If-Modified-Since": LM },
      });
      expect(res.status).toBe(304);
      expect(res.headers.get("Last-Modified")).toBe(LM);
      expect(await res.text()).toBe("");
    });

    it("should return 304 when If-Modified-Since is later than Last-Modified (GET)", async () => {
      const res = await fetch(`${imsServer.url}lm`, {
        headers: { "If-Modified-Since": LATER },
      });
      expect(res.status).toBe(304);
      expect(await res.text()).toBe("");
    });

    it("should return 200 when If-Modified-Since is earlier than Last-Modified", async () => {
      const res = await fetch(`${imsServer.url}lm`, {
        headers: { "If-Modified-Since": EARLIER },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello static route");
    });

    it("should return 304 when If-Modified-Since equals Last-Modified (HEAD)", async () => {
      const res = await fetch(`${imsServer.url}lm`, {
        method: "HEAD",
        headers: { "If-Modified-Since": LM },
      });
      expect(res.status).toBe(304);
      expect(await res.text()).toBe("");
    });

    it("should ignore If-Modified-Since when If-None-Match is present (RFC 9110 §13.1.3)", async () => {
      // If-None-Match takes precedence; a non-matching ETag with a satisfying
      // If-Modified-Since must still return 200.
      const res = await fetch(`${imsServer.url}lm`, {
        headers: {
          "If-None-Match": '"does-not-match"',
          "If-Modified-Since": LM,
        },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello static route");
    });

    it("should return 200 for an unparsable If-Modified-Since date", async () => {
      const res = await fetch(`${imsServer.url}lm`, {
        headers: { "If-Modified-Since": "not a date" },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello static route");
    });

    it("should return 200 when the route has no Last-Modified header", async () => {
      const res = await fetch(`${imsServer.url}no-lm`, {
        headers: { "If-Modified-Since": LATER },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("no last-modified");
    });

    it("should not apply If-Modified-Since to POST requests", async () => {
      const res = await fetch(`${imsServer.url}lm`, {
        method: "POST",
        headers: { "If-Modified-Since": LM },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello static route");
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
