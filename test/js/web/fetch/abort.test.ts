"use strict";

import { describe, test, expect } from "bun:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { AbortController as NPMAbortController } from "abort-controller";

test("Allow the usage of custom implementation of AbortController", async () => {
  const body = {
    fixes: 1605,
  };

  await using server = createServer((req, res) => {
    res.statusCode = 200;
    res.end(JSON.stringify(body));
  }).listen(0);
  await once(server, "listening");

  const controller = new NPMAbortController();
  const signal = controller.signal;
  controller.abort();

  try {
    await fetch(`http://localhost:${server.address().port}`, {
      signal,
    });
    expect.unreachable();
  } catch (e) {
    expect(e).toBeDefined();
    expect(e.code).toBe("ABORT_ERR");
  }
});

describe("allows aborting with custom errors", () => {
  test("Using AbortSignal.timeout with cause", async () => {
    const server = createServer().listen(0);
    await once(server, "listening");

    try {
      const res = await fetch(`http://localhost:${server.address().port}`, {
        signal: AbortSignal.timeout(50),
      });
      expect.unreachable(res.statusText);
    } catch (err) {
      if (err.name === "TypeError") {
        const cause = err.cause;
        expect(cause).toBeDefined();

        expect(cause.name).toBe("HeadersTimeoutError");
        expect(cause.code).toBe("UND_ERR_HEADERS_TIMEOUT");
      } else if (err.name === "TimeoutError") {
        expect(err.code).toBe(DOMException.TIMEOUT_ERR);
        expect(err.cause).toBeUndefined();
      } else {
        expect.unreachable(err);
      }
    } finally {
      server.closeAllConnections();
    }
  });

  test("Error defaults to an AbortError DOMException", async () => {
    await using server = createServer().listen(0);

    await once(server, "listening");
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 1); // no reason

    expect(
      fetch(`http://localhost:${server.address().port}`, {
        signal: ac.signal,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "ABORT_ERR",
      }),
    );
  });
});
