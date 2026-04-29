import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";

// The c-ares pending-host cache is a fixed 32-slot HiveArray. When >32 unique
// hostnames are in flight concurrently the overflow requests bypass the cache
// (`.disabled`) and complete via DNSLookup.processGetAddrInfo, which previously
// never freed the c_ares.AddrInfo result (the cached path does, in
// drainPendingHostCares). This test points the global c-ares channel at a
// local UDP DNS server, fires >32 unique concurrent lookups per round so the
// overflow path is taken every round, and asserts RSS stays bounded.
//
// c-ares getaddrinfo is only reachable via Bun.dns.lookup({backend:"c-ares"})
// which uses the global resolver; on Windows the default backend is libuv
// and the channel/poll plumbing differs, so keep this posix-only.
describe.skipIf(isWindows)("Bun.dns.lookup c-ares backend", () => {
  const fixture = /* js */ `
    const dgram = require("node:dgram");
    const dns = require("node:dns");

    // Tiny DNS server: replies to any A query with RECORDS× 127.0.0.N (TTL=0
    // so c-ares' internal qcache can't serve it synchronously next round).
    // Multiple records => multiple ares_addrinfo_node + sockaddr allocations
    // per leaked result, so the leak is visible in fewer rounds. NXDOMAIN for
    // anything else.
    const RECORDS = Number(process.env.RECORDS ?? 30);
    const CONCURRENCY = Number(process.env.CONCURRENCY ?? 64); // > 32 so every round overflows
    const WARMUP_MS = Number(process.env.WARMUP_MS ?? 4000);
    const MEASURE_MS = Number(process.env.MEASURE_MS ?? 8000);

    const answer = Buffer.alloc(RECORDS * 16);
    for (let i = 0; i < RECORDS; i++) {
      const o = i * 16;
      answer[o + 0] = 0xc0; answer[o + 1] = 0x0c; // name: pointer to question
      answer[o + 2] = 0x00; answer[o + 3] = 0x01; // TYPE A
      answer[o + 4] = 0x00; answer[o + 5] = 0x01; // CLASS IN
      // TTL = 0 (bytes 6..9)
      answer[o + 10] = 0x00; answer[o + 11] = 0x04; // RDLENGTH 4
      answer[o + 12] = 0x7f; answer[o + 15] = (i + 1) & 0xff; // 127.0.0.N
    }
    const server = dgram.createSocket("udp4");
    server.on("message", (msg, rinfo) => {
      if (msg.length < 12) return;
      const id = msg.subarray(0, 2);
      let q = 12;
      while (q < msg.length && msg[q] !== 0) q += msg[q] + 1;
      q += 1; // root label
      const qtype = msg.readUInt16BE(q);
      const question = msg.subarray(12, q + 4);
      if (qtype === 1 /* A */) {
        const header = Buffer.from([
          id[0], id[1],
          0x81, 0x80,                             // QR=1 RD=1 RA=1 RCODE=0
          0x00, 0x01,                             // QDCOUNT
          (RECORDS >> 8) & 0xff, RECORDS & 0xff,  // ANCOUNT
          0x00, 0x00, 0x00, 0x00,                 // NSCOUNT, ARCOUNT
        ]);
        server.send(Buffer.concat([header, question, answer]), rinfo.port, rinfo.address);
      } else {
        const header = Buffer.from([
          id[0], id[1],
          0x81, 0x83, // QR=1 RD=1 RA=1 RCODE=3 (NXDOMAIN)
          0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ]);
        server.send(Buffer.concat([header, question]), rinfo.port, rinfo.address);
      }
    });

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.bind(0, "127.0.0.1", resolve);
    });

    // Point the global resolver's c-ares channel at our server.
    dns.setServers(["127.0.0.1:" + server.address().port]);

    // Long hostnames: ares_getaddrinfo dup's the name into ai->name, so this
    // adds ~180 bytes to every leaked result on top of the nodes.
    const pad = "x".repeat(50);
    async function round(r) {
      // Unique hostnames every round: defeats both Bun's pending-cache dedup
      // and c-ares' qcache, so every round re-dispatches all CONCURRENCY
      // queries and (CONCURRENCY - 32) of them take the non-cached path.
      const hosts = Array.from(
        { length: CONCURRENCY },
        (_, i) => \`\${pad}\${i}.\${pad}r\${r}.\${pad}a.bun-leak-test.invalid\`,
      );
      await Promise.all(
        hosts.map(h => Bun.dns.lookup(h, { backend: "c-ares", family: 4 })),
      );
    }

    // Time-budget the workload so it fits both release and debug/ASAN builds.
    // Take two equal-length measurement windows after warmup: a fixed build
    // plateaus (second-half growth ≈ 0) while a leaking build grows linearly
    // (second-half growth ≈ first-half growth).
    let r = 0;
    const warmupEnd = Date.now() + WARMUP_MS;
    while (Date.now() < warmupEnd) await round(r++);
    Bun.gc(true);
    const rss0 = process.memoryUsage.rss();

    const half1End = Date.now() + MEASURE_MS;
    while (Date.now() < half1End) await round(r++);
    Bun.gc(true);
    const rss1 = process.memoryUsage.rss();
    const r1 = r;

    const half2End = Date.now() + MEASURE_MS;
    while (Date.now() < half2End) await round(r++);
    Bun.gc(true);
    const rss2 = process.memoryUsage.rss();

    server.close();
    console.log(JSON.stringify({
      rounds: r,
      firstHalfRounds: r1,
      rssMB: [rss0, rss1, rss2].map(v => +(v / 1024 / 1024).toFixed(2)),
      firstHalfGrowthMB: +((rss1 - rss0) / 1024 / 1024).toFixed(2),
      secondHalfGrowthMB: +((rss2 - rss1) / 1024 / 1024).toFixed(2),
      totalGrowthMB: +((rss2 - rss0) / 1024 / 1024).toFixed(2),
    }));
  `;

  test("does not leak AddrInfo when the 32-slot pending cache overflows", async () => {
    using dir = tempDir("dns-cares-overflow-leak", { "leak.js": fixture });

    // Debug/ASAN builds are ~60x slower per round, so give them a much longer
    // budget. Release runs thousands of rounds in a few seconds; debug needs
    // the window to accumulate enough overflow requests for the leak (if
    // present) to dominate arena-settling noise.
    const env = {
      ...bunEnv,
      RECORDS: "30",
      CONCURRENCY: "64",
      WARMUP_MS: isDebug ? "15000" : "4000",
      MEASURE_MS: isDebug ? "45000" : "10000",
    };

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", "leak.js"],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const result = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
    console.log("dns-cares-overflow-leak:", result);
    expect(result.rounds).toBeGreaterThan(20);
    // On a leaking build each overflow request drops an ares_addrinfo with
    // 30 nodes + 30 sockaddrs + a ~180-byte name dup (~2 KB). With 32
    // overflows per round RSS climbs linearly through both measurement
    // halves. On a fixed build RSS plateaus during warmup so the combined
    // growth across both halves stays near zero.
    expect(result.totalGrowthMB).toBeLessThan(15);
    expect(exitCode).toBe(0);
  }, 180_000);
});
