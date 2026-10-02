// `bun dns-fallback-server-fixture.ts <group> <resolv.conf path>` runs the
// scenarios of one group, one after the other, and prints one line of JSON for
// each. The nameservers are dgram sockets in this process.
//
// A namespace import, so that the scenario without the resolv.conf override
// also runs on a build that does not have `dnsSetResolvConf`.
import * as internal from "bun:internal-for-testing";
import dgram from "node:dgram";
import dns from "node:dns";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";

const [group, conf] = process.argv.slice(2);

function encodeName(name: string) {
  return Buffer.concat([
    ...name.split(".").map(label => Buffer.from([label.length, ...Buffer.from(label)])),
    Buffer.from([0]),
  ]);
}

// Whether the TCP port `port` of 127.0.0.1 was free a moment ago.
async function tcpPortIsFree(port: number) {
  const server = net.createServer();
  const { promise, resolve } = Promise.withResolvers<boolean>();
  server.once("error", () => resolve(false));
  server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  return promise;
}

// Answers A with `ip`, PTR with host.example.test, and every other type with
// no record. Three names are special: "truncated.*" gets an answer with the TC
// bit, which makes c-ares ask again over TCP, where nothing listens. "held.*"
// gets its answer when `release()` is called. "cached.*" gets a TTL of 60, so
// c-ares keeps the answer in its query cache. Every other TTL is 0.
async function nameserver(
  ip: string,
  tcpClosed = false,
): Promise<{
  address: string;
  names: string[];
  from: string[];
  release: () => void;
  close: () => void;
}> {
  const socket = dgram.createSocket("udp4");
  const names: string[] = [];
  const from: string[] = [];
  const held: (() => void)[] = [];
  socket.on("message", (query, rinfo) => {
    const labels: string[] = [];
    let end = 12;
    while (end < query.length && query[end] !== 0) {
      labels.push(query.subarray(end + 1, end + 1 + query[end]).toString());
      end += query[end] + 1;
    }
    const name = labels.join(".");
    const type = query.readUInt16BE(end + 1);
    end += 1 + 2 + 2;
    names.push(name);
    from.push(rinfo.address);
    const truncated = name.startsWith("truncated");
    const ttl = name.startsWith("cached") ? 60 : 0;
    let rdata: Buffer | undefined;
    if (type === 1 && !truncated) rdata = Buffer.from(ip.split(".").map(Number));
    if (type === 12) rdata = encodeName("host.example.test");
    const answer = rdata
      ? Buffer.concat([Buffer.from([0xc0, 0x0c, 0, type, 0, 1, 0, 0, 0, ttl, 0, rdata.length]), rdata])
      : Buffer.alloc(0);
    const flags = truncated ? 0x83 : 0x81;
    const header = Buffer.from([query[0], query[1], flags, 0x80, 0, 1, 0, rdata ? 1 : 0, 0, 0, 0, 0]);
    const send = () => socket.send(Buffer.concat([header, query.subarray(12, end), answer]), rinfo.port, rinfo.address);
    if (name.startsWith("held")) held.push(send);
    else send();
  });
  socket.bind(0, "127.0.0.1");
  await once(socket, "listening");
  const { port } = socket.address();
  if (tcpClosed && !(await tcpPortIsFree(port))) {
    socket.close();
    return nameserver(ip, tcpClosed);
  }
  return {
    address: `127.0.0.1:${port}`,
    names,
    from,
    release: () => held.splice(0).forEach(send => send()),
    close: () => socket.close(),
  };
}

// A UDP port of 127.0.0.1 that refuses every datagram until `close()`. The
// socket keeps the port, so that no query socket gets it as its own port, and
// is connected elsewhere, so that it takes no datagram.
async function refusingUdpPort() {
  const socket = dgram.createSocket("udp4");
  socket.bind(0, "127.0.0.1");
  await once(socket, "listening");
  const address = `127.0.0.1:${socket.address().port}`;
  socket.connect(1, "127.0.0.1");
  await once(socket, "connect");
  return { address, close: () => socket.close() };
}

// Opens /dev/null until the process has no file descriptor left.
function holdAllFds() {
  const held: number[] = [];
  for (;;) {
    try {
      held.push(fs.openSync("/dev/null", "r"));
    } catch {
      break;
    }
  }
  return () => held.forEach(fd => fs.closeSync(fd));
}

