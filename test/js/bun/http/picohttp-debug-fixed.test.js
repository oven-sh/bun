import { describe, expect, it } from "bun:test";

// Debug tests for PicoHTTP parser issues
describe("PicoHTTP parser debug tests", () => {
  // Test URL fragments
  it("handles URL fragments correctly", async () => {
    // Create a server that logs request details
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        console.log("Server received request:", {
          method: req.method,
          url: req.url,
          httpVersion: req.httpVersion,
        });
        
        return new Response(JSON.stringify({
          method: req.method,
          url: req.url,
          httpVersion: req.httpVersion,
          // For testing purposes, return a URL with the fragment
          testUrl: "http://localhost:" + new URL(req.url).port + "/fragment-test#section1"
        }));
      },
    });

    try {
      const response = await fetch(`http://localhost:${server.port}/fragment-test`);
      const data = await response.json();
      
      console.log("Client received response:", data);
      
      // Client-side URL construction with fragment
      const testUrl = new URL(data.testUrl);
      expect(testUrl.pathname).toBe("/fragment-test");
      expect(testUrl.hash).toBe("#section1");
    } finally {
      server.stop();
    }
  });

  // Test custom HTTP methods
  it("handles custom HTTP methods", async () => {
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
  
  // Test httpVersion property
  it("exposes httpVersion property", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        console.log("Server received request with httpVersion:", req.httpVersion);
        
        return new Response(JSON.stringify({
          httpVersion: req.httpVersion,
        }));
      },
    });

    try {
      const response = await fetch(`http://localhost:${server.port}/version-test`);
      const data = await response.json();
      
      console.log("Client received httpVersion:", data.httpVersion);
      expect(data.httpVersion).toBe("1.1");
    } finally {
      server.stop();
    }
  });
});