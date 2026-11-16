import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun } from "harness";
import { join } from "path";

test.concurrent("expect dns.lookup to keep the process alive", async () => {
  expect(await bunRun(join(import.meta.dir, "dns-fixture.js"))).toSpawn();
});

// When the last outstanding query on a Resolver completes via the retransmit
// timer (c-ares timeout, not socket I/O), `check_timeouts` must not leave the
// timer re-armed: `request_completed` runs inside the c-ares callback, before
// c-ares has detached the query, so `any_requests_pending()` can still read
// true there. Without the post-`ares_process_fd` re-check the timer stays
// ACTIVE with its `+1` ref on the native Resolver. Observable as a ~1 s tail
// between the last callback and process exit; under `bun test` on the asan
// lane the exit GC runs before that timer fires and LSan flags the Resolver
// allocation as a direct leak.
describe("dns.Resolver does not keep the event loop alive after the last query times out", () => {
  async function run(stmt: string) {
    const src = `
      const dns = require("node:dns");
      const dgram = require("node:dgram");
      const sock = dgram.createSocket("udp4");
      sock.bind(0, "127.0.0.1", () => {
        const r = new dns.Resolver({ timeout: 100, tries: 1 });
        r.setServers(["127.0.0.1:" + sock.address().port]);
        let cb_t, code;
        const done = err => { cb_t = Date.now(); code = err && err.code; sock.close(); };
        ${stmt}
        process.on("exit", () => {
          console.log(JSON.stringify({ delay: Date.now() - cb_t, code }));
        });
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return JSON.parse(stdout.trim()) as { delay: number; code: string };
  }

  for (const [name, stmt, expected] of [
    ["resolveCaa", `r.resolveCaa("x.invalid", done);`, "ETIMEOUT"],
    ["resolve4", `r.resolve4("x.invalid", done);`, "ETIMEOUT"],
    // ares_gethostbyaddr swallows the PTR query status and reports ENOTFOUND
    // after the file-lookup fallback; the PTR query itself still completes
    // via the retransmit timer.
    ["reverse", `r.reverse("192.0.2.1", done);`, "ENOTFOUND"],
  ] as const) {
    test.concurrent(name, async () => {
      const { delay, code } = await run(stmt);
      // ETIMEOUT proves completion routed through `check_timeouts`
      // (the path changed here), not `on_dns_poll`.
      expect(code).toBe(expected);
      // Before the fix: delay ≈ 1000 ms (one retransmit-timer interval).
      expect(delay).toBeLessThan(500);
    });
  }
});

describe("a settled query does not keep the event loop alive", () => {
  const script = (query: string) => `
    import { getEventLoopStats } from "bun:internal-for-testing";
    import dgram from "node:dgram";
    import dns from "node:dns";

    // Answers only a question that contains "answered": with A 10.0.0.1, then 10.0.0.2, and so on.
    let answers = 0;
    const server = dgram.createSocket("udp4").on("message", (message, { port, address }) => {
      if (!message.includes("answered")) return;
      const header = [message[0], message[1], 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0];
      const question = message.subarray(12, message.indexOf(0, 12) + 5);
      const answer = [0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 10, 0, 0, ++answers];
      server.send(Buffer.from([...header, ...question, ...answer]), port, address);
    });

    server.bind(0, "127.0.0.1", async () => {
      server.unref();
      dns.setServers(["127.0.0.1:" + server.address().port]);
      const resolver = new dns.promises.Resolver();
      resolver.setServers(dns.getServers());

      const outcome = await (async () => { ${query} })().catch(e => e.code);
      // libuv needs some turns to close the sockets of c-ares. The resolver's timer runs for 1000 ms.
      const deadline = performance.now() + 500;
      do await new Promise(resolve => setImmediate(resolve));
      while (getEventLoopStats().loopActive && performance.now() < deadline);
      console.log(JSON.stringify({ outcome, loopActive: getEventLoopStats().loopActive }));
    });
  `;

  // For a literal of the other family glibc reports EAI_ADDRFAMILY, others EAI_NONAME or EAI_NODATA.
  const wrongFamily = expect.stringMatching(/^DNS_(EBADFAMILY|ENOTFOUND)$/);

  test.concurrent.each([
    ["the system's resolver fails", `return Bun.dns.lookup("::1", { family: 4, backend: "libc" })`, wrongFamily],
    [
      "the system's resolver fails after a c-ares query ends",
      `const system = Bun.dns.lookup("::1", { family: 4, backend: "libc" }).catch(e => e.code);
       await Bun.dns.lookup("127.0.0.1", { backend: "c-ares" });
       return system`,
      wrongFamily,
    ],
    [
      "reverse is cancelled",
      `const query = resolver.reverse("192.0.2.1"); resolver.cancel(); return query`,
      "ECANCELLED",
    ],
    [
      "a c-ares lookup loses its servers",
      `const query = Bun.dns.lookup("ignored.test.", { backend: "c-ares" }); dns.setServers([]); return query`,
      "DNS_ETIMEOUT",
    ],
    [
      "repeated c-ares queries do not remain cached",
      `return [await resolver.resolve4("answered.test"), await resolver.resolve4("answered.test")]`,
      [["10.0.0.1"], ["10.0.0.2"]],
    ],
    [
      "c-ares answers without asking a server",
      `dns.setServers([]);
       const queries = [
         Bun.dns.lookup("127.0.0.1", { backend: "c-ares" }),
         Bun.dns.lookup("a.onion", { backend: "c-ares" }),
         dns.promises.resolve4("a.test"),
         dns.promises.reverse("192.0.2.1"),
         dns.promises.lookupService("192.0.2.1", 80),
       ];
       return Promise.all(queries.map(query => query.catch(e => e.code)))`,
      [[{ address: "127.0.0.1", family: 4, ttl: 0 }], "DNS_ENOTFOUND", "ENOSERVER", "ENOTFOUND", "ENOTFOUND"],
    ],
    [
      "sending a query fails the one in flight",
      `const closed = dgram.createSocket("udp4");
       await new Promise(resolve => closed.bind(0, "127.0.0.1", resolve));
       const refused = new dns.promises.Resolver({ timeout: 100, tries: 1 });
       refused.setServers(["127.0.0.1:" + closed.address().port]);
       await new Promise(resolve => closed.close(resolve));
       return Promise.all(["192.0.2.1", "192.0.2.2"].map(ip => refused.reverse(ip).catch(e => e.code)))`,
      ["ENOTFOUND", "ENOTFOUND"],
    ],
  ])("%s", async (_, query, outcome) => {
    const result = await bunRun(["-e", script(query)]);
    expect({ ...result, stdout: result.stdout && JSON.parse(result.stdout) }).toEqual({
      stdout: { outcome, loopActive: false },
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});

test.concurrent("a query that c-ares answers without asking a server takes a turn of the event loop", async () => {
  const script = `
    const resolver = new (require("node:dns").Resolver)();
    resolver.setServers([]);
    let count = 0;
    process.on("beforeExit", () => {
      console.log("beforeExit", ++count);
      if (count === 1) Bun.dns.lookup("127.0.0.1", { backend: "c-ares" }).then(([{ address }]) => console.log(address));
      if (count === 2) resolver.resolve4("a.test", error => console.log(error.code));
    });
  `;
  expect(await bunRun(["-e", script])).toSpawn("beforeExit 1\n127.0.0.1\nbeforeExit 2\nENOSERVER\nbeforeExit 3");
});