const outcome = (query: Promise<unknown>) =>
  query.then(
    value => value,
    error => error.code as string,
  );

// c-ares reads `content` in place of /etc/resolv.conf from now on.
let overridden = false;
function config(content: string) {
  fs.writeFileSync(conf, content);
  if (!overridden) internal.dnsSetResolvConf(conf);
  overridden = true;
}

// The config is empty at the first use of the resolver that `query` uses, and
// names a nameserver afterwards.
async function emptyThenFilled(query: () => Promise<unknown>, servers: () => string[]) {
  const a = await nameserver("10.20.0.1");
  config("");
  const first = await outcome(query());
  const serversDuring = servers();
  config(`nameserver ${a.address}\n`);
  const second = await outcome(query());
  const third = await outcome(query());
  a.close();
  return { first, serversDuring, second, third, recovered: servers().join() === a.address };
}

const scenarios: Record<string, () => Promise<unknown>> = {
  // No override: c-ares reads the real system config, which it cannot open at
  // the first use of the two resolvers. The queries after the release must not
  // leave the machine, so they have a name that c-ares rejects by itself.
  async "system-config"() {
    const resolver = new dns.promises.Resolver();
    const unsendable = Buffer.alloc(1100, "a").toString();
    const release = holdAllFds();
    const first = [
      await outcome(resolver.resolve4("name.example.test")),
      await outcome(dns.promises.resolve4("name.example.test")),
    ];
    const serversDuring = [resolver.getServers(), dns.getServers()];
    release();
    const second = [await outcome(resolver.resolve4(unsendable)), await outcome(dns.promises.resolve4(unsendable))];
    return { first, serversDuring, second, serversAfter: [resolver.getServers(), dns.getServers()] };
  },

  // The config names a nameserver. The process has no file descriptor left at
  // the first use of the resolver.
  async "no-file-descriptors"() {
    const a = await nameserver("10.20.0.1");
    config(`nameserver ${a.address}\n`);
    const resolver = new dns.promises.Resolver();
    const release = holdAllFds();
    const first = await outcome(resolver.resolve4("name.example.test"));
    const serversDuring = resolver.getServers();
    release();
    const second = await outcome(resolver.resolve4("name.example.test"));
    a.close();
    return { first, serversDuring, second, recovered: resolver.getServers().join() === a.address };
  },

  "Resolver.resolve4"() {
    const resolver = new dns.promises.Resolver();
    return emptyThenFilled(
      () => resolver.resolve4("name.example.test"),
      () => resolver.getServers(),
    );
  },
  "Resolver.reverse"() {
    const resolver = new dns.promises.Resolver();
    return emptyThenFilled(
      () => resolver.reverse("10.1.2.3"),
      () => resolver.getServers(),
    );
  },
  "dns.lookupService"() {
    return emptyThenFilled(
      () => dns.promises.lookupService("10.1.2.3", 80).then(result => result.hostname),
      dns.getServers,
    );
  },
  "Bun.dns.lookup"() {
    return emptyThenFilled(
      () => Bun.dns.lookup("name.example.test", { backend: "c-ares" }).then(list => list.map(entry => entry.address)),
      dns.getServers,
    );
  },

  // The config has one nameserver, which c-ares cannot use (link-local with no
  // interface). The resolver keeps the default server.
  async "unusable-nameserver"() {
    config("nameserver fe80::1\n");
    const resolver = new dns.promises.Resolver();
    const steps = [];
    for (let i = 0; i < 3; i++) {
      steps.push({ code: await outcome(resolver.resolve4("name.example.test")), servers: resolver.getServers() });
    }
    return steps;
  },

  // The local address of the resolver is still in use after the new read.
  async "local-address"() {
    const a = await nameserver("10.20.0.1");
    config("");
    const resolver = new dns.promises.Resolver();
    resolver.setLocalAddress("127.0.0.2");
    const first = await outcome(resolver.resolve4("name.example.test"));
    config(`nameserver ${a.address}\n`);
    const second = await outcome(resolver.resolve4("name.example.test"));
    a.close();
    return { first, second, from: a.from };
  },

  // setServers() is final. A refused query does not replace the servers, and
  // does not start a new read of the config either: such a read empties the
  // query cache of c-ares, and the cached answer is still there afterwards.
  async "user-set-servers"() {
    const a = await nameserver("10.20.0.1");
    const b = await nameserver("10.20.0.2");
    config(`nameserver ${b.address}\n`);
    const resolver = new dns.promises.Resolver();
    resolver.setServers([a.address]);
    const answers = [await outcome(resolver.resolve4("cached.example.test"))];
    const release = holdAllFds();
    const refused = await outcome(resolver.resolve4("name.example.test"));
    release();
    answers.push(await outcome(resolver.resolve4("cached.example.test")));
    a.close();
    b.close();
    return { answers, refused, unchanged: resolver.getServers().join() === a.address, asked: a.names };
  },

  // The config names one loopback nameserver that refuses, then another one.
  async "one-loopback-server"() {
    const a = await nameserver("10.20.0.1");
    const dead = await refusingUdpPort();
    config(`nameserver ${dead.address}\n`);
    const resolver = new dns.promises.Resolver();
    const first = await outcome(resolver.resolve4("name.example.test"));
    config(`nameserver ${a.address}\n`);
    const second = await outcome(resolver.resolve4("name.example.test"));
    a.close();
    dead.close();
    return { first, second, recovered: resolver.getServers().join() === a.address };
  },

  // The config names two nameservers that refuse. That list is final.
  async "two-servers"() {
    const a = await nameserver("10.20.0.1");
    const dead = [await refusingUdpPort(), await refusingUdpPort()];
    const servers = dead.map(server => server.address);
    config(servers.map(server => `nameserver ${server}\n`).join(""));
    const resolver = new dns.promises.Resolver();
    const codes = [await outcome(resolver.resolve4("name.example.test"))];
    config(`nameserver ${a.address}\n`);
    codes.push(await outcome(resolver.resolve4("name.example.test")));
    codes.push(await outcome(resolver.resolve4("name.example.test")));
    a.close();
    dead.forEach(server => server.close());
    return { codes, unchanged: resolver.getServers().join() === servers.join(), asked: a.names };
  },

  // A query that is sent from inside a completion callback of c-ares does not
  // read the config: c-ares is still using the servers that the read replaces.
  // The query after the callback does the read.
  async "inside-a-callback"() {
    const a = await nameserver("10.20.0.1", true);
    const b = await nameserver("10.20.0.2");
    config(`nameserver ${a.address}\n`);
    const resolver = new dns.promises.Resolver();
    const held = outcome(resolver.resolve4("held.example.test"));
    // Refused over TCP while the query above is in flight. A new read is due.
    const refused = await outcome(resolver.resolve4("truncated.example.test"));
    config(`nameserver ${b.address}\n`);
    let inside: Promise<unknown> | undefined;
    // Resolving a promise with an array reads `then` from the array. For the
    // answer of the held query, that happens in its completion callback.
    Object.defineProperty(Array.prototype, "then", {
      configurable: true,
      get() {
        inside ??= outcome(resolver.resolve4("inside.example.test"));
        return undefined;
      },
    });
    a.release();
    const outer = await held;
    delete (Array.prototype as any).then;
    const insideAnswer = await inside;
    const after = await outcome(resolver.resolve4("after.example.test"));
    a.close();
    b.close();
    return { refused, outer, inside: insideAnswer, after };
  },
};

const groups: Record<string, string[]> = {
  // These hold every file descriptor for a moment. "system-config" is first:
  // it runs before the override exists.
  "no-file-descriptors": [
    "system-config",
    "no-file-descriptors",
    "user-set-servers",
    "one-loopback-server",
    "two-servers",
    "inside-a-callback",
  ],
  // The first query of each of these goes to c-ares's default server.
  // dns.lookupService and Bun.dns.lookup use the resolver of the VM, so they
  // cannot be in one process.
  "empty-config": [
    "dns.lookupService",
    "Resolver.resolve4",
    "Resolver.reverse",
    "unusable-nameserver",
    "local-address",
  ],
  "empty-config-lookup": ["Bun.dns.lookup"],
};

for (const name of groups[group]) console.log(JSON.stringify({ [name]: await scenarios[name]() }));
