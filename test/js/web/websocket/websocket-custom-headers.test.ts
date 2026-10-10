import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, nodeExe } from "harness";
import * as path from "node:path";

let servers: Subprocess[] = [];
let clients: WebSocket[] = [];

function cleanUp() {
  for (const client of clients) {
    client.terminate?.();
  }
  for (const server of servers) {
    server.kill();
  }
  clients = [];
  servers = [];
}

beforeEach(cleanUp);
afterEach(cleanUp);

async function createHeaderEchoServer(): Promise<URL> {
  const pathname = path.join(import.meta.dir, "./websocket-server-echo-headers-simple.mjs");
  const { promise, resolve, reject } = Promise.withResolvers<URL>();
  const server = spawn({
    cmd: [nodeExe() ?? bunExe(), pathname],
    cwd: import.meta.dir,
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
    serialization: "json",
    ipc(message) {
      const url = message?.href;
      if (url) {
        try {
          resolve(new URL(url));
        } catch (error) {
          reject(error);
        }
      }
    },
  });

  servers.push(server);
  return await promise;
}

describe("WebSocket custom headers", () => {
  it("should send custom Host header", async () => {
    const url = await createHeaderEchoServer();
    const { promise, resolve, reject } = Promise.withResolvers<any>();

    const ws = new WebSocket(url.href, {
      headers: {
        "Host": "custom-host.example.com:8080",
      },
    });
    clients.push(ws);

    ws.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "headers") {
          resolve(data.headers);
        }
      } catch (e) {
        reject(e);
      }
    };

    ws.onerror = reject;

    const headers = await promise;
    expect(headers.host).toBe("custom-host.example.com:8080");
    ws.close();
  });

  it("should reject invalid Sec-WebSocket-Key and generate a valid one", async () => {
    const url = await createHeaderEchoServer();
    const { promise, resolve, reject } = Promise.withResolvers<any>();

    // Invalid keys that should be rejected
    const invalidKeys = [
      "not-base64!@#", // Invalid base64
      "dG9vc2hvcnQ=", // Valid base64 but decodes to 8 bytes, not 16
      btoa("toolongkeytoolongkey"), // Valid base64 but decodes to >16 bytes
    ];

    for (const invalidKey of invalidKeys) {
      const ws = new WebSocket(url.href, {
        headers: {
          "Sec-WebSocket-Key": invalidKey,
        },
      });
      clients.push(ws);

      const headerPromise = new Promise<any>((res, rej) => {
        ws.onmessage = event => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "headers") {
              res(data.headers);
            }
          } catch (e) {
            rej(e);
          }
        };
        ws.onerror = rej;
      });

      const headers = await headerPromise;
      // Should have generated a new valid key instead of using the invalid one
      expect(headers["sec-websocket-key"]).not.toBe(invalidKey);
      // The generated key should be valid base64 that decodes to 16 bytes
      const keyBytes = atob(headers["sec-websocket-key"]);
      expect(keyBytes.length).toBe(16);
      ws.close();
    }
  });

  it("should send custom Sec-WebSocket-Key header", async () => {
    const url = await createHeaderEchoServer();
    const { promise, resolve, reject } = Promise.withResolvers<any>();

    // Generate a valid base64-encoded 16-byte key
    const keyBytes = new Uint8Array(16);
    crypto.getRandomValues(keyBytes);
    const customKey = btoa(String.fromCharCode(...keyBytes));

    const ws = new WebSocket(url.href, {
      headers: {
        "Sec-WebSocket-Key": customKey,
      },
    });
    clients.push(ws);

    ws.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "headers") {
          resolve(data.headers);
        }
      } catch (e) {
        reject(e);
      }
    };

    ws.onerror = reject;

    const headers = await promise;
    expect(headers["sec-websocket-key"]).toBe(customKey);
    ws.close();
  });

  it("should send custom Sec-WebSocket-Protocol header", async () => {
    const url = await createHeaderEchoServer();
    const { promise, resolve, reject } = Promise.withResolvers<any>();

    const ws = new WebSocket(url.href, {
      headers: {
        "Sec-WebSocket-Protocol": "custom-protocol, another-protocol",
      },
    });
    clients.push(ws);

    ws.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "headers") {
          resolve(data.headers);
        }
      } catch (e) {
        reject(e);
      }
    };

    ws.onerror = reject;

    const headers = await promise;
    expect(headers["sec-websocket-protocol"]).toBe("custom-protocol, another-protocol");
    ws.close();
  });

  it("should override protocol header when both protocols array and header are provided", async () => {
    const url = await createHeaderEchoServer();
    const { promise, resolve, reject } = Promise.withResolvers<any>();

    const ws = new WebSocket(url.href, {
      protocols: ["proto1", "proto2"],
      headers: {
        "Sec-WebSocket-Protocol": "custom-protocol",
      },
    });
    clients.push(ws);

    ws.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "headers") {
          resolve(data.headers);
        }
      } catch (e) {
        reject(e);
      }
    };

    ws.onerror = reject;

    const headers = await promise;
    // The custom header should override the protocols array
    expect(headers["sec-websocket-protocol"]).toBe("custom-protocol");
    ws.close();
  });

  it("should send multiple custom headers", async () => {
    const url = await createHeaderEchoServer();
    const { promise, resolve, reject } = Promise.withResolvers<any>();

    const keyBytes = new Uint8Array(16);
    crypto.getRandomValues(keyBytes);
    const customKey = btoa(String.fromCharCode(...keyBytes));

    const ws = new WebSocket(url.href, {
      headers: {
        "Host": "multi-header.example.com",
        "Sec-WebSocket-Key": customKey,
        "Sec-WebSocket-Protocol": "multi-proto",
        "X-Custom-Header": "custom-value",
      },
    });
    clients.push(ws);

    ws.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "headers") {
          resolve(data.headers);
        }
      } catch (e) {
        reject(e);
      }
    };

    ws.onerror = reject;

    const headers = await promise;
    expect(headers.host).toBe("multi-header.example.com");
    expect(headers["sec-websocket-key"]).toBe(customKey);
    expect(headers["sec-websocket-protocol"]).toBe("multi-proto");
    expect(headers["x-custom-header"]).toBe("custom-value");
    ws.close();
  });

  it("should reject CRLF injection in header values", async () => {
    const url = await createHeaderEchoServer();

    // Test with CRLF injection attempt - this should be rejected
    expect(() => {
      new WebSocket(url.href, {
        headers: {
          "X-Test-Header": "value\r\nInjected-Header: bad",
        },
      });
    }).toThrow("Header 'X-Test-Header' has invalid value");
  });

  it("should allow headers with special but valid characters", async () => {
    const url = await createHeaderEchoServer();
    const { promise, resolve, reject } = Promise.withResolvers<any>();

    // These should be allowed according to HTTP spec
    const ws = new WebSocket(url.href, {
      headers: {
        "X-Special-Chars": "value with spaces and !@#$%^&*()_+-=[]{}|;:',.<>?/`~",
      },
    });
    clients.push(ws);

    ws.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "headers") {
          resolve(data.headers);
        }
      } catch (e) {
        reject(e);
      }
    };

    ws.onerror = reject;

    const headers = await promise;
    expect(headers["x-special-chars"]).toContain("value with spaces");
    ws.close();
  });

  it("should handle empty header values correctly", async () => {
    const url = await createHeaderEchoServer();
    const { promise, resolve, reject } = Promise.withResolvers<any>();

    const ws = new WebSocket(url.href, {
      headers: {
        "X-Empty-Header": "",
        "X-Whitespace-Header": "  ",
      },
    });
    clients.push(ws);

    ws.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "headers") {
          resolve(data.headers);
        }
      } catch (e) {
        reject(e);
      }
    };

    ws.onerror = reject;

    const headers = await promise;

    // Check X-Empty-Header: should either be filtered out or have empty value
    if ("x-empty-header" in headers) {
      expect(headers["x-empty-header"]).toBe("");
    } else {
      // Header was filtered out, which is also acceptable
      expect(headers["x-empty-header"]).toBeUndefined();
    }

    // Check X-Whitespace-Header: should either be filtered out, trimmed to empty, or have the exact whitespace
    if ("x-whitespace-header" in headers) {
      // Whitespace might be preserved or trimmed - both are acceptable
      expect(["", "  "]).toContain(headers["x-whitespace-header"]);
    } else {
      // Header was filtered out, which is also acceptable
      expect(headers["x-whitespace-header"]).toBeUndefined();
    }

    ws.close();
  });

  it("should not override system headers like Connection or Upgrade", async () => {
    const url = await createHeaderEchoServer();
    const { promise, resolve, reject } = Promise.withResolvers<any>();

    const ws = new WebSocket(url.href, {
      headers: {
        "Connection": "close", // Should be ignored
        "Upgrade": "http/2.0", // Should be ignored
        "Sec-WebSocket-Version": "8", // Should be ignored
        "X-Custom": "allowed",
      },
    });
    clients.push(ws);

    ws.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "headers") {
          resolve(data.headers);
        }
      } catch (e) {
        reject(e);
      }
    };

    ws.onerror = reject;

    const headers = await promise;
    // These should remain as WebSocket requires
    expect(headers.connection.toLowerCase()).toContain("upgrade");
    expect(headers.upgrade.toLowerCase()).toBe("websocket");
    expect(headers["sec-websocket-version"]).toBe("13");
    expect(headers["x-custom"]).toBe("allowed");
    ws.close();
  });
});

