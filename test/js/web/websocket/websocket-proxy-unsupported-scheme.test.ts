import { describe, expect, test } from "bun:test";

// new WebSocket(url, { proxy: "socks5://..." }) used to accept any URL scheme
// and silently send an HTTP CONNECT request to whatever was listening, surfacing
// only a misleading "Connection ended" error. fetch() with the same proxy option
// rejects up front with UnsupportedProxyProtocol; WebSocket now matches that
// contract and refuses non-http/https proxy schemes at construction time.

describe("WebSocket proxy scheme validation", () => {
  test.each(["socks5", "socks4", "socks5h", "ftp", "ws", "gopher"])(
    "rejects unsupported proxy protocol %s://",
    scheme => {
      expect(() => {
        new WebSocket("ws://example.com", {
          proxy: `${scheme}://127.0.0.1:1`,
        });
      }).toThrow(
        expect.objectContaining({
          name: "SyntaxError",
          message: expect.stringContaining("Unsupported proxy protocol"),
        }),
      );

      // Same rejection via the { url } form.
      expect(() => {
        new WebSocket("ws://example.com", {
          proxy: { url: `${scheme}://127.0.0.1:1` },
        });
      }).toThrow(/Unsupported proxy protocol/);
    },
  );

  test.each(["http", "https"])("accepts supported proxy protocol %s://", scheme => {
    // This only asserts the constructor accepts the scheme; the connection
    // itself is cancelled immediately.
    const ws = new WebSocket("ws://localhost:1", {
      proxy: `${scheme}://127.0.0.1:1`,
    });
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    ws.close();
  });
});
