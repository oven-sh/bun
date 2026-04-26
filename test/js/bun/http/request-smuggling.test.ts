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

test("rejects conflicting duplicate Content-Length headers", async () => {
  // RFC 9112 6.3: multiple Content-Length headers with differing values must be rejected
  // to prevent request smuggling.
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
    "Content-Length: 6",
    "Content-Length: 5",
    "",
    "ABCDEF",
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

test("accepts duplicate Content-Length headers with identical values", async () => {
  // RFC 9112 6.3 permits duplicate Content-Length headers if they carry the same value.
  let receivedBody = "";
  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      receivedBody = await req.text();
      return new Response("OK");
    },
  });

  const client = net.connect(server.port, "127.0.0.1");

  const request = ["POST / HTTP/1.1", "Host: localhost", "Content-Length: 5", "Content-Length: 5", "", "Hello"].join(
    "\r\n",
  );

  await new Promise<void>((resolve, reject) => {
    client.on("error", reject);
    client.on("data", data => {
      const response = data.toString();
      expect(response).toContain("HTTP/1.1 200");
      expect(receivedBody).toBe("Hello");
      client.end();
      resolve();
    });
    client.write(request);
  });
});

test("rejects empty-valued Content-Length followed by smuggled Content-Length", async () => {
  // An empty first Content-Length value must be rejected so it cannot be used to bypass
  // the duplicate-Content-Length check and smuggle a second request in the body.
  const seen: string[] = [];
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      seen.push(`${req.method} ${new URL(req.url).pathname}`);
      return new Response("OK");
    },
  });

  const client = net.connect(server.port, "127.0.0.1");
  const smuggled = "GET /admin HTTP/1.1\r\nHost: x\r\n\r\n";
  const payload =
    "POST /api HTTP/1.1\r\n" +
    "Host: target\r\n" +
    "Content-Length:\r\n" +
    `Content-Length: ${smuggled.length}\r\n` +
    "\r\n" +
    smuggled;

  await new Promise<void>((resolve, reject) => {
    client.on("error", reject);
    client.on("data", data => {
      const response = data.toString();
      expect(response).toContain("HTTP/1.1 400");
      client.end();
      resolve();
    });
    client.write(payload);
  });

  expect(seen).not.toContain("GET /admin");
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

  // TE.TE desync: the last-chunk "0\r\n" must be followed by a strict "\r\n"
  // (end-of-body). Consuming arbitrary bytes there lets an attacker smuggle a
  // second request while an upstream proxy parses the same bytes as a valid
  // trailer line. See https://github.com/oven-sh/bun/issues/29732.
  test("rejects arbitrary bytes in place of final CRLF after zero-chunk", async () => {
    const urls: string[] = [];
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        urls.push(new URL(req.url).pathname);
        if (new URL(req.url).pathname === "/admin") {
          return new Response("ADMIN-ACCESS");
        }
        return new Response("OK");
      },
    });

    const client = net.connect(server.port, "127.0.0.1");

    // The bytes "X:" replace the required "\r\n" after the zero-chunk.
    // A vulnerable server consumes "X:" as the terminator and then parses
    // "POST /admin HTTP/1.1" as a second (smuggled) request.
    const smuggleAttempt =
      "POST / HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n" +
      "0\r\n" +
      "X:POST /admin HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "Content-Length: 5\r\n" +
      "\r\n" +
      "admin";

    await new Promise<void>((resolve, reject) => {
      let responseData = "";
      client.on("error", reject);
      client.on("data", data => {
        responseData += data.toString();
      });
      client.on("close", () => {
        expect(responseData).toContain("HTTP/1.1 400");
        // The smuggled second request must never reach the handler.
        expect(urls).not.toContain("/admin");
        // No ADMIN-ACCESS body should have been produced.
        expect(responseData).not.toContain("ADMIN-ACCESS");
        resolve();
      });
      client.write(smuggleAttempt);
    });
  });

  test("rejects zero-chunk terminator with wrong first byte", async () => {
    // First byte of the terminator must be '\r'. Anything else must be rejected.
    await using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("OK");
      },
    });

    const client = net.connect(server.port, "127.0.0.1");

    const maliciousRequest =
      "POST / HTTP/1.1\r\n" + "Host: localhost\r\n" + "Transfer-Encoding: chunked\r\n" + "\r\n" + "0\r\n" + "A\n"; // 'A' instead of '\r'

    await new Promise<void>((resolve, reject) => {
      let responseData = "";
      client.on("error", reject);
      client.on("data", data => {
        responseData += data.toString();
      });
      client.on("close", () => {
        expect(responseData).toContain("HTTP/1.1 400");
        resolve();
      });
      client.write(maliciousRequest);
    });
  });

  test("rejects zero-chunk terminator with CR but wrong second byte", async () => {
    // Second byte of the terminator must be '\n'. Anything else must be rejected.
    await using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("OK");
      },
    });

    const client = net.connect(server.port, "127.0.0.1");

    const maliciousRequest =
      "POST / HTTP/1.1\r\n" + "Host: localhost\r\n" + "Transfer-Encoding: chunked\r\n" + "\r\n" + "0\r\n" + "\rA"; // '\r' followed by 'A' instead of '\n'

    await new Promise<void>((resolve, reject) => {
      let responseData = "";
      client.on("error", reject);
      client.on("data", data => {
        responseData += data.toString();
      });
      client.on("close", () => {
        expect(responseData).toContain("HTTP/1.1 400");
        resolve();
      });
      client.write(maliciousRequest);
    });
  });

  test("rejects zero-chunk terminator split across TCP segments with invalid byte", async () => {
    // The terminator validation must persist across TCP boundaries. Send the
    // first (valid) '\r', yield to the event loop so the server's recv() runs
    // on just that byte, then send a bad second byte in a separate segment.
    // `setNoDelay` disables Nagle so loopback doesn't coalesce the two writes;
    // `Bun.sleep` yields to the uSockets poll phase (unlike `queueMicrotask`
    // which drains synchronously in the same turn and leaves both writes in
    // one recv).
    await using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("OK");
      },
    });

    const client = net.connect(server.port, "127.0.0.1");
    client.setNoDelay(true);

    // Attach the data/close listeners BEFORE any write so the response can't
    // arrive between the write and the listener attach (which would drop it).
    let data = "";
    const responseReady = new Promise<string>((resolve, reject) => {
      client.on("error", reject);
      client.on("data", chunk => {
        data += chunk.toString();
      });
      client.on("close", () => resolve(data));
    });

    await new Promise<void>(connected => client.once("connect", connected));
    client.write(
      "POST / HTTP/1.1\r\n" +
        "Host: localhost\r\n" +
        "Transfer-Encoding: chunked\r\n" +
        "\r\n" +
        "0\r\n" +
        "\r", // first half of terminator
    );
    await Bun.sleep(50);
    client.write("X"); // bad second byte in its own TCP segment

    expect(await responseReady).toContain("HTTP/1.1 400");
  });

  test("accepts zero-chunk with correct CRLF terminator split across segments", async () => {
    // Control for the fragmentation test above: a valid split must still work.
    let receivedBody = "";
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        receivedBody = await req.text();
        return new Response("OK");
      },
    });

    const client = net.connect(server.port, "127.0.0.1");
    client.setNoDelay(true);

    // Listeners first — see comment in the previous test.
    let data = "";
    const responseReady = new Promise<string>((resolve, reject) => {
      client.on("error", reject);
      client.on("data", chunk => {
        data += chunk.toString();
        // Response is served on a keep-alive connection by default, so we
        // need to close the client ourselves once we've seen the full headers.
        if (data.includes("\r\n\r\nOK")) client.end();
      });
      client.on("close", () => resolve(data));
    });

    await new Promise<void>(connected => client.once("connect", connected));
    client.write(
      "POST / HTTP/1.1\r\n" +
        "Host: localhost\r\n" +
        "Transfer-Encoding: chunked\r\n" +
        "\r\n" +
        "0\r\n" +
        "\r", // first half
    );
    await Bun.sleep(50);
    client.write("\n"); // valid second half in its own TCP segment

    const responseData = await responseReady;
    expect(responseData).toContain("HTTP/1.1 200");
    expect(receivedBody).toBe("");
  });
});

