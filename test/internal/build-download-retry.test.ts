/**
 * downloadWithRetry() (scripts/build/download.ts) is all that stands between
 * a CI build lane and github.com: every dep whose pin moved after the CI
 * images (and the prefetch cache baked into them) were published downloads
 * live on every lane of every build, WebKit included, so a build makes on the
 * order of a hundred github.com round-trips through this one loop.
 *
 * Two things have taken build lanes down through it. Outages long enough to
 * outlast the retry schedule, and, once the schedule was long enough, retries
 * that could not land anywhere new: fetch() handed every retry the pooled
 * connection the previous attempt had just failed on, so a process that drew
 * a bad github.com front-end on its first connection (503s, or HTTP/2
 * REFUSED_STREAM) failed every attempt on it while the fetches next to it
 * succeeded. Hence the shape of the fake server below: it is scripted per
 * CONNECTION, and a plan applies to every request that connection carries,
 * which is exactly what distinguishes "retried on a new connection" from
 * "retried on the same one".
 *
 * The same server doubles as an HTTP proxy for the proxy tests: builds behind
 * a proxy only ever worked because the downloader honored HTTP(S)_PROXY, and
 * the downloader now has to do that itself.
 *
 * The production schedule is driven with its backoff zeroed, so the full
 * attempt count runs in milliseconds; the schedule's real timing is asserted
 * separately.
 */
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { join } from "node:path";

import { downloadRetry, downloadWithRetry, proxyEnvironment, type RetryPolicy } from "../../scripts/build/download.ts";
import { BuildError, describeError } from "../../scripts/build/error.ts";

const BODY = "tarball bytes";

/**
 * downloadWithRetry reads the proxy variables from process.env. Each test
 * starts with none of them set (whatever the machine running the tests has),
 * and the proxy tests set exactly the ones they are about.
 */
const proxyVariables = ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "no_proxy", "NO_PROXY"] as const;
let ambientProxyEnv: Partial<Record<(typeof proxyVariables)[number], string>>;
beforeEach(() => {
  ambientProxyEnv = {};
  for (const name of proxyVariables) {
    if (process.env[name] !== undefined) ambientProxyEnv[name] = process.env[name];
    delete process.env[name];
  }
});
afterEach(() => {
  for (const name of proxyVariables) delete process.env[name];
  Object.assign(process.env, ambientProxyEnv);
});

/** The production attempt count with no waiting between attempts. */
const noBackoff: RetryPolicy = { ...downloadRetry, backoffMs: () => 0 };

/**
 * For the stall tests: how long a stalled connection is waited on. Well above
 * what a loopback exchange takes even on a debug build under load, since a
 * healthy connection timing out would show up as an extra retry.
 */
const stallMs = 1000;

/**
 * What a connection does with each request it carries.
 *  - "body":      200 with BODY
 *  - "drop":      close the connection without answering (a reset or an
 *                 unreachable host, as far as the client can tell)
 *  - "stall":     accept the request and never answer
 *  - "stall-mid-body": send the headers and half the body, then nothing
 *  - "NNN text":  that status line, keep-alive, empty body
 *  - { redirect } 302 there, keep-alive
 */
type Plan = "body" | "drop" | "stall" | "stall-mid-body" | `${number} ${string}` | { redirect: string };

/**
 * Connection number i (0-based) follows `plans[i]`, every connection after the
 * script follows `rest`. Responses deliberately keep the connection alive:
 * a client that reuses it gets the same plan again, one that reconnects moves
 * on to the next.
 */
