import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { serve } from "bun";

describe("Range Header Test", () => {
  const testContent = "0123456789";
  const response = new Response(testContent, {
    headers: {
      "Content-Type": "text/plain",
      "ETag": '"abc123"',
    },
  });
  
  let server;

  beforeAll(() => {
    server = serve({
      port: 0,
      static: {
        "/test": response,
      },
    });
    
    console.log("Server running at", server.url);
  });

  afterAll(() => {
    server.stop(true);
  });

  it("should correctly handle Range header", async () => {
    const res = await fetch(`${server.url}test`, {
      headers: {
        "Range": "bytes=0-4",
      },
    });
    
    console.log("Response status:", res.status);
    console.log("Response headers:", Object.fromEntries(res.headers.entries()));
    console.log("Response body:", await res.text());
    
    // This should be 206 if Range is implemented correctly
    expect(res.status).toBe(206);
  });
});