describe("chunked encoding size hardening", () => {
  test("rejects extremely large chunk size hex values", async () => {
    // Chunk sizes with many hex digits should be rejected by the overflow check.
    // 'FFFFFFFFFFFFFFFF' sets bits in the overflow-detection region (bits 56-59),
    // so the parser must return an error.
    let bodyReadSucceeded = false;

    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        try {
          await req.text();
          bodyReadSucceeded = true;
        } catch {
          // Expected to fail
        }
        return new Response("OK");
      },
    });

    const client = net.connect(server.port, "127.0.0.1");

    // 16 hex digits all 'F' — sets overflow bits and must be rejected
    const maliciousRequest =
      "POST / HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n" +
      "FFFFFFFFFFFFFFFF\r\n" +
      "data\r\n" +
      "0\r\n" +
      "\r\n";

    await new Promise<void>(resolve => {
      let responseData = "";
      client.on("error", () => resolve());
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

  test("large chunk size exceeding 32 bits does not produce empty body", async () => {
    // '100000000' hex = 2^32 (4294967296). If the chunk size were truncated
    // to 32 bits, this would become 0, and the +2 for CRLF would make it
    // look like the end-of-chunks marker (size=2), producing an empty body.
    // With correct 64-bit handling, the parser treats this as a large
    // pending chunk — the body read should fail when we close the connection,
    // because the server is still expecting ~4GB of data.
    let receivedBody: string | null = null;
    let bodyError = false;

    const { promise: headersReceived, resolve: onHeadersReceived } = Promise.withResolvers<void>();
    const { promise: bodyHandled, resolve: bodyDone } = Promise.withResolvers<void>();

    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Signal that headers have been parsed and the fetch handler entered
        onHeadersReceived();
        try {
          receivedBody = await req.text();
        } catch {
          bodyError = true;
        }
        bodyDone();
        return new Response("OK");
      },
    });

    const client = net.connect(server.port, "127.0.0.1");

    // Send the chunk header claiming 4GB of data, followed by a few bytes,
    // then close the connection.
    const maliciousRequest =
      "POST / HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n" +
      "100000000\r\n" +
      "AAAA\r\n";

    client.write(maliciousRequest);

    // Wait until the server has parsed headers and entered the fetch handler,
    // then close the connection to trigger the body error (since we won't send 4GB).
    await headersReceived;
    client.end();

    await bodyHandled;

    // With correct 64-bit handling, the body read must fail because we
    // disconnected before sending 4GB of chunk data.
    // With truncation to 32-bit zero, the body would be "" with no error.
    expect(bodyError).toBe(true);
    expect(receivedBody).toBeNull();
  });

  test("accepts valid chunk sizes within normal range", async () => {
    // Normal-sized chunks should still work fine
    let receivedBody = "";

    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        receivedBody = await req.text();
        return new Response("Success");
      },
    });

    const client = net.connect(server.port, "127.0.0.1");

    // Use hex chunk sizes that are perfectly valid
    const validRequest =
      "POST / HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n" +
      "a\r\n" + // 10 bytes
      "0123456789\r\n" +
      "FF\r\n" + // 255 bytes
      Buffer.alloc(255, "A").toString() +
      "\r\n" +
      "0\r\n" +
      "\r\n";

    await new Promise<void>((resolve, reject) => {
      client.on("error", reject);
      client.on("data", data => {
        const response = data.toString();
        expect(response).toContain("HTTP/1.1 200");
        expect(receivedBody).toBe("0123456789" + Buffer.alloc(255, "A").toString());
        client.end();
        resolve();
      });
      client.write(validRequest);
    });
  });
});

