import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, tempDir } from "harness";
import { join } from "path";

test.concurrent("expect dns.lookup to keep the process alive", async () => {
  expect(await bunRun(join(import.meta.dir, "dns-fixture.js"))).toSpawn();
});

// When the last query times out, `check_timeouts` must not arm the timer again: it holds a ref on the
// native Resolver. That shows as a ~1 s tail before the process exits, and as a leak under LSan.
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
      // ETIMEOUT proves completion routed through `check_timeouts`, not `on_dns_poll`.
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
      "c-ares answers from its cache",
      `return [await resolver.resolve4("answered.test"), await resolver.resolve4("answered.test")]`,
      [["10.0.0.1"], ["10.0.0.1"]],
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

describe("script does not run inside c-ares", () => {
  const script = (body: string) => `
    const dns = require("node:dns");
    // Answers A with 10.0.0.1 and drops AAAA.
    const AAAA = 28;
    let droppedAAAA = false;
    const server = await Bun.udpSocket({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket, query, port, address) {
          const end = query.indexOf(0, 12) + 5;
          if (query[end - 3] === AAAA) return void (droppedAAAA = true);
          const header = [query[0], query[1], 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0];
          const answer = [0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 10, 0, 0, 1];
          socket.send(Buffer.from([...header, ...query.subarray(12, end), ...answer]), port, address);
        },
      },
    });
    const servers = ["127.0.0.1:" + server.port];
    ${body}
  `;

  // AAAA is dropped, so the lookup succeeds when the resolver's timer gives up on it.
  describe("a lookup that the timeout check answers", () => {
    const lookup = (continuation: string) =>
      script(`
        dns.setServers(servers);
        // After three fast answers c-ares waits 250 ms for this server, not 2 s.
        for (const name of ["a.test", "b.test", "c.test"]) await dns.promises.resolve4(name);
        const first = Bun.dns.lookup("v4.test.", { backend: "c-ares" });
        const joined = Bun.dns.lookup("v4.test.", { backend: "c-ares" });
        await first;
        if (droppedAAAA) console.log("dropped AAAA");
        ${continuation}
      `);

    test.concurrent("can wait for another query in a nested turn of the loop", async () => {
      // Bun.build() turns the loop until setup() settles.
      const continuation = `
        const setup = () => dns.promises.resolve4("nested.test").then(([address]) => console.log(address));
        await Bun.build({ entrypoints: ["/e.js"], files: { "/e.js": "" }, plugins: [{ name: "spin", setup }] });
        server.close();
      `;
      expect(await bunRun(["-e", lookup(continuation)])).toSpawn("dropped AAAA\n10.0.0.1");
    });

    test.concurrent("can tear down the VM", async () => {
      const result = await bunRun(["-e", lookup(`console.log("exit"); process.exit(0);`)], {
        BUN_DESTRUCT_VM_ON_EXIT: "1",
      });
      expect(result).toSpawn("dropped AAAA\nexit");
    });

    test.concurrent("settles the lookups that joined it before a continuation runs", async () => {
      expect(await bunRun(["-e", lookup(`console.log(Bun.peek.status(joined)); server.close();`)])).toSpawn(
        "dropped AAAA\nfulfilled",
      );
    });
  });

  describe("a resolver's graph is disposed", () => {
    const withGraph = (body: string) =>
      script(`
        const graph = new Bun.ModuleGraph();
        const resolver = graph.run(() => new dns.promises.Resolver());
        resolver.setServers(servers);
        ${body}
        server.close();
      `);

    test.concurrent.each([
      { source: "a socket event", before: "" },
      { source: "the cache of c-ares", before: `await resolver.resolve4("a.test");` },
    ])("by a `then` getter of an answer from $source", async ({ before }) => {
      const body = `
        ${before}
        Object.defineProperty(Array.prototype, "then", {
          get() {
            if (!this[0]?.address) return;
            console.log("dispose");
            graph.dispose();
          },
        });
        console.log((await resolver.resolve4("a.test"))[0]);
      `;
      expect(await bunRun(["-e", withGraph(body)])).toSpawn("dispose\n10.0.0.1");
    });

    test.concurrent("by the coercion of setServers()'s argument", async () => {
      const body = `
        resolver._handle.setServers([[{ valueOf: () => (graph.dispose(), 4) }, "127.0.0.2", 53]]);
        console.log(resolver.getServers()[0]);
      `;
      expect(await bunRun(["-e", withGraph(body)])).toSpawn("127.0.0.2");
    });

    test.concurrent("by a microtask of a beforeExit listener that queries", async () => {
      const body = `
        await resolver.resolve4("a.test");
        process.once("beforeExit", () => {
          queueMicrotask(() => graph.dispose());
          resolver.resolve4("a.test").then(([address]) => console.log(address));
        });
      `;
      expect(await bunRun(["-e", withGraph(body)])).toSpawn("10.0.0.1");
    });
  });
});

test.concurrent.each(["beforeExit", "exit"])(
  "a query that c-ares answers inside the call runs no microtask of the %s listener that made it",
  async event => {
    const script = `
      process.once("${event}", () => {
        const ran = [];
        process.nextTick(() => ran.push("tick"));
        queueMicrotask(() => ran.push("microtask"));
        Bun.dns.lookup("127.0.0.1", { backend: "c-ares" });
        console.log(JSON.stringify(ran));
      });
    `;
    expect(await bunRun(["-e", script])).toSpawn("[]");
  },
);

test.concurrent("a query that c-ares answers inside the call runs no microtask of a test body", async () => {
  using dir = tempDir("dns-test-body", {
    "body.test.js": `
      test("queries after an await", async () => {
        await 1;
        const ran = [];
        process.nextTick(() => ran.push("tick"));
        queueMicrotask(() => ran.push("microtask"));
        Bun.dns.lookup("127.0.0.1", { backend: "c-ares" });
        console.log(JSON.stringify(ran));
      });
    `,
  });
  const { stdout, exitCode } = await bunRun(["test", join(String(dir), "body.test.js")]);
  expect(stdout.split("\n").at(-1)).toBe("[]");
  expect(exitCode).toBe(0);
});
