// `bun dns-fallback-server-fixture.ts <group> <resolv.conf path>` runs the
// scenarios of one group, one after the other, and prints one line of JSON for
// each. The nameservers are dgram sockets in this process.
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

// Answers A with `ip`, PTR with host.example.test, and every other type with no
// record. Three names are special: "truncated.*" gets an answer with the TC
// bit, which makes c-ares ask again over TCP, where the listener closes the
// connection at once. "held.*" gets its answer when `release()` is called.
// "cached.*" gets a TTL of 60, so c-ares keeps the answer in its query cache.
async function nameserver(
  ip: string,
  address = "127.0.0.1",
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
  socket.bind(0, address);
  await once(socket, "listening");
  const { port } = socket.address();
  // A query that c-ares retries over TCP must end at once, so the TCP port of
  // the same number closes every connection. Hold it: a port that is free only
  // right now can become the source port of a query socket.
  const tcp = net.createServer(connection => connection.destroy());
  tcp.listen(port, address);
  const listening = await Promise.race([once(tcp, "listening").then(() => true), once(tcp, "error").then(() => false)]);
  if (!listening) {
    socket.close();
    return nameserver(ip, address);
  }
  return {
    address: `${address}:${port}`,
    names,
    from,
    release: () => held.splice(0).forEach(send => send()),
    close: () => {
      socket.close();
      tcp.close();
    },
  };
}