// Tests for strict RFC 7230 HEXDIG validation in chunk size parsing.
// Chunk sizes must only contain characters from the set [0-9a-fA-F].
// Non-HEXDIG characters must be rejected to ensure consistent parsing
// across all HTTP implementations in a proxy chain.
describe("chunk size strict hex digit validation", () => {
  // Helper to send a raw HTTP request and get the response
  async function sendRawChunkedRequest(port: number, chunkSizeLine: string, chunkData: string): Promise<string> {
    const client = net.connect(port, "127.0.0.1");

    const request =
      "POST / HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "Connection: close\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n" +
      chunkSizeLine +
      "\r\n" +
      chunkData +
      "\r\n" +
      "0\r\n" +
      "\r\n";

    return new Promise<string>((resolve, reject) => {
      let responseData = "";
      client.on("error", reject);
      client.on("data", data => {
        responseData += data.toString();
      });
      client.on("close", () => {
        resolve(responseData);
      });
      client.write(request);
    });
  }

  test("accepts valid hex digits 0-9 in chunk size", async () => {
    let receivedBody = "";
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        receivedBody = await req.text();
        return new Response("OK");
      },
    });

    // "9" = 9 bytes
    const response = await sendRawChunkedRequest(server.port, "9", "123456789");
    expect(response).toContain("HTTP/1.1 200");
    expect(receivedBody).toBe("123456789");
  });

  test("accepts valid hex digits a-f in chunk size", async () => {
    let receivedBody = "";
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        receivedBody = await req.text();
        return new Response("OK");
      },
    });

    // "a" = 10 bytes
    const response = await sendRawChunkedRequest(server.port, "a", "1234567890");
    expect(response).toContain("HTTP/1.1 200");
    expect(receivedBody).toBe("1234567890");
  });

  test("accepts valid hex digits A-F in chunk size", async () => {
    let receivedBody = "";
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        receivedBody = await req.text();
        return new Response("OK");
      },
    });

    // "B" = 11 bytes
    const response = await sendRawChunkedRequest(server.port, "B", "12345678901");
    expect(response).toContain("HTTP/1.1 200");
    expect(receivedBody).toBe("12345678901");
  });

  test("accepts multi-digit hex chunk size", async () => {
    let receivedBody = "";
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        receivedBody = await req.text();
        return new Response("OK");
      },
    });

    // "1a" = 26 bytes
    const response = await sendRawChunkedRequest(server.port, "1a", "abcdefghijklmnopqrstuvwxyz");
    expect(response).toContain("HTTP/1.1 200");
    expect(receivedBody).toBe("abcdefghijklmnopqrstuvwxyz");
  });

  // Characters in ASCII 71+ (G-Z, g-z) are not valid hex digits
  for (const ch of ["G", "g", "Z", "z", "x", "X"]) {
    test(`rejects '${ch}' in chunk size (not a hex digit)`, async () => {
      await using server = Bun.serve({
        port: 0,
        async fetch(req) {
          return new Response("OK");
        },
      });

      const response = await sendRawChunkedRequest(server.port, `1${ch}`, "A".repeat(32));
      expect(response).toContain("HTTP/1.1 400");
    });
  }

  // Characters in ASCII 58-64 (:, <, =, >, ?, @) lie between '9' and 'A'
  // and must not be accepted as hex digits
  for (const ch of [":", "<", "=", ">", "?", "@"]) {
    test(`rejects '${ch}' (ASCII ${ch.charCodeAt(0)}) in chunk size`, async () => {
      await using server = Bun.serve({
        port: 0,
        async fetch(req) {
          return new Response("OK");
        },
      });

      const response = await sendRawChunkedRequest(server.port, `1${ch}`, "A".repeat(32));
      expect(response).toContain("HTTP/1.1 400");
    });
  }

  // Other non-hex characters
  for (const ch of ["!", "#", "$", "%", "^", "&", "*", "(", ")", "_", "+", "~", "`", "|"]) {
    test(`rejects '${ch}' in chunk size`, async () => {
      await using server = Bun.serve({
        port: 0,
        async fetch(req) {
          return new Response("OK");
        },
      });

      const response = await sendRawChunkedRequest(server.port, `1${ch}`, "A".repeat(32));
      expect(response).toContain("HTTP/1.1 400");
    });
  }
});

