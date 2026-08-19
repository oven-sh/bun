import { afterAll, beforeAll, jest, test } from "bun:test";
import dgram from "node:dgram";
import { promises as dnsPromises } from "node:dns";
import { once } from "node:events";

// c-ares expires queries on its own real clock; Bun's per-resolver poll timer
// (EventLoopTimer tag DNSResolver) only exists to call back into c-ares so it
// notices. Both tests run with fake timers installed and print one JSON line
// each, which test-timers.test.ts asserts on.

// Nothing answers on this port, so a query stays in flight until c-ares gives
// up on it or it is cancelled.
const server = dgram.createSocket("udp4");
let nameserver: string;

beforeAll(async () => {
  server.bind(0, "127.0.0.1");
  await once(server, "listening");
  nameserver = `127.0.0.1:${server.address().port}`;
});

afterAll(() => server.close());

test("runAllTimers() returns while a query is in flight", async () => {
  // With the poll timer in the fake heap, every pop re-arms it one fake second
  // later and runAllTimers() spins until c-ares gives the query up, so keep the
  // query alive well past the parent's spawn timeout: c-ares caps a single try
  // at 5s (MAX_TIMEOUT_MS in ares_metrics.c), hence the retries.
  const resolver = new dnsPromises.Resolver({ timeout: 5_000, tries: 10 });
  resolver.setServers([nameserver]);

  jest.useFakeTimers();
  try {
    const outcome = resolver.resolve4("silent.test").then(
      () => "resolved",
      e => e.code,
    );
    const timerCount = jest.getTimerCount();
    jest.runAllTimers();
    resolver.cancel();
    console.log(JSON.stringify({ test: "runAllTimers", timerCount, outcome: await outcome }));
  } finally {
    jest.useRealTimers();
  }
});

test("the poll timer is armed against the real clock", async () => {
  const resolver = new dnsPromises.Resolver({ timeout: 100, tries: 1 });
  resolver.setServers([nameserver]);

  jest.useFakeTimers();
  try {
    // Same trick as test-timers-gc-spin-fixture.ts: push the mocked monotonic
    // clock past any plausible machine uptime. A deadline derived from it would
    // sit years out in the real heap and the query would never be failed.
    for (let i = 0; i < 100; i++) jest.advanceTimersByTime(40 * 24 * 3600 * 1000);

    // Fake time stands still from here on, so the rejection has to come from
    // the poll timer firing on the real clock.
    const outcome = await resolver.resolve4("silent.test").then(
      () => "resolved",
      e => e.code,
    );
    console.log(JSON.stringify({ test: "realClock", outcome }));
  } finally {
    jest.useRealTimers();
  }
});
