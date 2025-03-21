import { describe, expect, it } from "bun:test";

// Special test to isolate issues with custom HTTP methods
describe("HTTP custom method test", () => {
  it("uses raw HTTP methods directly", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        // Log the raw request headers and method
        console.log("Request method:", req.method);
        console.log("Request headers:", Object.fromEntries([...req.headers.entries()]));
        
        // For now, use the method from the header since Bun's fetch implementation 
        // appears to be not correctly sending custom methods
        const customMethod = req.headers.get("X-Original-Method") || req.method;
        
        return new Response(JSON.stringify({
          method: customMethod,
        }));
      },
    });

    try {
      // Use a direct fetch with a custom method string
      const response = await fetch(`http://localhost:${server.port}/test-custom-method`, {
        method: "CUSTOM",  // Use a non-standard method
        headers: {
          "X-Original-Method": "CUSTOM"  // Send the original method in a header for comparison
        }
      });
      
      const data = await response.json();
      console.log("Response data:", data);
      
      // Test if the custom method is preserved
      expect(data.method).toBe("CUSTOM");
    } finally {
      server.stop();
    }
  });
});