describe("WebSocket options are read through the prototype chain", () => {
  // Upgrades every request and echoes the upgrade request headers as the first message.
  function headerEchoServer() {
    return Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req, { data: req.headers.toJSON() })) return;
        return new Response("not a websocket", { status: 400 });
      },
      websocket: {
        open(ws) {
          ws.send(JSON.stringify(ws.data));
        },
        message() {},
      },
    });
  }

  async function upgradeHeaders(url: string, options: any): Promise<Record<string, string>> {
    const { promise, resolve, reject } = Promise.withResolvers<Record<string, string>>();
    const ws = new WebSocket(url, options);
    clients.push(ws);
    ws.onmessage = event => resolve(JSON.parse(event.data));
    ws.onerror = () => reject(new Error("websocket failed"));
    ws.onclose = event => reject(new Error(`closed: ${event.code} ${event.reason}`));
    const headers = await promise;
    ws.onclose = null;
    ws.close();
    return headers;
  }

  it("honors headers and protocols inherited from a prototype", async () => {
    using server = headerEchoServer();
    const defaults = { headers: { "X-Auth": "secret", "Authorization": "Bearer T" }, protocols: ["chat"] };
    const headers = await upgradeHeaders(server.url.href, Object.create(defaults));
    expect(headers).toMatchObject({
      "x-auth": "secret",
      "authorization": "Bearer T",
      "sec-websocket-protocol": "chat",
    });
  });

  it("honors headers and protocols from prototype getters", async () => {
    using server = headerEchoServer();
    class Config {
      get headers() {
        return { "X-From-Getter": "1" };
      }
      get protocols() {
        return ["getter-proto"];
      }
    }
    const headers = await upgradeHeaders(server.url.href, new Config());
    expect(headers).toMatchObject({
      "x-from-getter": "1",
      "sec-websocket-protocol": "getter-proto",
    });
  });

  it("honors an inherited perMessageDeflate: false and offers the extension when omitted", async () => {
    using server = headerEchoServer();
    const disabled = await upgradeHeaders(server.url.href, Object.create({ perMessageDeflate: false }));
    expect(disabled["sec-websocket-extensions"]).toBeUndefined();
    const enabled = await upgradeHeaders(server.url.href, {});
    expect(enabled["sec-websocket-extensions"]).toContain("permessage-deflate");
  });

  it("accepts a single protocol string via protocols or protocol", async () => {
    using server = headerEchoServer();
    expect((await upgradeHeaders(server.url.href, { protocols: "chat" }))["sec-websocket-protocol"]).toBe("chat");
    expect((await upgradeHeaders(server.url.href, { protocol: "chat" }))["sec-websocket-protocol"]).toBe("chat");
  });

  it("ignores options placed on Object.prototype", async () => {
    using server = headerEchoServer();
    (Object.prototype as any).headers = { "X-Polluted": "1" };
    (Object.prototype as any).protocols = ["polluted"];
    (Object.prototype as any).perMessageDeflate = false;
    let headers: Record<string, string>;
    try {
      headers = await upgradeHeaders(server.url.href, {});
    } finally {
      delete (Object.prototype as any).headers;
      delete (Object.prototype as any).protocols;
      delete (Object.prototype as any).perMessageDeflate;
    }
    expect(headers["x-polluted"]).toBeUndefined();
    expect(headers["sec-websocket-protocol"]).toBeUndefined();
    expect(headers["sec-websocket-extensions"]).toContain("permessage-deflate");
  });
});