async function fakeServer(plans: Plan[], rest: Plan = "body") {
  const planOf = new WeakMap<Socket, Plan>();
  let connections = 0;
  let requests = 0;
  const paths: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    requests++;
    paths.push(req.url!);
    const plan = planOf.get(req.socket)!;
    if (plan === "drop") {
      req.socket.destroy();
    } else if (plan === "stall") {
      // Nothing: the client has to give up on its own.
    } else if (plan === "stall-mid-body") {
      res.writeHead(200, { "Content-Length": String(BODY.length) });
      res.write(BODY.slice(0, 4));
    } else if (plan === "body") {
      res.writeHead(200, { "Content-Length": String(BODY.length) });
      res.end(BODY);
    } else if (typeof plan === "object") {
      res.writeHead(302, { Location: plan.redirect, "Content-Length": "0" });
      res.end();
    } else {
      const space = plan.indexOf(" ");
      res.writeHead(Number(plan.slice(0, space)), plan.slice(space + 1), { "Content-Length": "0" });
      res.end();
    }
  });
  server.on("connection", socket => {
    planOf.set(socket, plans[connections++] ?? rest);
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    url: `http://127.0.0.1:${port}/dep.tar.gz`,
    /** Connections accepted and requests served; with one request per connection the two are equal. */
    get traffic() {
      return { connections, requests };
    },
    paths,
    [Symbol.asyncDispose]: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected the download to fail");
}

/** downloadWithRetry narrates each retry through console.log; collect those lines instead of printing them. */
async function withLogCaptured<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });
  try {
    return { result: await fn(), lines };
  } finally {
    log.mockRestore();
  }
}

/** What a closed-without-answering connection is reported as; the wording is the runtime's. */
const droppedConnection = /reset|hang up|closed/i;

test("the schedule waits out at least two minutes of github.com being unreachable", () => {
  let totalBackoffMs = 0;
  for (let attempt = 2; attempt <= downloadRetry.attempts; attempt++) {
    const backoffMs = downloadRetry.backoffMs(attempt);
    // Capped so a recovered network is noticed within half a minute.
    expect(backoffMs).toBeLessThanOrEqual(30_000);
    totalBackoffMs += backoffMs;
  }
  expect(totalBackoffMs).toBeGreaterThanOrEqual(120_000);
  // A stalled connection is given up on rather than waited on, and even a
  // download that stalls on every attempt ends well inside build-bun's
  // step timeout (60 minutes).
  expect(downloadRetry.idleTimeoutMs).toBeGreaterThanOrEqual(30_000);
  expect(totalBackoffMs + downloadRetry.attempts * downloadRetry.idleTimeoutMs).toBeLessThanOrEqual(20 * 60_000);
});

test("a retry gets a new connection, not the one the failed attempt used", async () => {
  using dir = tempDir("build-download-retry", {});
  // The first connection is a bad front-end: it stays open and answers 503
  // to anything sent on it. Anything that reconnects is served.
  await using server = await fakeServer(["503 Service Unavailable"]);
  const dest = join(String(dir), "dep.tar.gz");

  const { lines } = await withLogCaptured(() => downloadWithRetry(server.url, dest, "dep", noBackoff));

  expect(readFileSync(dest, "utf8")).toBe(BODY);
  expect(lines).toEqual([`retry 2/${downloadRetry.attempts} in 0ms (HTTP 503 Service Unavailable for ${server.url})`]);
  expect(server.traffic).toEqual({ connections: 2, requests: 2 });
});

test("a download that fails on every attempt but the last still succeeds", async () => {
  using dir = tempDir("build-download-retry", {});
  await using server = await fakeServer(Array(downloadRetry.attempts - 1).fill("drop"));
  const dest = join(String(dir), "dep.tar.gz");

  const { lines } = await withLogCaptured(() => downloadWithRetry(server.url, dest, "dep", noBackoff));

  expect(readFileSync(dest, "utf8")).toBe(BODY);
  expect(server.traffic).toEqual({ connections: downloadRetry.attempts, requests: downloadRetry.attempts });
  expect(lines.filter(line => line.startsWith("retry "))).toHaveLength(downloadRetry.attempts - 1);
});

