import { serve } from "bun";
import { describe, expect, it, test } from "bun:test";

describe("fetch Connection header", () => {
  // Helper function to capture headers from a request
  const captureHeadersFromRequest = async (fetchOptions: RequestInit): Promise<Record<string, string>> => {
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
      const url = `http://localhost:${tempPort}/test`;

      // Make the request to temp server
      fetch(url, fetchOptions)
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
    });
  };

  test.each([
    ["close", "close"],
    ["keep-alive", "keep-alive"],
    ["upgrade", "upgrade"],
    ["Upgrade", "Upgrade"], // Test case preservation
  ])("should respect Connection: %s header", async (inputValue, expectedValue) => {
    const headers = await captureHeadersFromRequest({
      headers: { Connection: inputValue },
    });

    expect(headers.connection).toBe(expectedValue);
  });

  test.each([
    ["connection", "close"],
    ["Connection", "close"],
    ["CONNECTION", "close"],
  ])("should respect case-insensitive header name: %s", async (headerName, expectedValue) => {
    const headers = await captureHeadersFromRequest({
      headers: { [headerName]: expectedValue },
    });

    expect(headers.connection).toBe(expectedValue);
  });

  it("should respect Connection header in Request object", async () => {
    const headers = await captureHeadersFromRequest({
      headers: { Connection: "close" },
    });
    expect(headers.connection).toBe("close");
  });

  it("should default to keep-alive when no Connection header provided", async () => {
    const headers = await captureHeadersFromRequest({});
    expect(headers.connection).toBe("keep-alive");
  });

  it("should handle multiple headers including Connection", async () => {
    const headers = await captureHeadersFromRequest({
      headers: {
        "accept": "application/json",
        "accept-encoding": "gzip, deflate",
        "accept-language": "en-US",
        "connection": "close",
        "user-agent": "test-agent",
        "x-test-header": "test-value",
      },
    });

    expect(headers.connection).toBe("close");
    expect(headers.accept).toBe("application/json");
    expect(headers["x-test-header"]).toBe("test-value");
  });
});
