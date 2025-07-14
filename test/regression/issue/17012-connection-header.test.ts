import { serve, type Server } from "bun";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";

// Regression test for issue #17012
// Connection header should be respected in fetch() requests
describe("Issue #17012: Connection header ignored in fetch", () => {
  let server: Server;
  let port: number;

  // Helper function to capture headers from a request
  const makeRequestAndCaptureHeaders = async (request: Request | string, options?: RequestInit): Promise<Record<string, string>> => {
    return new Promise((resolve, reject) => {
      // Create a temporary server to capture headers
      const tempServer = serve({
        port: 0,
        fetch(req) {
          const capturedHeaders: Record<string, string> = {};
          for (const [name, value] of req.headers.entries()) {
            capturedHeaders[name.toLowerCase()] = value;
          }
          tempServer.stop();
          resolve(capturedHeaders);
          return new Response("OK");
        },
      });
      
      const tempPort = tempServer.port;
      
      // Make the request to temp server
      if (typeof request === "string") {
        // URL string case
        const url = `http://localhost:${tempPort}/`;
        fetch(url, options)
          .then(response => {
            if (response.status !== 200) {
              tempServer.stop();
              reject(new Error(`Expected status 200, got ${response.status}`));
            }
          })
          .catch(error => {
            tempServer.stop();
            reject(error);
          });
      } else {
        // Request object case - extract headers and make new request to temp server  
        const headers: Record<string, string> = {};
        for (const [name, value] of request.headers.entries()) {
          headers[name] = value;
        }
        
        const url = `http://localhost:${tempPort}/`;
        fetch(url, { headers })
          .then(response => {
            if (response.status !== 200) {
              tempServer.stop();
              reject(new Error(`Expected status 200, got ${response.status}`));
            }
          })
          .catch(error => {
            tempServer.stop();
            reject(error);
          });
      }
    });
  };

  beforeAll(async () => {
    server = serve({
      port: 0,
      fetch() {
        return new Response("OK");
      },
    });
    port = server.port;
  });

  afterAll(() => {
    server?.stop();
  });

  it("should send Connection: close when explicitly set in Request headers", async () => {
    // Reproduce the exact scenario from the issue
    const request = new Request(`http://localhost:${port}/`, {
      headers: {
        'accept':          '-',
        'accept-encoding': '-',
        'accept-language': '-',
        'connection':      'close',                     // This should NOT be ignored
        'user-agent':      '-',
        'x-version-node':  process.versions.node,
        'x-version-bun':   process.versions.bun || '',
      }
    });

    const headers = await makeRequestAndCaptureHeaders(request);
    
    // The bug was that 'keep-alive' was always sent instead of 'close'
    expect(headers.connection).toBe("close");
    expect(headers.accept).toBe("-");
    expect(headers["accept-encoding"]).toBe("-");
    expect(headers["accept-language"]).toBe("-");
    expect(headers["user-agent"]).toBe("-");
  });

  test.each([
    ["keep-alive", "keep-alive"],
    ["close", "close"],
  ])("should send Connection: %s when explicitly set", async (connectionValue, expectedValue) => {
    const request = new Request(`http://localhost:${port}/`, {
      headers: { 'connection': connectionValue }
    });

    const headers = await makeRequestAndCaptureHeaders(request);
    expect(headers.connection).toBe(expectedValue);
  });

  it("should default to keep-alive when Connection header not provided", async () => {
    const headers = await makeRequestAndCaptureHeaders(`http://localhost:${port}/`);
    expect(headers.connection).toBe("keep-alive");
  });
});