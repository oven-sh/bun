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

  // fetch() owns the Connection header: a caller-supplied value is never
  // forwarded verbatim (it could name arbitrary headers for an RFC 9110
  // §7.6.1 hop to strip). `close` still disables keep-alive on the client
  // side; anything else falls back to the default `keep-alive`.
  test.each([
    ["close", undefined],
    ["keep-alive", "keep-alive"],
    ["upgrade", "keep-alive"],
    ["Upgrade", "keep-alive"],
    ["x-forwarded-for", "keep-alive"],
  ] as const)("Connection: %s is not forwarded verbatim", async (inputValue, expected) => {
    const headers = await captureHeadersFromRequest({
      headers: { Connection: inputValue },
    });
    expect(headers.connection).toBe(expected);
  });

  it("should default to keep-alive when no Connection header provided", async () => {
    const headers = await captureHeadersFromRequest({});
    expect(headers.connection).toBe("keep-alive");
  });

  it("drops Connection while preserving other user headers", async () => {
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

    expect(headers.connection).toBeUndefined();
    expect(headers.accept).toBe("application/json");
    expect(headers["x-test-header"]).toBe("test-value");
  });
});
