import { describe, expect, test } from "bun:test";
import net from "net";

// CVE-2020-8287 style request smuggling tests
// These tests ensure Bun's HTTP server properly validates Transfer-Encoding headers
// to prevent HTTP request smuggling attacks

test("rejects multiple Transfer-Encoding headers with chunked", async () => {
  // Multiple Transfer-Encoding headers with chunked can cause different
  // interpretations between proxy and backend
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      // Should never reach here
      return new Response("OK");
    },
  });

  const client = net.connect(server.port, "127.0.0.1");

  const maliciousRequest = [
    "POST / HTTP/1.1",
    "Host: localhost",
    "Transfer-Encoding: chunked",
    "Transfer-Encoding: identity",
    "",
    "1",
    "A",
    "0",
    "",
    "",
  ].join("\r\n");

  await new Promise<void>((resolve, reject) => {
    client.on("error", reject);
    client.on("data", data => {
      const response = data.toString();
      // Should get 400 Bad Request
      expect(response).toContain("HTTP/1.1 400");
      client.end();
      resolve();
    });
    client.write(maliciousRequest);
  });
});

test("rejects Transfer-Encoding with chunked not last", async () => {
  // If chunked is not the last encoding, it's invalid per RFC 9112
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("OK");
    },
  });

  const client = net.connect(server.port, "127.0.0.1");

  const maliciousRequest = [
    "POST / HTTP/1.1",
    "Host: localhost",
    "Transfer-Encoding: chunked, gzip",
    "",
    "1",
    "A",
    "0",
    "",
    "",
  ].join("\r\n");

  await new Promise<void>((resolve, reject) => {
    client.on("error", reject);
    client.on("data", data => {
      const response = data.toString();
      expect(response).toContain("HTTP/1.1 400");
      client.end();
      resolve();
    });
    client.write(maliciousRequest);
  });
});

test("rejects duplicate chunked in Transfer-Encoding", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("OK");
    },
  });

  const client = net.connect(server.port, "127.0.0.1");

  const maliciousRequest = [
    "POST / HTTP/1.1",
    "Host: localhost",
    "Transfer-Encoding: chunked",
    "Transfer-Encoding: chunked",
    "",
    "1",
    "A",
    "0",
    "",
    "",
  ].join("\r\n");

  await new Promise<void>((resolve, reject) => {
    client.on("error", reject);
    client.on("data", data => {
      const response = data.toString();
      expect(response).toContain("HTTP/1.1 400");
      client.end();
      resolve();
    });
    client.write(maliciousRequest);
  });
});

test("rejects Transfer-Encoding + Content-Length", async () => {
  // Having both headers is a smuggling red flag per RFC 9112
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("OK");
    },
  });

  const client = net.connect(server.port, "127.0.0.1");

  const maliciousRequest = [
    "POST / HTTP/1.1",
    "Host: localhost",
    "Transfer-Encoding: chunked",
    "Content-Length: 6",
    "",
    "1",
    "A",
    "0",
    "",
    "",
  ].join("\r\n");

  await new Promise<void>((resolve, reject) => {
    client.on("error", reject);
    client.on("data", data => {
      const response = data.toString();
      expect(response).toContain("HTTP/1.1 400");
      client.end();
      resolve();
    });
    client.write(maliciousRequest);
  });
});

test("accepts valid Transfer-Encoding: chunked", async () => {
  let receivedBody = "";

  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      receivedBody = await req.text();
      return new Response("Success");
    },
  });

  const client = net.connect(server.port, "127.0.0.1");

  const validRequest = [
    "POST / HTTP/1.1",
    "Host: localhost",
    "Transfer-Encoding: chunked",
    "",
    "5",
    "Hello",
    "0",
    "",
    "",
  ].join("\r\n");

  await new Promise<void>((resolve, reject) => {
    client.on("error", reject);
    client.on("data", data => {
      const response = data.toString();
      expect(response).toContain("HTTP/1.1 200");
      expect(receivedBody).toBe("Hello");
      client.end();
      resolve();
    });
    client.write(validRequest);
  });
});

