/**
 * curl() in scripts/utils.mjs is how the CI scripts read Buildkite, GitHub and the
 * cloud metadata services. It retries a request that fails. Every caller reads
 * `error` first and gives up when it is set, so a request that a retry saved has
 * to return the same result as one that worked the first time.
 *
 * The fake server below scripts one outcome per request. `retryDelay: 0` removes
 * the wait between attempts.
 */
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { curl, curlSafe } from "../../scripts/utils.mjs";

/** "drop" closes the connection without an answer. Anything else is a status line and a body. */
type Outcome = "drop" | [status: string, body: string];

const ok: Outcome = ["200 OK", JSON.stringify({ ok: true })];
const busy: Outcome = ["503 Service Unavailable", "busy"];

/**
 * Answers request N with outcome N, and drops every request after the script
 * runs out. Every response is Connection: close, so one attempt is one request.
 */
async function fakeServer(script: Outcome[]) {
  let requests = 0;
  const server = createServer(socket => {
    socket.once("data", () => {
      const outcome = script[requests++] ?? "drop";
      if (outcome === "drop") {
        socket.destroy();
        return;
      }
      const [status, body] = outcome;
      socket.end(
        `HTTP/1.1 ${status}\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/build.json`,
    get requests() {
      return requests;
    },
    [Symbol.asyncDispose]: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

describe("curl", () => {
  const transientFailures: [string, Outcome][] = [
    ["answers 503", busy],
    ["drops the connection", "drop"],
    ["sends a body that does not parse", ["200 OK", "<html>"]],
  ];

  test.each(transientFailures)(
    "a retry that succeeds reports no error when the first attempt %s",
    async (_, failure) => {
      await using server = await fakeServer([failure, ok]);

      const result = await curl(server.url, { json: true, retryDelay: 0 });

      expect(result).toEqual({ status: 200, statusText: "OK", error: undefined, body: { ok: true } });
      expect(server.requests).toBe(2);
    },
  );

  test("the cached result of a retry that succeeds has no error", async () => {
    await using server = await fakeServer([busy, ok]);
    const options = { json: true, cache: true, retryDelay: 0 };

    await curl(server.url, options);
    const cached = await curl(server.url, options);

    expect(cached).toEqual({ status: 200, statusText: "OK", error: undefined, body: { ok: true } });
    expect(server.requests).toBe(2);
  });

  test("a download that needed a retry writes the file and returns no body", async () => {
    using dir = tempDir("utils-curl-retry", {});
    await using server = await fakeServer([busy, ["200 OK", "artifact bytes"]]);
    const filename = join(String(dir), "artifact.bin");

    const result = await curl(server.url, { filename, retryDelay: 0 });

    expect(readFileSync(filename, "utf8")).toBe("artifact bytes");
    expect(result).toEqual({ status: 200, statusText: "OK", error: undefined, body: undefined });
    expect(server.requests).toBe(2);
  });

  test("a failure on the last attempt is reported with nothing from the attempt before it", async () => {
    await using server = await fakeServer([busy, "drop"]);

    const result = await curl(server.url, { retries: 2, retryDelay: 0 });

    expect(result.error?.message).toBe(`Fetch failed: GET ${server.url}`);
    expect(result).toEqual({ status: undefined, statusText: undefined, error: expect.any(Error), body: undefined });
    expect(server.requests).toBe(2);
  });

  test("a request that fails on every attempt reports the last failure", async () => {
    await using server = await fakeServer([busy, busy, busy]);

    const result = await curl(server.url, { retryDelay: 0 });

    expect(result.error?.message).toBe(`Fetch failed: GET ${server.url}: 503 Service Unavailable`);
    expect(result).toEqual({ status: 503, statusText: "Service Unavailable", error: expect.any(Error), body: "busy" });
    expect(server.requests).toBe(3);
  });
});

describe("curlSafe", () => {
  test("returns the body of a retry that succeeds", async () => {
    await using server = await fakeServer([busy, ok]);

    expect(await curlSafe(server.url, { json: true, retryDelay: 0 })).toEqual({ ok: true });
    expect(server.requests).toBe(2);
  });
});