describe("pipelined request header isolation", () => {
  test("pipelined request with no headers does not inherit previous request's headers", async () => {
    // When pipelining requests, headers from a previous request must not
    // carry over to subsequent requests. A request with no headers must
    // be treated as having no Content-Length and no Transfer-Encoding.
    const requestBodies: string[] = [];
    const requestUrls: string[] = [];

    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        requestUrls.push(url.pathname);
        const body = await req.text();
        requestBodies.push(body);
        return new Response("OK " + url.pathname);
      },
    });

    const client = net.connect(server.port, "127.0.0.1");

    // First request: has Content-Length header with a body
    // Second request: has NO headers at all (just request line + \r\n\r\n)
    // The second request must NOT inherit Content-Length from the first.
    const body = "A".repeat(50);
    const pipelinedRequests =
      "POST /first HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      `Content-Length: ${body.length}\r\n` +
      "\r\n" +
      body +
      "GET /second HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "\r\n";

    await new Promise<void>((resolve, reject) => {
      let responseData = "";
      let responseCount = 0;
      client.on("error", reject);
      client.on("data", data => {
        responseData += data.toString();
        // Count HTTP responses
        const matches = responseData.match(/HTTP\/1\.1/g);
        responseCount = matches ? matches.length : 0;
        if (responseCount >= 2) {
          client.end();
          resolve();
        }
      });
      client.write(pipelinedRequests);
    });

    // Both requests should have been handled
    expect(requestUrls).toContain("/first");
    expect(requestUrls).toContain("/second");
    // The second request (GET with no body) must have an empty body
    const secondIdx = requestUrls.indexOf("/second");
    expect(requestBodies[secondIdx]).toBe("");
  });

  test("pipelined headerless request does not consume next client's data as body", async () => {
    // Simulates the scenario where a headerless pipelined request could
    // incorrectly read stale Content-Length and consume subsequent data as body.
    const requestBodies: string[] = [];
    const requestUrls: string[] = [];

    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        requestUrls.push(url.pathname);
        const body = await req.text();
        requestBodies.push(body);
        return new Response("OK " + url.pathname);
      },
    });

    const client = net.connect(server.port, "127.0.0.1");

    const body = "X".repeat(30);
    // Request 1: POST with Content-Length
    // Request 2: GET with no headers at all (empty headers)
    // Request 3: GET with normal headers
    // If stale headers leak, request 2 would try to read request 3's bytes as body
    const pipelinedRequests =
      "POST /req1 HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      `Content-Length: ${body.length}\r\n` +
      "\r\n" +
      body +
      "GET /req2 HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "\r\n" +
      "GET /req3 HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "\r\n";

    await new Promise<void>((resolve, reject) => {
      let responseData = "";
      let responseCount = 0;
      client.on("error", reject);
      client.on("data", data => {
        responseData += data.toString();
        const matches = responseData.match(/HTTP\/1\.1/g);
        responseCount = matches ? matches.length : 0;
        if (responseCount >= 3) {
          client.end();
          resolve();
        }
      });
      client.write(pipelinedRequests);
    });

    // All three requests should have been processed independently
    expect(requestUrls).toContain("/req1");
    expect(requestUrls).toContain("/req2");
    expect(requestUrls).toContain("/req3");
    // req2 and req3 (both GETs) should have empty bodies
    const req2Idx = requestUrls.indexOf("/req2");
    const req3Idx = requestUrls.indexOf("/req3");
    expect(requestBodies[req2Idx]).toBe("");
    expect(requestBodies[req3Idx]).toBe("");
  });

  test("pipelined headerless request is rejected and does not inherit stale content-length", async () => {
    // A pipelined request with truly NO headers (not even Host) must be
    // properly rejected. It must NOT inherit a Content-Length or
    // Transfer-Encoding from the previous request on the same connection.
    let secondRequestReached = false;

    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/second") {
          secondRequestReached = true;
        }
        return new Response("OK " + url.pathname);
      },
    });

    const client = net.connect(server.port, "127.0.0.1");

    const body = "B".repeat(50);
    // Request 1: POST with Content-Length: 50
    // Request 2: completely headerless (no Host, no nothing)
    // Without the fix, headers[1] would still contain stale headers from
    // request 1, and the parser would incorrectly read Content-Length: 50
    // from the stale data, consuming the next 50 bytes as body.
    const pipelinedRequests =
      "POST /first HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      `Content-Length: ${body.length}\r\n` +
      "\r\n" +
      body +
      "GET /second HTTP/1.1\r\n" +
      "\r\n";

    await new Promise<void>((resolve, reject) => {
      let responseData = "";
      client.on("error", reject);
      client.on("data", data => {
        responseData += data.toString();
        // We expect: 200 for request 1, then 400 for request 2 (missing Host)
        const responses = responseData.match(/HTTP\/1\.1 \d+/g);
        if (responses && responses.length >= 2) {
          client.end();
          resolve();
        }
      });
      // Also resolve on close in case the server closes the connection
      client.on("close", () => {
        resolve();
      });
      client.write(pipelinedRequests);
    });

    // The headerless second request must NOT have reached the handler
    // (it should be rejected for missing Host header, not processed
    // with stale headers from the first request)
    expect(secondRequestReached).toBe(false);
  });
});