test("429 is retried, and the retry line says what failed", async () => {
  using dir = tempDir("build-download-retry", {});
  await using server = await fakeServer(["429 Too Many Requests"]);
  const dest = join(String(dir), "dep.tar.gz");

  const { lines } = await withLogCaptured(() => downloadWithRetry(server.url, dest, "dep", noBackoff));

  expect(readFileSync(dest, "utf8")).toBe(BODY);
  expect(server.traffic).toEqual({ connections: 2, requests: 2 });
  expect(lines).toEqual([`retry 2/${downloadRetry.attempts} in 0ms (HTTP 429 Too Many Requests for ${server.url})`]);
});

test("404 is not retried and is thrown as-is (prefetch-deps.ts matches on the message)", async () => {
  using dir = tempDir("build-download-retry", {});
  await using server = await fakeServer(["404 Not Found"]);
  const dest = join(String(dir), "dep.tar.gz");

  const { result: err, lines } = await withLogCaptured(() =>
    rejection(downloadWithRetry(server.url, dest, "dep", noBackoff)),
  );

  expect(err).toBeInstanceOf(BuildError);
  expect((err as BuildError).message).toBe(`HTTP 404 Not Found for ${server.url}`);
  expect(lines).toEqual([]);
  expect(server.traffic).toEqual({ connections: 1, requests: 1 });
  expect(existsSync(dest)).toBe(false);
});

test("redirects are followed, each hop on its own connection", async () => {
  using dir = tempDir("build-download-retry", {});
  // github.com answers every archive and release download with a 302 to
  // codeload.github.com / objects.githubusercontent.com; here both hops are
  // the same server, told apart by path.
  await using server = await fakeServer([{ redirect: "/mirror/dep.tar.gz" }]);
  const dest = join(String(dir), "dep.tar.gz");

  const { lines } = await withLogCaptured(() => downloadWithRetry(server.url, dest, "dep", noBackoff));

  expect(readFileSync(dest, "utf8")).toBe(BODY);
  expect(lines).toEqual([]);
  expect(server.paths).toEqual(["/dep.tar.gz", "/mirror/dep.tar.gz"]);
  expect(server.traffic).toEqual({ connections: 2, requests: 2 });
});

test("a failure on the redirected-to hop is reported against that hop", async () => {
  using dir = tempDir("build-download-retry", {});
  await using server = await fakeServer([
    { redirect: "/mirror/dep.tar.gz" },
    "drop", // the mirror hop of attempt 1
    { redirect: "/mirror/dep.tar.gz" },
    "404 Not Found", // the mirror hop of attempt 2
  ]);
  const dest = join(String(dir), "dep.tar.gz");
  const mirror = `${server.origin}/mirror/dep.tar.gz`;

  const { result, lines } = await withLogCaptured(() =>
    rejection(downloadWithRetry(server.url, dest, "dep", noBackoff)),
  );
  const err = result as BuildError;

  expect(lines).toHaveLength(1);
  expect(lines[0]).toStartWith(`retry 2/${downloadRetry.attempts} in 0ms (while fetching ${mirror}: `);
  expect(lines[0]).toMatch(droppedConnection);
  // The 404 is still thrown bare, naming the hop that produced it, so
  // prefetch-deps.ts' /\bHTTP 404\b/ and prebuiltDownloadError's check work.
  expect(err).toBeInstanceOf(BuildError);
  expect(err.message).toBe(`HTTP 404 Not Found for ${mirror}`);
  expect(server.traffic).toEqual({ connections: 4, requests: 4 });
  expect(existsSync(dest)).toBe(false);
});

test("a connection that accepts the request and never answers is given up on and retried", async () => {
  using dir = tempDir("build-download-retry", {});
  await using server = await fakeServer(["stall"]);
  const dest = join(String(dir), "dep.tar.gz");

  const { lines } = await withLogCaptured(() =>
    downloadWithRetry(server.url, dest, "dep", { ...noBackoff, idleTimeoutMs: stallMs }),
  );

  expect(readFileSync(dest, "utf8")).toBe(BODY);
  expect(lines).toEqual([`retry 2/${downloadRetry.attempts} in 0ms (no data from ${server.url} for ${stallMs}ms)`]);
  expect(server.traffic).toEqual({ connections: 2, requests: 2 });
});

