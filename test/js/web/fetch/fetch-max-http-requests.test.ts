// `BUN_CONFIG_MAX_HTTP_REQUESTS` (`MAX_SIMULTANEOUS_REQUESTS` in
// src/http/AsyncHTTP.rs) is a *per-origin* cap on in-flight requests, with a
// process-wide ceiling of `MAX_TOTAL_REQUESTS_MULTIPLIER` (4) times it above.
// It used to be a single process-global cap, so one origin that accepted
// connections but never responded would hold every slot and a fetch to a
// completely different, healthy origin could never even connect.
//
// Each test runs in a child process so BUN_CONFIG_MAX_HTTP_REQUESTS can be set
// without affecting the rest of the suite.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Keep in sync with `MAX_TOTAL_REQUESTS_MULTIPLIER` in src/http/AsyncHTTP.rs.
const MAX_TOTAL_REQUESTS_MULTIPLIER = 4;

async function run(cap: number, fixture: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: { ...bunEnv, BUN_CONFIG_MAX_HTTP_REQUESTS: String(cap) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // ASAN debug builds unconditionally print a signal-handler warning to
  // stderr at startup; ignore that line.
  const stderrLines = stderr
    .split("\n")
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  return { stdout: stdout.trim().split("\n"), stderr: stderrLines, exitCode };
}

// Origin A accepts 2 connections and never responds, using up its whole
// per-origin budget. A fetch to origin B must still connect and complete while
// both of A's are in flight; with a process-global cap it never even connects.
test.concurrent("a stalled origin does not block fetches to other origins", async () => {
  const fixture = /* js */ `
    import { createServer } from "net";
    import { once } from "events";

    const stalledSockets = [];
    const originA = createServer(socket => {
      stalledSockets.push(socket);
    });
    originA.listen(0);
    await once(originA, "listening");
    const portA = originA.address().port;

    const originB = Bun.serve({ port: 0, fetch: () => new Response("ok-from-B") });

    // Saturate origin A's per-origin budget (BUN_CONFIG_MAX_HTTP_REQUESTS=2).
    const stalled = [fetch("http://127.0.0.1:" + portA + "/a0"), fetch("http://127.0.0.1:" + portA + "/a1")];
    for (const request of stalled) request.catch(() => {});
    while (stalledSockets.length < 2) await new Promise(r => setImmediate(r));

    // Origin B is a different origin, so this must not queue behind A.
    const body = await fetch("http://127.0.0.1:" + originB.port + "/b").then(r => r.text());
    console.log("originB:", body);
    console.log("originA still in flight:", stalled.map(p => Bun.peek.status(p)).join(","));

    for (const socket of stalledSockets) socket.destroy();
    await Promise.allSettled(stalled);
    process.exit(0);
  `;
  expect(await run(2, fixture)).toEqual({
    stdout: ["originB: ok-from-B", "originA still in flight: pending,pending"],
    stderr: "",
    exitCode: 0,
  });
});

// The per-origin cap must still be enforced. The server holds every response
// until released, so with a cap of 1 the second fetch can only reach it after
// the first finishes: the server never sees more than one unanswered request.
test.concurrent("requests to the same origin still queue behind the per-origin cap", async () => {
  const fixture = /* js */ `
    import { createServer } from "http";
    import { once } from "events";

    let unanswered = 0;
    let maxUnanswered = 0;
    const gate = Promise.withResolvers();
    const server = createServer(async (req, res) => {
      unanswered++;
      if (unanswered > maxUnanswered) maxUnanswered = unanswered;
      await gate.promise;
      unanswered--;
      res.end(req.url);
    });
    server.listen(0);
    await once(server, "listening");
    const origin = "http://127.0.0.1:" + server.address().port;

    const first = fetch(origin + "/1").then(r => r.text());
    const second = fetch(origin + "/2").then(r => r.text());
    while (maxUnanswered < 1) await new Promise(r => setImmediate(r));
    gate.resolve();

    console.log("bodies:", await first, await second);
    console.log("maxUnanswered:", maxUnanswered);
    process.exit(0);
  `;
  expect(await run(1, fixture)).toEqual({
    stdout: ["bodies: /1 /2", "maxUnanswered: 1"],
    stderr: "",
    exitCode: 0,
  });
});

// The process-wide ceiling (4x the per-origin cap) bounds in-flight requests
// across origins. With a per-origin cap of 1 and six distinct origins, only
// four may be connected-and-unanswered at once; the fifth and sixth start only
// after earlier ones finish, so the high-water mark is exactly the ceiling.
test.concurrent("the process-wide ceiling bounds in-flight requests across origins", async () => {
  const fixture = /* js */ `
    import { createServer } from "http";
    import { once } from "events";

    let unanswered = 0;
    let maxUnanswered = 0;
    const gate = Promise.withResolvers();
    const servers = [];
    for (let i = 0; i < 6; i++) {
      const server = createServer(async (req, res) => {
        unanswered++;
        if (unanswered > maxUnanswered) maxUnanswered = unanswered;
        await gate.promise;
        unanswered--;
        res.end(req.url);
      });
      server.listen(0);
      await once(server, "listening");
      servers.push(server);
    }

    const pending = servers.map((server, i) =>
      fetch("http://127.0.0.1:" + server.address().port + "/" + i).then(r => r.text()),
    );
    while (maxUnanswered < ${MAX_TOTAL_REQUESTS_MULTIPLIER}) await new Promise(r => setImmediate(r));
    gate.resolve();

    console.log("bodies:", (await Promise.all(pending)).join(" "));
    console.log("maxUnanswered:", maxUnanswered);
    process.exit(0);
  `;
  expect(await run(1, fixture)).toEqual({
    stdout: ["bodies: /0 /1 /2 /3 /4 /5", `maxUnanswered: ${MAX_TOTAL_REQUESTS_MULTIPLIER}`],
    stderr: "",
    exitCode: 0,
  });
});
