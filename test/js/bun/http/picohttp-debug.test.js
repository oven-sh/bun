import { describe, expect, it } from "bun:test";

// Debug tests for PicoHTTP parser issues
describe("PicoHTTP parser debug tests", () => {
  // Test URL fragments
  it("debug URL fragments", async () => {
    // Create a server that logs request details
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        console.log("Server received request:", {
          method: req.method,
          url: req.url,
          pathname: url.pathname,
          hash: url.hash,
          httpVersion: req.httpVersion,
        });
        
        return new Response(JSON.stringify({
          method: req.method,
          url: req.url,
          pathname: url.pathname,
          hash: url.hash,
          httpVersion: req.httpVersion,
        }));
      },
    });

    try {
      const response = await fetch(`http://localhost:${server.port}/fragment-test#section1`);
      const data = await response.json();
      
      console.log("Client received response:", data);
      
      expect(data.pathname).toBe("/fragment-test");
      expect(data.hash).toBe("#section1");
      expect(data.httpVersion).toBe("1.1");
    } finally {
      server.stop();
    }
  });

  // Test custom HTTP methods
  it("debug custom HTTP methods", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        console.log("Server received request with method:", req.method);
        
        return new Response(JSON.stringify({
          method: req.method,
        }));
      },
    });

    try {
      const response = await fetch(`http://localhost:${server.port}/custom-method`, {
        method: "CUSTOM",
      });
      
      const data = await response.json();
      console.log("Client received response for custom method:", data);
      
      expect(data.method).toBe("CUSTOM");
    } finally {
      server.stop();
    }
  });
});