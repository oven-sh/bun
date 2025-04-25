import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { serve } from "bun";

describe("StaticRoute - Range", () => {
  const testContent = "0123456789"; // 10 characters
  
  // Create function to generate fresh responses for each test
  function createResponses() {
    return {
      "/test": new Response(testContent, {
        headers: {
          "Content-Type": "text/plain",
        },
      }),
      
      "/withEtag": new Response(testContent, {
        headers: {
          "Content-Type": "text/plain",
          "ETag": '"abc123"',
        },
      }),
      
      "/empty": new Response("", {
        headers: {
          "Content-Type": "text/plain",
        },
      }),
    };
  }

  let server;
  let handler = mock(() => new Response("fallback"));

  beforeAll(() => {
    // Create a server with static routes to test the actual StaticRoute implementation
    server = serve({
      port: 0,
      static: createResponses(),
      fetch: handler,
    });
  });

  afterAll(() => {
    server.stop(true);
  });

  describe("GET with Range header", () => {
    it("returns partial content for valid range", async () => {
      const res = await fetch(`${server.url}test`, {
        headers: {
          "Range": "bytes=0-4",
        },
      });
      
      // Test assertions
      expect(res.status).toBe(206);
      expect(await res.text()).toBe("01234");
      
      // Verify required headers
      expect(res.headers.get("Content-Length")).toBe("5");
      expect(res.headers.get("Content-Range")).toBe("bytes 0-4/10");
      expect(res.headers.get("Accept-Ranges")).toBe("bytes");
      
      // RFC 9110 requires these headers if they would have been in a 200 OK response
      expect(res.headers.has("Content-Type")).toBe(true);
    });
    
    it("supports multiple ranges with multipart/byteranges response", async () => {
      const res = await fetch(`${server.url}test`, {
        headers: {
          "Range": "bytes=0-2, 5-7",
        },
      });
      
      // Test assertions
      expect(res.status).toBe(206);
      
      // For multipart responses, the Content-Type should be multipart/byteranges
      const contentType = res.headers.get("Content-Type");
      expect(contentType?.startsWith("multipart/byteranges; boundary=")).toBe(true);
      
      // Get the boundary from the Content-Type header
      const boundaryMatch = contentType?.match(/boundary=([^;]+)/);
      expect(boundaryMatch).not.toBeNull();
      
      // Parse and verify the multipart response
      const body = await res.text();
      
      // Verify multipart structure contains both ranges
      expect(body).toContain("Content-Range: bytes 0-2/10");
      expect(body).toContain("Content-Range: bytes 5-7/10");
      
      // Verify actual content is present
      expect(body).toContain("012");
      expect(body).toContain("567");
    });

    it("returns partial content for suffix range", async () => {
      const res = await fetch(`${server.url}test`, {
        headers: {
          "Range": "bytes=-3",
        },
      });
      
      expect(res.status).toBe(206);
      expect(await res.text()).toBe("789");
      expect(res.headers.get("Content-Length")).toBe("3");
      expect(res.headers.get("Content-Range")).toBe("bytes 7-9/10");
    });

    it("returns partial content for open-ended range", async () => {
      const res = await fetch(`${server.url}test`, {
        headers: {
          "Range": "bytes=7-",
        },
      });
      
      expect(res.status).toBe(206);
      expect(await res.text()).toBe("789");
      expect(res.headers.get("Content-Length")).toBe("3");
      expect(res.headers.get("Content-Range")).toBe("bytes 7-9/10");
    });

    it("returns 416 for unsatisfiable range", async () => {
      const res = await fetch(`${server.url}test`, {
        headers: {
          "Range": "bytes=10-20",
        },
      });
      
      expect(res.status).toBe(416);
      expect(res.headers.get("Content-Range")).toBe("bytes */10");
      expect(await res.text()).toBe("");
    });

    it("returns 200 for invalid range syntax", async () => {
      const res = await fetch(`${server.url}test`, {
        headers: {
          "Range": "bytes=5-2", // end < start
        },
      });
      
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(testContent);
      // Verify Accept-Ranges header is present in 200 OK response
      expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    });

    it("returns 200 for unsupported range unit", async () => {
      const res = await fetch(`${server.url}test`, {
        headers: {
          "Range": "pages=1-2", // Not 'bytes'
        },
      });
      
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(testContent);
    });

    it("correctly handles single byte ranges", async () => {
      const res = await fetch(`${server.url}test`, {
        headers: {
          "Range": "bytes=4-4",
        },
      });
      
      expect(res.status).toBe(206);
      expect(await res.text()).toBe("4");
      expect(res.headers.get("Content-Length")).toBe("1");
      expect(res.headers.get("Content-Range")).toBe("bytes 4-4/10");
    });
    
    it("handles exact boundary ranges", async () => {
      const res = await fetch(`${server.url}test`, {
        headers: {
          "Range": "bytes=0-9", // Full content range (0-9 is all 10 bytes)
        },
      });
      
      expect(res.status).toBe(206);
      expect(await res.text()).toBe(testContent);
      expect(res.headers.get("Content-Length")).toBe("10");
      expect(res.headers.get("Content-Range")).toBe("bytes 0-9/10");
    });
    
    it("handles last byte range", async () => {
      const res = await fetch(`${server.url}test`, {
        headers: {
          "Range": "bytes=9-9", // Just the last byte
        },
      });
      
      expect(res.status).toBe(206);
      expect(await res.text()).toBe("9");
      expect(res.headers.get("Content-Length")).toBe("1");
      expect(res.headers.get("Content-Range")).toBe("bytes 9-9/10");
    });

    it("handles empty resources properly", async () => {
      const res = await fetch(`${server.url}empty`, {
        headers: {
          "Range": "bytes=0-10",
        },
      });
      
      // For a 0-byte resource, any range is unsatisfiable
      expect(res.status).toBe(416);
      expect(res.headers.get("Content-Range")).toBe("bytes */0");
    });
  });

  describe("Interaction with conditional requests", () => {
    it("ignores Range when If-None-Match matches", async () => {
      const res = await fetch(`${server.url}withEtag`, {
        headers: {
          "Range": "bytes=0-4",
          "If-None-Match": '"abc123"',
        },
      });
      
      // If-None-Match has priority over Range
      expect(res.status).toBe(304);
      expect(await res.text()).toBe("");
    });

    it("processes Range when If-None-Match doesn't match", async () => {
      const res = await fetch(`${server.url}withEtag`, {
        headers: {
          "Range": "bytes=0-4",
          "If-None-Match": '"xyz"',
        },
      });
      
      expect(res.status).toBe(206);
      expect(await res.text()).toBe("01234");
    });
    
    it("ignores invalid If-None-Match header syntax", async () => {
      const res = await fetch(`${server.url}withEtag`, {
        headers: {
          "Range": "bytes=0-4",
          "If-None-Match": "abc123", // Missing quotes
        },
      });
      
      // Invalid If-None-Match should be ignored, so Range is processed
      expect(res.status).toBe(206);
      expect(await res.text()).toBe("01234");
    });
    
    it("processes Range when If-Range ETag matches resource ETag", async () => {
      const res = await fetch(`${server.url}withEtag`, {
        headers: {
          "Range": "bytes=0-4",
          "If-Range": '"abc123"',
        },
      });
      
      // If-Range matches, so Range request is processed
      expect(res.status).toBe(206);
      expect(await res.text()).toBe("01234");
    });
    
    it("ignores Range when If-Range ETag doesn't match resource ETag", async () => {
      const res = await fetch(`${server.url}withEtag`, {
        headers: {
          "Range": "bytes=0-4",
          "If-Range": '"mismatch"',
        },
      });
      
      // If-Range doesn't match, so full response is sent
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(testContent);
    });
  });

  describe("Method compatibility", () => {
    it("ignores Range on HEAD requests", async () => {
      const res = await fetch(`${server.url}test`, {
        method: "HEAD",
        headers: {
          "Range": "bytes=0-4",
        },
      });
      
      // Range should be ignored on HEAD requests
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Length")).toBe("10"); // full length
    });
    
    it("ignores Range on non-GET/HEAD methods", async () => {
      // StaticRoute only handles GET/HEAD so we should get 405 Method Not Allowed
      // But the test verifies that Range doesn't get processed for these methods
      const res = await fetch(`${server.url}test`, {
        method: "POST",
        headers: {
          "Range": "bytes=0-4",
        },
      });
      
      // Since we're using a static route, we should get 405 Method Not Allowed
      expect(res.status).toBe(405);
      
      // The key point is that it shouldn't be a 206
      expect(res.status).not.toBe(206);
    });
  });
});