test("a body that stops arriving is given up on and retried, leaving no partial file", async () => {
  using dir = tempDir("build-download-retry", {});
  await using server = await fakeServer(["stall-mid-body"]);
  const dest = join(String(dir), "dep.tar.gz");

  const { lines } = await withLogCaptured(() =>
    downloadWithRetry(server.url, dest, "dep", { ...noBackoff, idleTimeoutMs: stallMs }),
  );

  expect(readFileSync(dest, "utf8")).toBe(BODY);
  expect(lines).toEqual([`retry 2/${downloadRetry.attempts} in 0ms (no data from ${server.url} for ${stallMs}ms)`]);
  expect(server.traffic).toEqual({ connections: 2, requests: 2 });
  expect(readdirSync(String(dir))).toEqual(["dep.tar.gz"]);
});

test("http_proxy is honored, including the scheme-less form curl and bun's fetch() accept", async () => {
  using dir = tempDir("build-download-retry", {});
  // The fake server plays the proxy: a proxied request reaches it carrying
  // the full URL as its request target. dep.invalid itself resolves nowhere,
  // so a download that ignored the proxy could only fail.
  await using proxy = await fakeServer([]);
  process.env.http_proxy = proxy.origin.slice("http://".length);
  const dest = join(String(dir), "dep.tar.gz");

  const { lines } = await withLogCaptured(() =>
    downloadWithRetry("http://dep.invalid/dep.tar.gz", dest, "dep", noBackoff),
  );

  expect(readFileSync(dest, "utf8")).toBe(BODY);
  expect(lines).toEqual([]);
  expect(proxy.paths).toEqual(["http://dep.invalid/dep.tar.gz"]);
  expect(proxy.traffic).toEqual({ connections: 1, requests: 1 });
});

test("NO_PROXY sends a download past the proxy", async () => {
  using dir = tempDir("build-download-retry", {});
  await using proxy = await fakeServer([]);
  await using server = await fakeServer([]);
  process.env.HTTP_PROXY = proxy.origin;
  process.env.NO_PROXY = "127.0.0.1";
  const dest = join(String(dir), "dep.tar.gz");

  const { lines } = await withLogCaptured(() => downloadWithRetry(server.url, dest, "dep", noBackoff));

  expect(readFileSync(dest, "utf8")).toBe(BODY);
  expect(lines).toEqual([]);
  expect(server.paths).toEqual(["/dep.tar.gz"]);
  expect(proxy.traffic).toEqual({ connections: 0, requests: 0 });
});

test("proxyEnvironment() rewrites the settings into the form the Agent's parser accepts", () => {
  expect(
    proxyEnvironment({
      HTTPS_PROXY: "proxy.corp:3128",
      https_proxy: " http://proxy.corp:3128/ ",
      http_proxy: "socks5://proxy.corp:1080",
      HTTP_PROXY: "",
      NO_PROXY:
        "github.com, build-cache.corp ,.example.org,*.example.net,registry.corp:5000,127.0.0.1,10.0.0.1-10.0.0.9,*",
    }),
  ).toEqual({
    HTTPS_PROXY: "http://proxy.corp:3128",
    https_proxy: "http://proxy.corp:3128/",
    http_proxy: "socks5://proxy.corp:1080",
    NO_PROXY:
      "github.com,.github.com,build-cache.corp,.build-cache.corp,.example.org,*.example.net,registry.corp:5000,127.0.0.1,10.0.0.1-10.0.0.9,*",
  });
  expect(proxyEnvironment({ no_proxy: " , " })).toEqual({});
  expect(proxyEnvironment({})).toEqual({});
});