test("accepts valid Transfer-Encoding: gzip, chunked", async () => {
  // Valid: chunked is last
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("Success");
    },
  });

  const client = net.connect(server.port, "127.0.0.1");

  const validRequest = ["POST / HTTP/1.1", "Host: localhost", "Transfer-Encoding: gzip, chunked", "", "0", "", ""].join(
    "\r\n",
  );

  await new Promise<void>((resolve, reject) => {
    client.on("error", reject);
    client.on("data", data => {
      const response = data.toString();
      expect(response).toContain("HTTP/1.1 200");
      client.end();
      resolve();
    });
    client.write(validRequest);
  });
});

test("accepts Transfer-Encoding with whitespace variations", async () => {
  let didSucceed = false;
  // Should handle tabs and spaces properly
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      didSucceed = true;
      return new Response("Success");
    },
  });

  const client = net.connect(server.port, "127.0.0.1");

  const validRequest = [
    "POST / HTTP/1.1",
    "Host: localhost",
    "Transfer-Encoding: gzip,\tchunked", // tab after comma
    "",
    "0",
    "",
    "",
  ].join("\r\n");

  await new Promise<void>((resolve, reject) => {
    client.on("error", reject);
    client.on("data", data => {
      const response = data.toString();
      expect(response).toContain("HTTP/1.1 200");
      client.end();
      resolve();
    });
    client.write(validRequest);
  });

  expect(didSucceed).toBe(true);
});

test("rejects malformed Transfer-Encoding with chunked-false", async () => {
  let smuggled = false;
  // This was from the original PoC - invalid encoding value
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      smuggled = true;
      return new Response("OK");
    },
  });

  const client = net.connect(server.port, "127.0.0.1");

  const maliciousRequest = [
    "POST / HTTP/1.1",
    "Host: localhost",
    "Transfer-Encoding: chunked",
    "Transfer-Encoding: chunked-false",
    "",
    "1",
    "A",
    "0",
    "",
    "",
  ].join("\r\n");

  await new Promise<void>((resolve, reject) => {
    client.on("error", reject);
    client.on("data", data => {
      const response = data.toString();
      expect(response).toContain("HTTP/1.1 400");
      client.end();
      resolve();
    });
    client.write(maliciousRequest);
  });

  expect(smuggled).toBe(false);
});

test("prevents request smuggling attack", async () => {
  // The actual smuggling attack from the PoC
  let requestCount = 0;
  let capturedUrls: string[] = [];
  let smuggled = false;

  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      requestCount++;
      const url = new URL(req.url);
      capturedUrls.push(url.pathname);

      if (url.pathname === "/bad") {
        // Should never reach here in a secure implementation
        smuggled = true;
        throw new Error("Smuggled request reached handler!");
      }

      return new Response("OK");
    },
  });

  const client = net.connect(server.port, "127.0.0.1");

  // Try to smuggle a GET /bad request
  const smuggleAttempt = [
    "POST / HTTP/1.1",
    "Host: 127.0.0.1",
    "Transfer-Encoding: chunked",
    "Transfer-Encoding: chunked-false",
    "",
    "1",
    "A",
    "0",
    "",
    "GET /bad HTTP/1.1",
    "Host: 127.0.0.1",
    "",
    "",
  ].join("\r\n");

  await new Promise<void>((resolve, reject) => {
    client.on("error", reject);
    client.on("data", data => {
      const response = data.toString();
      // Should get 400 and connection should close
      expect(response).toContain("HTTP/1.1 400");

      // Should only see one request attempt, not two
      expect(requestCount).toBeLessThanOrEqual(1);
      expect(capturedUrls).not.toContain("/bad");

      client.end();
      resolve();
    });
    client.write(smuggleAttempt);
  });

  expect(smuggled).toBe(false);
});

test("handles multiple valid Transfer-Encoding headers", async () => {
  // Multiple headers with non-chunked values should work
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("Success");
    },
  });

  const client = net.connect(server.port, "127.0.0.1");

  const validRequest = [
    "POST / HTTP/1.1",
    "Host: localhost",
    "Transfer-Encoding: gzip",
    "Transfer-Encoding: chunked",
    "",
    "0",
    "",
    "",
  ].join("\r\n");

  await new Promise<void>((resolve, reject) => {
    client.on("error", reject);
    client.on("data", data => {
      const response = data.toString();
      expect(response).toContain("HTTP/1.1 200");
      client.end();
      resolve();
    });
    client.write(validRequest);
  });
});