// A UDP port that refuses every datagram until `close()`. The socket keeps the
// port, so that no query socket gets it, and is connected elsewhere, so that it
// takes no datagram.
async function refusingUdpPort(address = "127.0.0.1") {
  const socket = dgram.createSocket("udp4");
  socket.bind(0, address);
  await once(socket, "listening");
  const { port } = socket.address();
  socket.connect(1, "127.0.0.1");
  await once(socket, "connect");
  return { address: `${address}:${port}`, close: () => socket.close() };
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

// c-ares reads `conf` in place of /etc/resolv.conf: the test spawns this
// process with BUN_INTERNAL_DNS_RESOLV_CONF set to that path.
function config(content: string) {
  fs.writeFileSync(conf, content);
}

// The config is empty at the first use of the resolver that `query` uses, and
// names a nameserver afterwards. The second query while it is still empty
// checks that one read that finds no nameserver does not end the recovery.
async function emptyThenFilled(query: () => Promise<unknown>, servers: () => string[]) {
  const a = await nameserver("10.20.0.1");
  config("");
  const first = await outcome(query());
  const stillEmpty = await outcome(query());
  const serversWhileEmpty = servers();
  config(`nameserver ${a.address}\n`);
  const second = await outcome(query());
  const third = await outcome(query());
  a.close();
  return { first, stillEmpty, serversWhileEmpty, second, third, recovered: servers().join() === a.address };
}

const scenarios: Record<string, () => Promise<unknown>> = {
  // The config names a nameserver. The process has no file descriptor left at
  // the first use of the resolver, so c-ares cannot read the config.
  async "no-file-descriptors"() {
    const a = await nameserver("10.20.0.1");
    config(`nameserver ${a.address}\n`);
    const release = holdAllFds();
    const resolver = new dns.promises.Resolver();
    const first = await outcome(resolver.resolve4("name.example.test"));
    const stillHeld = await outcome(resolver.resolve4("name.example.test"));
    const serversWhileHeld = resolver.getServers();
    release();
    const second = await outcome(resolver.resolve4("name.example.test"));
    a.close();
    return { first, stillHeld, serversWhileHeld, second, recovered: resolver.getServers().join() === a.address };
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
  // interface). The resolver keeps the server it has.
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

  // The read applies the whole config, not only its servers: the lookup that
  // follows asks for the suffix that the new search list names. Only
  // `Bun.dns.lookup` uses the search list, so this one uses the VM resolver.
  async "search-list"() {
    const a = await nameserver("10.20.0.1");
    const lookup = (name: string) =>
      outcome(Bun.dns.lookup(name, { backend: "c-ares" }).then(list => list.map(entry => entry.address)));
    config("");
    const first = await lookup("name.example.test");
    config(`nameserver ${a.address}\nsearch new.example\n`);
    const second = await lookup("one");
    a.close();
    return { first, second, asked: a.names };
  },

  // setServers() is final. A server that does not answer does not replace the
  // servers, and does not start a new read either: such a read empties the
  // query cache of c-ares, and the cached answer is still there afterwards.
  async "user-set-servers"() {
    const a = await nameserver("10.20.0.1");
    const b = await nameserver("10.20.0.2");
    config(`nameserver ${b.address}\n`);
    const resolver = new dns.promises.Resolver();
    resolver.setServers([a.address]);
    const answers = [await outcome(resolver.resolve4("cached.example.test"))];
    const refused = await outcome(resolver.resolve4("truncated.example.test"));
    answers.push(await outcome(resolver.resolve4("cached.example.test")));
    a.close();
    b.close();
    return { answers, refused, unchanged: resolver.getServers().join() === a.address, asked: a.names };
  },

  // dns.setServers() is final for the resolver of the module too.
  async "dns.setServers"() {
    const a = await nameserver("10.20.0.1");
    const b = await nameserver("10.20.0.2");
    config(`nameserver ${b.address}\n`);
    dns.setServers([a.address]);
    const answers = [await outcome(dns.promises.resolve4("cached.example.test"))];
    const refused = await outcome(dns.promises.resolve4("truncated.example.test"));
    answers.push(await outcome(dns.promises.resolve4("cached.example.test")));
    a.close();
    b.close();
    return { answers, refused, unchanged: dns.getServers().join() === a.address, asked: a.names };
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

  // One nameserver that is not a loopback address. That list is final, so the
  // query after the refusal goes to the same server.
  async "one-other-server"() {
    const a = await nameserver("10.20.0.1");
    const dead = await refusingUdpPort("127.0.0.2");
    config(`nameserver ${dead.address}\n`);
    const resolver = new dns.promises.Resolver();
    const codes = [await outcome(resolver.resolve4("name.example.test"))];
    config(`nameserver ${a.address}\n`);
    codes.push(await outcome(resolver.resolve4("name.example.test")));
    a.close();
    dead.close();
    return { codes, unchanged: resolver.getServers().join() === dead.address, asked: a.names };
  },

  // Two nameservers. That list is final as well.
  async "two-servers"() {
    const a = await nameserver("10.20.0.1");
    const dead = [await refusingUdpPort(), await refusingUdpPort()];
    const servers = dead.map(server => server.address);
    config(servers.map(server => `nameserver ${server}\n`).join(""));
    const resolver = new dns.promises.Resolver();
    const codes = [await outcome(resolver.resolve4("name.example.test"))];
    config(`nameserver ${a.address}\n`);
    codes.push(await outcome(resolver.resolve4("name.example.test")));
    a.close();
    dead.forEach(server => server.close());
    return { codes, unchanged: resolver.getServers().join() === servers.join(), asked: a.names };
  },

  // A server that answers, even with no record, is a server that answers: the
  // config is not read again.
  async "answered-query"() {
    const a = await nameserver("10.20.0.1");
    const b = await nameserver("10.20.0.2");
    config(`nameserver ${a.address}\n`);
    const resolver = new dns.promises.Resolver();
    const empty = await outcome(resolver.resolveMx("name.example.test"));
    config(`nameserver ${b.address}\n`);
    const second = await outcome(resolver.resolve4("name.example.test"));
    a.close();
    b.close();
    return { empty, second, unchanged: resolver.getServers().join() === a.address, asked: b.names };
  },

  // A query that is sent from inside a completion callback of c-ares does not
  // read the config: c-ares is still using the servers that the read replaces.
  // The query after the callback does the read.
  async "inside-a-callback"() {
    const a = await nameserver("10.20.0.1");
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

  // The read replaces the server while a query is in flight on it. c-ares sends
  // that query to the new server, and counts the move as one of its tries.
  async "query-in-flight"() {
    const a = await nameserver("10.20.0.1");
    const b = await nameserver("10.20.0.2");
    config(`nameserver ${a.address}\n`);
    const resolver = new dns.promises.Resolver();
    const held = outcome(resolver.resolve4("held.example.test"));
    const refused = await outcome(resolver.resolve4("truncated.example.test"));
    config(`nameserver ${b.address}\n`);
    const after = await outcome(resolver.resolve4("after.example.test"));
    a.release();
    b.release();
    const moved = await held;
    a.close();
    b.close();
    return { refused, after, moved, asked: b.names };
  },

  // The same query with no try left: the move ends it instead.
  async "query-in-flight-last-try"() {
    const a = await nameserver("10.20.0.1");
    const b = await nameserver("10.20.0.2");
    config(`nameserver ${a.address}\n`);
    const resolver = new dns.promises.Resolver({ tries: 1 });
    const held = outcome(resolver.resolve4("held.example.test"));
    const refused = await outcome(resolver.resolve4("truncated.example.test"));
    config(`nameserver ${b.address}\n`);
    const after = await outcome(resolver.resolve4("after.example.test"));
    a.release();
    b.release();
    const moved = await held;
    a.close();
    b.close();
    return { refused, after, moved, asked: b.names };
  },
};

const groups: Record<string, string[]> = {
  // The first query of each of these goes to c-ares's default server.
  // dns.lookupService and Bun.dns.lookup use the resolver of the VM, so they
  // cannot be in one process.
  "empty-config": ["Resolver.resolve4", "Resolver.reverse", "unusable-nameserver", "local-address"],
  "empty-config-service": ["dns.lookupService"],
  "empty-config-lookup": ["Bun.dns.lookup", "search-list"],
  // The config names a server. These pin when it is NOT read again.
  final: ["user-set-servers", "one-other-server", "two-servers"],
  "final-more": ["answered-query", "dns.setServers"],
  // The server list changes while c-ares is using it.
  "replace-servers": ["one-loopback-server", "inside-a-callback"],
  "replace-servers-more": ["query-in-flight", "query-in-flight-last-try"],
  // This one holds every file descriptor for a moment.
  "no-file-descriptors": ["no-file-descriptors"],
};

for (const name of groups[group]) console.log(JSON.stringify({ [name]: await scenarios[name]() }));