test("a proxy setting the Agent rejects fails the download once, before any attempt", async () => {
  using dir = tempDir("build-download-retry", {});
  await using server = await fakeServer([]);
  process.env.http_proxy = "http://proxy with spaces:3128";
  const dest = join(String(dir), "dep.tar.gz");

  const { result: err, lines } = await withLogCaptured(() =>
    rejection(downloadWithRetry(server.url, dest, "dep", noBackoff)),
  );

  expect((err as NodeJS.ErrnoException).code).toBe("ERR_PROXY_INVALID_CONFIG");
  expect(lines).toEqual([]);
  expect(server.traffic).toEqual({ connections: 0, requests: 0 });
  expect(existsSync(dest)).toBe(false);
});

test("giving up reports the attempt count and the failure that ended it", async () => {
  using dir = tempDir("build-download-retry", {});
  await using server = await fakeServer([], "drop");
  const dest = join(String(dir), "dep.tar.gz");

  const { result, lines } = await withLogCaptured(() =>
    rejection(downloadWithRetry(server.url, dest, "dep", noBackoff)),
  );
  const err = result as BuildError;

  expect(err).toBeInstanceOf(BuildError);
  expect(err.message).toBe(`Failed to download after ${downloadRetry.attempts} attempts: ${server.url}`);
  // The dropped connection is what the last attempt failed with; it must be
  // named both in the final report and on every retry line.
  const reason = describeError(err.cause);
  expect(reason).toMatch(droppedConnection);
  expect(err.format()).toContain(`cause: ${reason}`);
  expect(lines.map(line => line.replace(/ \(.*\)$/, ""))).toEqual(
    Array.from({ length: downloadRetry.attempts - 1 }, (_, i) => `retry ${i + 2}/${downloadRetry.attempts} in 0ms`),
  );
  for (const line of lines) expect(line).toMatch(droppedConnection);
  expect(server.traffic).toEqual({ connections: downloadRetry.attempts, requests: downloadRetry.attempts });
  expect(existsSync(dest)).toBe(false);
});

test("BuildError.format() prints the whole cause chain", () => {
  const err = new BuildError("Failed to download after 10 attempts: https://github.com/o/r/archive/abc.tar.gz", {
    hint: "Check network connectivity",
    cause: new BuildError("while fetching https://codeload.github.com/o/r/tar.gz/abc", {
      cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    }),
  });

  expect(err.format()).toBe(
    "error: Failed to download after 10 attempts: https://github.com/o/r/archive/abc.tar.gz\n" +
      "  hint: Check network connectivity\n" +
      "  cause: while fetching https://codeload.github.com/o/r/tar.gz/abc: ECONNRESET: socket hang up\n",
  );
});

test("describeError() flattens cause chains, AggregateErrors, codes, and non-Error causes", () => {
  expect(describeError("just a string")).toBe("just a string");
  expect(describeError(new Error("write failed", { cause: "ENOSPC" }))).toBe("write failed: ENOSPC");

  // node's shape for a connect that failed on every resolved address: the
  // AggregateError's own message is empty, the reasons are in .errors.
  const connect = new AggregateError([
    new Error("connect ETIMEDOUT 140.82.112.3:443"),
    new Error("connect ENETUNREACH 140.82.112.4:443"),
  ]);
  expect(describeError(new TypeError("fetch failed", { cause: connect }))).toBe(
    "fetch failed: connect ETIMEDOUT 140.82.112.3:443; connect ENETUNREACH 140.82.112.4:443",
  );

  // A code is added when the message does not already carry it.
  expect(describeError(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }))).toBe(
    "ECONNRESET: socket hang up",
  );
  expect(describeError(Object.assign(new Error("getaddrinfo ENOTFOUND github.com"), { code: "ENOTFOUND" }))).toBe(
    "getaddrinfo ENOTFOUND github.com",
  );

  const loop = new Error("loops");
  loop.cause = loop;
  expect(describeError(loop)).toBe("loops");
});
