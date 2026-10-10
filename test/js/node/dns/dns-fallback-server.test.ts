// When c-ares finds no nameserver at the first use of a resolver, it takes its
// built-in default, 127.0.0.1. The resolver used to keep that server for its
// whole life: every later query went to a server that nobody configured.
//
// Now a server that does not answer makes the next query read the system
// resolver config again, in place, while the list is still one the config can
// replace. Node does the same job in `ChannelWrap::EnsureServers` with a new
// channel.
//
// No network: every nameserver is a dgram socket in the fixture's process, and
// `BUN_INTERNAL_DNS_RESOLV_CONF` points c-ares at a file of the test in place
// of /etc/resolv.conf. c-ares reads that file on Linux (and FreeBSD) only, so
// the tests are for Linux.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import dgram from "node:dgram";
import { join } from "node:path";

const fixture = join(import.meta.dir, "dns-fallback-server-fixture.ts");

// Runs one group of scenarios in a process of its own. A group that holds every
// file descriptor gets a small limit, so that there are few to open.
//
// The tests are not concurrent: each spawns a debug or ASAN build that loads
// the dns and dgram builtins, which takes seconds, and six of those at once
// take longer than the default timeout allows.
async function run(group: string, options: { nofile?: number } = {}) {
  using dir = tempDir(`dns-fallback-${group}`, { "resolv.conf": "" });
  const conf = join(String(dir), "resolv.conf");
  const cmd = [bunExe(), fixture, group, conf];
  await using proc = Bun.spawn({
    cmd: options.nofile ? ["/bin/sh", "-c", `ulimit -n ${options.nofile} && exec "$@"`, "sh", ...cmd] : cmd,
    env: { ...bunEnv, BUN_INTERNAL_DNS_RESOLV_CONF: conf },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim().split("\n"), stderr: stderr.trim(), exitCode };
}

// One line for each scenario of the group, in order.
const printed = (scenarios: Record<string, unknown>) => ({
  stdout: Object.entries(scenarios).map(([name, result]) => JSON.stringify({ [name]: result })),
  stderr: "",
  exitCode: 0,
});

// The server that c-ares falls back to must refuse, which it does when nothing
// listens on 127.0.0.1:53. A machine with a DNS server there answers instead.
async function defaultServerRefuses() {
  const socket = dgram.createSocket("udp4");
  const { promise, resolve } = Promise.withResolvers<boolean>();
  socket.on("error", error => resolve((error as NodeJS.ErrnoException).code === "ECONNREFUSED"));
  socket.on("message", () => resolve(false));
  socket.connect(53, "127.0.0.1", () => {
    // A query for the A record of "a".
    socket.send(Buffer.from([0x12, 0x34, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0x61, 0, 0, 1, 0, 1]));
  });
  // A server that listens and says nothing gives neither event.
  const timer = setTimeout(resolve, 3000, false);
  try {
    return await promise;
  } finally {
    clearTimeout(timer);
    socket.close();
  }
}
const canRefuse = isLinux && (await defaultServerRefuses());

// A resolver that starts with an empty config, which names a nameserver after
// the second query.
const filledIn = (first: string, answer: unknown) => ({
  first,
  stillEmpty: first,
  serversWhileEmpty: ["127.0.0.1"],
  second: answer,
  third: answer,
  recovered: true,
});

describe.skipIf(!canRefuse)("a resolver with no nameserver of its own", () => {
  test("reads the config again after a query that nothing answered", async () => {
    const step = { code: "ECONNREFUSED", servers: ["127.0.0.1"] };
    expect(await run("empty-config")).toEqual(
      printed({
        "Resolver.resolve4": filledIn("ECONNREFUSED", ["10.20.0.1"]),
        // c-ares reports a refused reverse lookup as "not found".
        "Resolver.reverse": filledIn("ENOTFOUND", ["host.example.test"]),
        // A config whose only nameserver is unusable leaves the servers alone.
        "unusable-nameserver": [step, step, step],
        // The local address of the resolver survives the read.
        "local-address": { first: "ECONNREFUSED", second: ["10.20.0.1"], from: ["127.0.0.2"] },
      }),
    );
  });

  test("recovers dns.lookupService", async () => {
    expect(await run("empty-config-service")).toEqual(
      printed({ "dns.lookupService": filledIn("ENOTFOUND", "host.example.test") }),
    );
  });

  test("recovers Bun.dns.lookup, and applies the whole config", async () => {
    expect(await run("empty-config-lookup")).toEqual(
      printed({
        "Bun.dns.lookup": filledIn("DNS_ECONNREFUSED", ["10.20.0.1"]),
        "search-list": {
          first: "DNS_ECONNREFUSED",
          second: ["10.20.0.1"],
          // The search list of the new config: "one" with the suffix, for A and AAAA.
          asked: ["one.new.example", "one.new.example"],
        },
      }),
    );
  });

  test("replaces the servers while c-ares uses them", async () => {
    expect(await run("replace-servers")).toEqual(
      printed({
        "one-loopback-server": { first: "ECONNREFUSED", second: ["10.20.0.1"], recovered: true },
        "inside-a-callback": {
          refused: "ECONNREFUSED",
          outer: ["10.20.0.1"],
          inside: ["10.20.0.1"],
          after: ["10.20.0.2"],
        },
      }),
    );
  });

  test("moves a query in flight to the new server", async () => {
    expect(await run("replace-servers-more")).toEqual(
      printed({
        "query-in-flight": {
          refused: "ECONNREFUSED",
          after: ["10.20.0.2"],
          // The held query moved to the new server, which answered it.
          moved: ["10.20.0.2"],
          asked: ["held.example.test", "after.example.test"],
        },
        "query-in-flight-last-try": {
          refused: "ECONNREFUSED",
          after: ["10.20.0.2"],
          // With one try the move ends the query instead.
          moved: "ETIMEOUT",
          asked: ["after.example.test"],
        },
      }),
    );
  });
});

describe.skipIf(!isLinux)("a resolver whose servers are final", () => {
  test("does not read the config again", async () => {
    expect(await run("final")).toEqual(
      printed({
        "user-set-servers": {
          answers: [["10.20.0.1"], ["10.20.0.1"]],
          refused: "ECONNREFUSED",
          unchanged: true,
          // The second answer came from the query cache, which a read empties.
          asked: ["cached.example.test", "truncated.example.test"],
        },
        "one-other-server": { codes: ["ECONNREFUSED", "ECONNREFUSED"], unchanged: true, asked: [] },
        "two-servers": { codes: ["ECONNREFUSED", "ECONNREFUSED"], unchanged: true, asked: [] },
      }),
    );
  });

  test("after a query that a server answered, and after dns.setServers", async () => {
    expect(await run("final-more")).toEqual(
      printed({
        // A server that answers with no record is a server that answers.
        "answered-query": { empty: "ENOTFOUND", second: ["10.20.0.1"], unchanged: true, asked: [] },
        "dns.setServers": {
          answers: [["10.20.0.1"], ["10.20.0.1"]],
          refused: "ECONNREFUSED",
          unchanged: true,
          asked: ["cached.example.test", "truncated.example.test"],
        },
      }),
    );
  });
});

test.skipIf(!canRefuse)("a resolver whose first use has no file descriptor reads the config again", async () => {
  expect(await run("no-file-descriptors", { nofile: 128 })).toEqual(
    printed({
      "no-file-descriptors": {
        first: "ECONNREFUSED",
        stillHeld: "ECONNREFUSED",
        serversWhileHeld: ["127.0.0.1"],
        second: ["10.20.0.1"],
        recovered: true,
      },
    }),
  );
});
