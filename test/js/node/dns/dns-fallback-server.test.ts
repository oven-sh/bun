// When c-ares finds no nameserver at the first use of a resolver, it takes its
// built-in default, 127.0.0.1. The resolver used to keep that server for its
// whole life: every later query went to a server that nobody configured.
//
// Now a refused query on that server makes the next query read the system
// resolver config again, in place. Node does the same job in
// `ChannelWrap::EnsureServers` with a new channel.
//
// No network: every nameserver is a dgram socket in the fixture's process, and
// `dnsSetResolvConf` of bun:internal-for-testing points c-ares at a file of the
// test in place of /etc/resolv.conf. c-ares reads that file on Linux (and
// FreeBSD) only, so the tests are for Linux.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import dgram from "node:dgram";
import dns from "node:dns";
import { join } from "node:path";

const fixture = join(import.meta.dir, "dns-fallback-server-fixture.ts");

// Runs one group of scenarios in a process of its own. A group that holds
// every file descriptor gets a small limit, so that there are few to open.
async function run(group: string, options: { nofile?: number } = {}) {
  using dir = tempDir("dns-fallback-server", { "resolv.conf": "" });
  const cmd = [bunExe(), fixture, group, join(String(dir), "resolv.conf")];
  await using proc = Bun.spawn({
    cmd: options.nofile ? ["/bin/sh", "-c", `ulimit -n ${options.nofile} && exec "$@"`, "sh", ...cmd] : cmd,
    env: bunEnv,
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

// What c-ares reads from the real config of this machine.
const systemServers = dns.getServers();

const refused = ["ECONNREFUSED", "ECONNREFUSED", "ECONNREFUSED"];
// A resolver that starts with an empty config, which names a nameserver after the first query.
const filledIn = (first: string, answer: unknown) => ({
  first,
  serversDuring: ["127.0.0.1"],
  second: answer,
  third: answer,
  recovered: true,
});

// Each test is one debug or ASAN build that starts and loads the dns and dgram
// builtins, which takes seconds on a busy machine. The scenarios take milliseconds.
const timeout = 30_000;

test.concurrent.skipIf(!isLinux)(
  "a resolver whose first use has no file descriptor reads the config again after a refused query",
  async () => {
    expect(await run("no-file-descriptors", { nofile: 128 })).toEqual(
      printed({
        // The real config of the machine, for a `Resolver` and for the `dns` module.
        "system-config": {
          first: ["ECONNREFUSED", "ECONNREFUSED"],
          serversDuring: [["127.0.0.1"], ["127.0.0.1"]],
          second: ["ENOTFOUND", "ENOTFOUND"],
          serversAfter: [systemServers, systemServers],
        },
        "no-file-descriptors": {
          first: "ECONNREFUSED",
          serversDuring: ["127.0.0.1"],
          second: ["10.20.0.1"],
          recovered: true,
        },
        "user-set-servers": {
          answers: [["10.20.0.1"], ["10.20.0.1"]],
          refused: "ECONNREFUSED",
          unchanged: true,
          // The second answer came from the query cache.
          asked: ["cached.example.test"],
        },
        // Node's rule: a list from the system config is read again only while it is one loopback server.
        "one-loopback-server": { first: "ECONNREFUSED", second: ["10.20.0.1"], recovered: true },
        "two-servers": { codes: refused, unchanged: true, asked: [] },
        "inside-a-callback": {
          refused: "ECONNREFUSED",
          outer: ["10.20.0.1"],
          inside: ["10.20.0.1"],
          after: ["10.20.0.2"],
        },
      }),
    );
  },
  timeout,
);

test.concurrent.skipIf(!canRefuse)(
  "a resolver that starts with an empty config asks the nameserver that the config names later",
  async () => {
    const step = { code: "ECONNREFUSED", servers: ["127.0.0.1"] };
    expect(await run("empty-config")).toEqual(
      printed({
        // c-ares reports a refused reverse lookup as "not found".
        "dns.lookupService": filledIn("ENOTFOUND", "host.example.test"),
        "Resolver.resolve4": filledIn("ECONNREFUSED", ["10.20.0.1"]),
        "Resolver.reverse": filledIn("ENOTFOUND", ["host.example.test"]),
        "unusable-nameserver": [step, step, step],
        "local-address": { first: "ECONNREFUSED", second: ["10.20.0.1"], from: ["127.0.0.2"] },
      }),
    );
  },
  timeout,
);

test.concurrent.skipIf(!canRefuse)(
  "Bun.dns.lookup with an empty config asks the nameserver that the config names later",
  async () => {
    expect(await run("empty-config-lookup")).toEqual(
      printed({ "Bun.dns.lookup": filledIn("DNS_ECONNREFUSED", ["10.20.0.1"]) }),
    );
  },
  timeout,
);