// Tests for SPILL.TERM technique - invalid chunk terminators
// Reference: https://portswigger.net/research/chunked-coding-converter-abusing-http-to-smuggle-requests
describe("SPILL.TERM - invalid chunk terminators", () => {
  test("rejects chunk with invalid terminator bytes", async () => {
    // This tests the SPILL.TERM technique where an attacker uses invalid
    // chunk terminators (e.g., "XY" instead of "\r\n") to desync parsers.
    let bodyReadSucceeded = false;
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        try {
          await req.text();
          bodyReadSucceeded = true;
        } catch {
          // Expected: body read should fail due to invalid chunk terminator
        }
        return new Response("OK");
      },
    });

    const client = net.connect(server.port, "127.0.0.1");

    // Chunk size 5, but terminator is "XY" instead of "\r\n"
    const maliciousRequest =
      "POST / HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n" +
      "5\r\n" +
      "AAAAAXY" + // 5 bytes "AAAAA" + invalid terminator "XY"
      "0\r\n" +
      "\r\n";

    await new Promise<void>((resolve, reject) => {
      let responseData = "";
      client.on("error", reject);
      client.on("data", data => {
        responseData += data.toString();
      });
      client.on("close", () => {
        expect(responseData).toContain("HTTP/1.1 400");
        expect(bodyReadSucceeded).toBe(false);
        resolve();
      });
      client.write(maliciousRequest);
    });
  });

  test("rejects chunk with CR but wrong second byte", async () => {
    let bodyReadSucceeded = false;
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        try {
          await req.text();
          bodyReadSucceeded = true;
        } catch {
          // Expected: body read should fail due to invalid chunk terminator
        }
        return new Response("OK");
      },
    });

    const client = net.connect(server.port, "127.0.0.1");

    // Chunk size 3, terminator is "\rX" instead of "\r\n"
    const maliciousRequest =
      "POST / HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n" +
      "3\r\n" +
      "ABC\rX" + // 3 bytes "ABC" + invalid terminator "\rX"
      "0\r\n" +
      "\r\n";

    await new Promise<void>((resolve, reject) => {
      let responseData = "";
      client.on("error", reject);
      client.on("data", data => {
        responseData += data.toString();
      });
      client.on("close", () => {
        expect(responseData).toContain("HTTP/1.1 400");
        expect(bodyReadSucceeded).toBe(false);
        resolve();
      });
      client.write(maliciousRequest);
    });
  });

  test("rejects chunk with LF but wrong first byte", async () => {
    let bodyReadSucceeded = false;
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        try {
          await req.text();
          bodyReadSucceeded = true;
        } catch {
          // Expected: body read should fail due to invalid chunk terminator
        }
        return new Response("OK");
      },
    });

    const client = net.connect(server.port, "127.0.0.1");

    // Chunk size 3, terminator is "X\n" instead of "\r\n"
    const maliciousRequest =
      "POST / HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n" +
      "3\r\n" +
      "ABCX\n" + // 3 bytes "ABC" + invalid terminator "X\n"
      "0\r\n" +
      "\r\n";

    await new Promise<void>((resolve, reject) => {
      let responseData = "";
      client.on("error", reject);
      client.on("data", data => {
        responseData += data.toString();
      });
      client.on("close", () => {
        expect(responseData).toContain("HTTP/1.1 400");
        expect(bodyReadSucceeded).toBe(false);
        resolve();
      });
      client.write(maliciousRequest);
    });
  });

  test("accepts valid chunk terminators", async () => {
    let receivedBody = "";

    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        receivedBody = await req.text();
        return new Response("Success");
      },
    });

    const client = net.connect(server.port, "127.0.0.1");

    const validRequest =
      "POST / HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n" +
      "5\r\n" +
      "Hello\r\n" +
      "6\r\n" +
      " World\r\n" +
      "0\r\n" +
      "\r\n";

    await new Promise<void>((resolve, reject) => {
      client.on("error", reject);
      client.on("data", data => {
        const response = data.toString();
        expect(response).toContain("HTTP/1.1 200");
        expect(receivedBody).toBe("Hello World");
        client.end();
        resolve();
      });
      client.write(validRequest);
    });
  });
});
