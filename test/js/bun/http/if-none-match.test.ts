import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { serve } from "bun";

describe("StaticRoute - If-None-Match", () => {
  const responseWithEtag = new Response("test response", {
    headers: {
      "Content-Type": "text/plain",
      "ETag": '"abc123"',
    },
  });

  const responseWithWeakEtag = new Response("test response", {
    headers: {
      "Content-Type": "text/plain",
      "ETag": 'W/"abc123"',
    },
  });

  const responseWithoutEtag = new Response("test response", {
    headers: {
      "Content-Type": "text/plain",
    },
  });

  const routes = {
    "/strong-etag": responseWithEtag,
    "/weak-etag": responseWithWeakEtag,
    "/no-etag": responseWithoutEtag,
  };

  let server;
  let handler = mock(() => new Response("fallback"));

  beforeAll(() => {
    server = serve({
      static: routes,
      port: 0,
      fetch: handler,
    });
  });

  afterAll(() => {
    server.stop(true);
  });

  describe("GET with If-None-Match", () => {
    it("returns 304 for matching ETag", async () => {
      const res = await fetch(`${server.url}strong-etag`, {
        headers: {
          "If-None-Match": '"abc123"',
        },
      });
      
      expect(res.status).toBe(304);
      expect(await res.text()).toBe("");
      expect(res.headers.get("ETag")).toBe('"abc123"');
    });

    it("returns 304 for one matching ETag in a list", async () => {
      const res = await fetch(`${server.url}strong-etag`, {
        headers: {
          "If-None-Match": '"xyz", "abc123", "def456"',
        },
      });
      
      expect(res.status).toBe(304);
      expect(await res.text()).toBe("");
    });
    
    it("returns 304 for If-None-Match: *", async () => {
      const res = await fetch(`${server.url}strong-etag`, {
        headers: {
          "If-None-Match": "*",
        },
      });
      
      expect(res.status).toBe(304);
      expect(await res.text()).toBe("");
    });

    it("returns 200 for non-matching ETag", async () => {
      const res = await fetch(`${server.url}strong-etag`, {
        headers: {
          "If-None-Match": '"xyz"',
        },
      });
      
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("test response");
    });
    
    it("returns 200 for resource without ETag", async () => {
      const res = await fetch(`${server.url}no-etag`, {
        headers: {
          "If-None-Match": '"abc123"',
        },
      });
      
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("test response");
    });
    
    it("handles weak/strong ETag matching (weak matching semantics)", async () => {
      // Weak ETag W/"abc123" should match strong ETag "abc123"
      const res1 = await fetch(`${server.url}strong-etag`, {
        headers: {
          "If-None-Match": 'W/"abc123"',
        },
      });
      
      expect(res1.status).toBe(304);
      
      // Strong ETag "abc123" should match weak ETag W/"abc123" 
      const res2 = await fetch(`${server.url}weak-etag`, {
        headers: {
          "If-None-Match": '"abc123"',
        },
      });
      
      expect(res2.status).toBe(304);
    });
    
    it("ignores invalid If-None-Match header syntax", async () => {
      const res = await fetch(`${server.url}strong-etag`, {
        headers: {
          "If-None-Match": "abc123", // Missing quotes
        },
      });
      
      // Invalid syntax should be ignored, resulting in 200 OK
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("test response");
    });
    
    it("ignores If-None-Match on non-GET/HEAD methods", async () => {
      // Will result in 405 Method Not Allowed since StaticRoute only supports GET/HEAD
      const res = await fetch(`${server.url}strong-etag`, {
        method: "POST",
        headers: {
          "If-None-Match": '"abc123"',
        },
      });
      
      // Should be 405 Method Not Allowed
      expect(res.status).toBe(405);
      
      // Point is it shouldn't be 304
      expect(res.status).not.toBe(304);
    });
  });
  
  describe("HEAD with If-None-Match", () => {
    it("returns 304 for matching ETag", async () => {
      const res = await fetch(`${server.url}strong-etag`, {
        method: "HEAD",
        headers: {
          "If-None-Match": '"abc123"',
        },
      });
      
      expect(res.status).toBe(304);
      expect(await res.text()).toBe("");
      expect(res.headers.get("ETag")).toBe('"abc123"');
    });
    
    it("returns 200 for non-matching ETag", async () => {
      const res = await fetch(`${server.url}strong-etag`, {
        method: "HEAD",
        headers: {
          "If-None-Match": '"xyz"',
        },
      });
      
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("");
      expect(res.headers.get("Content-Length")).toBe("13"); // "test response" length
    });
  });
});