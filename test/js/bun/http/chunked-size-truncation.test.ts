import { describe, expect, test } from "bun:test";
import net from "net";

describe("chunked encoding size truncation", () => {
  test("does not truncate chunk sizes that exceed 32-bit range", async () => {
    // A chunk size of 0x100000002 (4GB + 2) would be truncated to 2
    // if chunkSize() returns unsigned int (32-bit).
    // With the fix, the parser correctly stores the full 64-bit value,
    // so it waits for ~4GB of data rather than reading just 2 bytes.
    // This means the smuggled request after the 2 bytes is NOT parsed.
    let smuggled = false;
    let requestCount = 0;

    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        requestCount++;
        const url = new URL(req.url);
        if (url.pathname === "/smuggled") {
          smuggled = true;
        }
        try {
          await req.text();
        } catch {
          // body read failure is acceptable
        }
        return new Response("OK");
      },
    });

    const client = net.connect(server.port, "127.0.0.1");

    // The attack payload: chunk size = 0x100000002.
    // If truncated to 32 bits -> size = 2, parser reads "AB", then sees
    // "GET /smuggled" as a new pipelined HTTP request (VULNERABLE).
    // If correctly stored as 4GB+2, parser waits for more data (SAFE).
    const smuggleAttempt =
      "POST / HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n" +
      "100000002\r\n" +
      "AB\r\n" +
      "0\r\n" +
      "\r\n" +
      "GET /smuggled HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "\r\n";

    await new Promise<void>(resolve => {
      client.on("error", () => {
        // Connection error is acceptable (server may close it)
        resolve();
      });
      client.on("close", () => {
        resolve();
      });
      // We give it a short window - if the parser truncated the size,
      // the smuggled request would be processed almost instantly
      client.setTimeout(2000, () => {
        client.destroy();
        resolve();
      });
      client.write(smuggleAttempt);
    });

    // The critical assertion: the /smuggled request must NEVER be processed
    expect(smuggled).toBe(false);
    // At most one request should have been handled (the POST /)
    // With the fix, even that one may not complete since the parser
    // is waiting for 4GB of chunk data that will never arrive
    expect(requestCount).toBeLessThanOrEqual(1);
  });

  test("rejects chunk sizes in the overflow detection range", async () => {
    // STATE_SIZE_OVERFLOW = 0x0F00000000000000. When chunkSize() returned
    // unsigned int (32-bit), the AND with STATE_SIZE_OVERFLOW always yielded 0
    // because STATE_SIZE_OVERFLOW has no bits in the lower 32 positions.
    // With uint64_t return type, the overflow check works correctly.

    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        try {
          await req.text();
        } catch {
          // body read failure is acceptable
        }
        return new Response("OK");
      },
    });

    const client = net.connect(server.port, "127.0.0.1");

    // Chunk size that should trigger overflow: 16 hex digits (max uint64)
    // This exercises the STATE_SIZE_OVERFLOW check in consumeHexNumber()
    const maliciousRequest =
      "POST / HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n" +
      "FFFFFFFFFFFFFFFF\r\n" +
      "AB\r\n" +
      "0\r\n" +
      "\r\n";

    const response = await new Promise<string>(resolve => {
      let data = "";
      client.on("error", () => {
        resolve(data);
      });
      client.on("data", chunk => {
        data += chunk.toString();
      });
      client.on("close", () => {
        resolve(data);
      });
      client.setTimeout(5000, () => {
        client.destroy();
        resolve(data);
      });
      client.write(maliciousRequest);
    });

    // Must be rejected - connection should be closed with 400
    expect(response).toContain("400");
  });

  test("overflow check catches values above 0x0F00000000000000", async () => {
    // A chunk size of 0x1000000000000001 (> STATE_SIZE_OVERFLOW threshold)
    // should be caught by the overflow check.
    // Before the fix, chunkSize() returned 32-bit, making this check dead code.

    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        try {
          await req.text();
        } catch {}
        return new Response("OK");
      },
    });

    const client = net.connect(server.port, "127.0.0.1");

    // 0x1000000000000001 - has bits in the STATE_SIZE_OVERFLOW range
    const maliciousRequest =
      "POST / HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n" +
      "1000000000000001\r\n" +
      "X\r\n" +
      "0\r\n" +
      "\r\n";

    const response = await new Promise<string>(resolve => {
      let data = "";
      client.on("error", () => {
        resolve(data);
      });
      client.on("data", chunk => {
        data += chunk.toString();
      });
      client.on("close", () => {
        resolve(data);
      });
      client.setTimeout(5000, () => {
        client.destroy();
        resolve(data);
      });
      client.write(maliciousRequest);
    });

    // Must be rejected
    expect(response).toContain("400");
  });

  test("smuggled request via 32-bit wraparound is prevented", async () => {
    // This is the most direct test: with truncation, 0x100000005 becomes 5,
    // which would read exactly "Hello" as the chunk body, complete the request,
    // and then parse the smuggled GET request.
    let smuggled = false;
    let capturedPaths: string[] = [];

    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        capturedPaths.push(url.pathname);
        if (url.pathname === "/smuggled") {
          smuggled = true;
        }
        try {
          await req.text();
        } catch {}
        return new Response("OK");
      },
    });

    const client = net.connect(server.port, "127.0.0.1");

    // With truncation: chunk size = 0x100000005 -> truncated to 5.
    // Parser reads "Hello" (5 bytes), then "\r\n" terminator, then "0\r\n\r\n"
    // completes the chunked body. Then "GET /smuggled..." is parsed as new request.
    //
    // Without truncation: chunk size = 0x100000005 = ~4GB, parser waits for
    // 4GB+ of data, never processes the smuggled request.
    const smuggleAttempt =
      "POST / HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n" +
      "100000005\r\n" +
      "Hello\r\n" +
      "0\r\n" +
      "\r\n" +
      "GET /smuggled HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "\r\n";

    await new Promise<void>(resolve => {
      client.on("error", () => resolve());
      client.on("close", () => resolve());
      client.setTimeout(2000, () => {
        client.destroy();
        resolve();
      });
      client.write(smuggleAttempt);
    });

    // The smuggled request must NEVER be processed
    expect(smuggled).toBe(false);
    expect(capturedPaths).not.toContain("/smuggled");
  });

  test("valid small chunk sizes still work correctly", async () => {
    // Ensure the fix doesn't break normal chunked encoding
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

    const response = await new Promise<string>((resolve, reject) => {
      client.on("error", reject);
      client.on("data", chunk => {
        resolve(chunk.toString());
      });
      client.setTimeout(5000, () => {
        client.destroy();
        reject(new Error("timeout"));
      });
      client.write(validRequest);
    });

    expect(response).toContain("HTTP/1.1 200");
    expect(receivedBody).toBe("Hello World");
  });
});
