// The resolver behind `node:dns` makes no system call of its own, so these run it in a made-up world: files, settings,
// routes, sockets and the clock are the script's. What a script and a log say is in src/dns_resolver/simulation.rs.
import { dnsSimulate } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { marked, read } from "./c-ares-driver/golden";
import { a, aaaa, cname, encode, name, parse, RCODE, record, type Reply, soa, TYPE, u16 } from "./dns-server";

/** A word of a script that stands for these bytes. */
function text(value: string | Buffer): string {
  const bytes = Buffer.from(value);
  if (bytes.length === 0) return "%";
  return Array.from(bytes, byte =>
    byte <= 0x20 || byte >= 0x7f || byte === 0x25
      ? "%" + byte.toString(16).padStart(2, "0").toUpperCase()
      : String.fromCharCode(byte),
  ).join("");
}

const file = (path: string, contents: string, modified?: number) =>
  `file ${path} ${text(contents)}${modified === undefined ? "" : ` ${modified}`}`;

/** A script that grows. What it has so far is run again for every line added, which always goes the same way. */
class World {
  #script: string[] = [];
  #seen = 0;
  log: string[] = [];

  constructor(...lines: string[]) {
    this.#script.push(...lines);
  }

  /** What these lines add to the log. */
  run(...lines: string[]): string[] {
    this.#script.push(...lines);
    this.log = dnsSimulate(this.#script.join("\n")).split("\n").slice(0, -1);
    const added = this.log.slice(this.#seen);
    this.#seen = this.log.length;
    return added;
  }

  #isTcp(socket: number) {
    return this.log.some(line => line.startsWith(`open ${socket} tcp `));
  }

  /** What was sent, in order. On TCP it need not be a whole message. */
  #sends() {
    return this.log
      .filter(line => /^send \d+ [0-9a-f]+$/.test(line))
      .map(line => {
        const [, socket, hex] = line.split(" ");
        return { socket: Number(socket), bytes: Buffer.from(hex, "hex").subarray(this.#isTcp(Number(socket)) ? 2 : 0) };
      });
  }

  /** Every message sent, in order, and the socket it was sent on. */
  messages() {
    return this.#sends().map(({ socket, bytes }) => ({ socket, ...parse(bytes) }));
  }

  /** The last message sent on `socket`. */
  sent(socket: number) {
    const last = this.#sends().findLast(sent => sent.socket === socket);
    if (!last) throw new Error(`nothing was sent on ${socket}:\n${this.log.join("\n")}`);
    return parse(last.bytes);
  }

  /** Answers `query`, the last message sent on `socket` unless said. */
  reply(socket: number, reply: Reply, query = this.sent(socket)): string[] {
    const message = encode(query, reply);
    const framed = this.#isTcp(socket) ? Buffer.concat([u16(message.length), message]) : message;
    return this.run(`deliver ${socket} ${framed.toString("hex")}`);
  }

  /** `socket type name` of every message sent, in order. */
  questions(): string[] {
    return this.messages().map(message => `${message.socket} ${message.type} ${message.name}`);
  }
}

// `local` is the request that does least. Some request has to make the channel.
const servers = (...lines: string[]) =>
  new World(...lines).run("local 0.0.0.0").find(line => line.startsWith("servers"));

describe("where the servers come from", () => {
  test("the `nameserver` lines of resolv.conf that name an address, in their order", () => {
    expect(
      servers(
        file(
          "/etc/resolv.conf",
          [
            "# comment",
            "; comment",
            "nameserver 10.0.0.1",
            "  nameserver   10.0.0.2   # comment",
            "nameserver 10.0.0.3:5353",
            "nameserver [10.0.0.4]:54",
            "nameserver 2001:db8::1",
            "nameserver [2001:db8::2]:5353",
            "nameserver 10.0.0.5, 10.0.0.6 10.0.0.7",
            "nameserver not-an-address",
            "nameserver 10.0.0.1",
            "nameserver fec0::1",
            "nameserver fe80::1",
            "nameserver fe80::2%eth0",
            "nameserver fe80::3%7",
            "nameserver fe80::4%nope",
            "nameserver fe80::5%9",
            "nameserver 10.0.0.8%fifteen-letters",
            "nameserver 10.0.0.9%sixteen--letters",
            "nameserverx 10.9.9.9",
            "NAMESERVER 10.9.9.8",
          ].join("\n"),
        ),
        "interface 3 eth0",
        "interface 7 eth1",
      ),
    ).toMatchInlineSnapshot(
      `"servers 10.0.0.1#53#53#0 10.0.0.2#53#53#0 10.0.0.3#5353#5353#0 10.0.0.4#54#54#0 2001:db8::1#53#53#0 2001:db8::2#5353#5353#0 10.0.0.5#53#53#0 10.0.0.6#53#53#0 10.0.0.7#53#53#0 fe80::2#53#53#3 fe80::3#53#53#7 10.0.0.8#53#53#0"`,
    );
  });

  test("a system that keeps such files nowhere: 127.0.0.1, and names come from the servers alone", () => {
    const it = new World("etc -");
    expect(it.run("lookup box 0 4", "nameinfo 10.0.0.1 80").filter(line => /^(read|servers|open) /.test(line))).toEqual(
      ["servers 127.0.0.1#53#53#0", "open 1 udp 127.0.0.1#53#0"],
    );
  });

  test("no file, no server in it, or a file that cannot be read: 127.0.0.1", () => {
    expect(servers()).toBe("servers 127.0.0.1#53#53#0");
    expect(servers(file("/etc/resolv.conf", "search corp.test\n"))).toBe("servers 127.0.0.1#53#53#0");
    expect(servers("unreadable /etc/resolv.conf")).toBe("servers 127.0.0.1#53#53#0");
  });

  test("an nsswitch.conf that cannot be read takes nothing from resolv.conf", () => {
    expect(servers(file("/etc/resolv.conf", "nameserver 10.0.0.1\n"), "unreadable /etc/nsswitch.conf")).toBe(
      "servers 10.0.0.1#53#53#0",
    );
  });

  test("a TAB is a blank in resolv.conf", () => {
    const it = new World(
      file("/etc/resolv.conf", "nameserver 10.0.0.1\t# first\nnameserver\t10.0.0.2\t10.0.0.3\nsearch a.test\tb.test\n"),
    );
    expect(it.run("lookup host 0 4")).toContain("servers 10.0.0.1#53#53#0 10.0.0.2#53#53#0 10.0.0.3#53#53#0");
    it.reply(1, { rcode: RCODE.NXDOMAIN });
    expect(it.questions()).toEqual(["1 1 host.a.test", "1 1 host.b.test"]);
  });

  test("Windows: the adapters' servers by the metric of the route to them", () => {
    expect(
      servers(
        "settings windows",
        "interface 12 ethernet_1",
        "windows-server 10.0.0.1 53 25 256 0",
        "windows-server 10.0.0.2 53 25 0 0",
        "windows-server 10.0.0.3 0 5 - 0",
        "windows-server 10.0.0.4 53 5 4294967295 0",
        "windows-server 10.0.0.5 53 4294967295 1 0",
        "windows-server 10.0.0.6 53 25 0 0",
        "windows-server 10.0.0.2 53 1 0 0",
        "windows-server 0.0.0.0 53 0 0 0",
        "windows-server 255.255.255.255 53 0 0 0",
        "windows-server :: 53 0 0 0",
        "windows-server fec0:0:0:ffff::1 53 0 0 12",
        "windows-server fe80::1 53 30 0 12",
        "windows-server fe80::2 53 30 0 13",
        "windows-server fe80::3 53 30 0 0",
        "windows-server 2001:db8::1 53 10 0 12",
      ),
    ).toBe(
      "servers 10.0.0.2#53#53#0 2001:db8::1#53#53#0 10.0.0.6#53#53#0 fe80::1#53#53#12 10.0.0.1#53#53#0 " +
        "10.0.0.3#53#53#0 10.0.0.4#53#53#0 10.0.0.5#53#53#0",
    );
    expect(servers("settings windows")).toBe("servers 127.0.0.1#53#53#0");
  });

  test("macOS: the resolvers for every domain that can be reached", () => {
    expect(
      servers(
        "settings mac",
        "interface 4 en0",
        "mac-resolver 0 2 0 0 - 10.0.0.1#0 10.0.0.2#5353",
        "mac-resolver 1 2 0 0 - 10.0.0.3#0",
        "mac-resolver 0 0 0 0 - 10.0.0.4#0",
        "mac-resolver 0 4 0 0 - 10.0.0.5#0",
        "mac-resolver 0 8 54 0 - 10.0.0.6#0 10.0.0.7#55",
        "mac-resolver 0 2 0 4 - fe80::1#0 2001:db8::1#0",
        "mac-resolver 0 2 0 5 - fe80::2#0",
        "mac-resolver 0 2 0 0 - search=nobody.test",
      ),
    ).toBe(
      "servers 10.0.0.1#53#53#0 10.0.0.2#5353#5353#0 10.0.0.6#54#54#0 10.0.0.7#55#55#0 fe80::1#53#53#4 2001:db8::1#53#53#0",
    );
    expect(servers("settings mac")).toBe("servers 127.0.0.1#53#53#0");
    expect(servers("settings mac-fails", file("/etc/resolv.conf", "nameserver 10.0.0.1\n"))).toBe(
      "servers 127.0.0.1#53#53#0",
    );
  });

  test("Android: the addresses in the properties, else 127.0.0.1", () => {
    expect(servers("settings android", "android-property 10.0.0.1", "android-property 2001:db8::1,10.0.0.2")).toBe(
      "servers 10.0.0.1#53#53#0 2001:db8::1#53#53#0 10.0.0.2#53#53#0",
    );
    expect(servers("settings android", "android-property 10.0.0.7")).toBe("servers 10.0.0.7#53#53#0");
    expect(servers("settings android")).toBe("servers 127.0.0.1#53#53#0");
  });
});

/** The names asked for when every server says that nothing exists. */
function searched(lookup: string, ...world: string[]): string[] {
  const it = new World(...world);
  it.run(`lookup ${lookup} 0 4`);
  while (!it.log.some(line => line.startsWith("done 0"))) {
    it.reply(it.messages().at(-1)!.socket, { rcode: RCODE.NXDOMAIN });
  }
  expect(it.log.at(-2)).toBe("done 0 error ENOTFOUND");
  return it.questions().map(question => question.split(" ")[2]);
}

describe("the search list", () => {
  const resolvConf = (...lines: string[]) => file("/etc/resolv.conf", ["nameserver 10.0.0.1", ...lines, ""].join("\n"));

  test("every domain in turn, before or after the name itself", () => {
    const world = resolvConf("search one.test two.test three.test");
    expect(searched("host", world)).toEqual(["host.one.test", "host.two.test", "host.three.test", "host"]);
    expect(searched("host.sub", world)).toEqual([
      "host.sub",
      "host.sub.one.test",
      "host.sub.two.test",
      "host.sub.three.test",
    ]);
    expect(searched("host.", world)).toEqual(["host"]);
  });

  test("a name with `ndots` dots or more is tried as it is first", () => {
    const world = resolvConf("search one.test", "options ndots:3");
    expect(searched("a.b.c", world)).toEqual(["a.b.c.one.test", "a.b.c"]);
    expect(searched("a.b.c.d", world)).toEqual(["a.b.c.d", "a.b.c.d.one.test"]);
    expect(searched("host", resolvConf("search one.test", "options ndots:0"))).toEqual(["host", "host.one.test"]);
  });

  test("the last `search` or `domain` counts", () => {
    expect(searched("host", resolvConf("search one.test", "search two.test"))).toEqual(["host.two.test", "host"]);
    expect(searched("host", resolvConf("domain one.test two.test"))).toEqual(["host.one.test", "host"]);
    expect(searched("host", resolvConf("search one.test", "domain two.test"))).toEqual(["host.two.test", "host"]);
    expect(searched("host", resolvConf("domain one.test", "domain two.test"))).toEqual(["host.two.test", "host"]);
    expect(searched("host", resolvConf("domain two.test", "search one.test"))).toEqual(["host.one.test", "host"]);
    expect(searched("host", resolvConf("search one.test, ONE.test,two.test"))).toEqual([
      "host.one.test",
      "host.two.test",
      "host",
    ]);
  });

  test("without one, the domain of the host's own name", () => {
    expect(searched("host", resolvConf(), "hostname box.corp.test")).toEqual(["host.corp.test", "host"]);
    expect(searched("host", resolvConf(), "hostname box")).toEqual(["host"]);
    expect(searched("host", resolvConf())).toEqual(["host"]);
    expect(searched("host", "unreadable /etc/resolv.conf", "hostname box.corp.test")).toEqual([
      "host.corp.test",
      "host",
    ]);
  });

  test("the environment has the last word", () => {
    const world = resolvConf("search one.test two.test", "options ndots:1");
    expect(searched("host", world, `env LOCALDOMAIN ${text("env.test other.test")}`)).toEqual([
      "host.env.test",
      "host",
    ]);
    expect(searched("a.b", world, `env RES_OPTIONS ${text("ndots:2 attempts:1")}`)).toEqual([
      "a.b.one.test",
      "a.b.two.test",
      "a.b",
    ]);
  });

  test("Windows: the registry's suffixes, one after the other", () => {
    expect(
      searched(
        "host",
        "settings windows",
        `windows-suffix ${text("one.test,two.test")}`,
        "windows-suffix three.test",
        `windows-suffix ${text("caf\u00e9.test")}`,
        `windows-suffix ${text("caf\u00e9.test gone.test")}`,
        "windows-suffix %",
        "windows-suffix ONE.test",
        `windows-suffix ${text("four.test five.test")}`,
      ),
    ).toEqual(["host.one.test", "host.two.test", "host.three.test", "host.four.test", "host.five.test", "host"]);
  });

  test("macOS: the resolvers' search lists and options together", () => {
    expect(
      searched(
        "a.b",
        "settings mac",
        "mac-resolver 0 2 0 0 ndots:2 search=one.test search=two.test 10.0.0.1#0",
        "mac-resolver 1 2 0 0 - search=skipped.test 10.0.0.2#0",
        "mac-resolver 0 2 0 0 - search=TWO.test search=three.test 10.0.0.3#0",
      ),
    ).toEqual(["a.b.one.test", "a.b.two.test", "a.b.three.test", "a.b"]);
  });

  test("macOS: options that are there and empty are no options", () => {
    expect(searched("host", "settings mac", "mac-resolver 0 2 0 0 % search=one.test 10.0.0.1#0")).toEqual([
      "host.one.test",
      "host",
    ]);
  });

  test("a name without a dot that the file of HOSTALIASES lists is replaced and not searched for", () => {
    const world = [
      resolvConf("search one.test"),
      "env HOSTALIASES /aliases",
      file("/aliases", "# comment\nother  far.test\nSHORT\tlong.example.test  ignored\nshort second.test\n"),
    ];
    expect(searched("short", ...world)).toEqual(["long.example.test"]);
    expect(searched("short.x", ...world)).toEqual(["short.x", "short.x.one.test"]);
    expect(searched("unlisted", ...world)).toEqual(["unlisted.one.test", "unlisted"]);
  });

  test("an answer other than that the name does not exist ends the search", () => {
    for (const [rcode, error] of [
      [RCODE.SERVFAIL, "ESERVFAIL"],
      [RCODE.REFUSED, "EREFUSED"],
      [RCODE.FORMERR, "EFORMERR"],
    ] as const) {
      const it = new World(resolvConf("search one.test two.test"));
      it.run("lookup host 0 4");
      expect(it.reply(1, { rcode })).toContain(`done 0 error ${error}`);
      expect(it.questions()).toEqual(["1 1 host.one.test"]);
    }
  });

  test("a name that exists without an address does not", () => {
    const it = new World(resolvConf("search one.test two.test"));
    it.run("lookup host 0 4");
    it.reply(1, {});
    it.reply(1, { answers: [a("host.two.test", 60, "10.1.1.1")] });
    expect(it.questions()).toEqual(["1 1 host.one.test", "1 1 host.two.test"]);
    expect(it.log).toContain("done 0 name=host.two.test 10.1.1.1#0/60");
  });
});

const oneServer = file("/etc/resolv.conf", "nameserver 10.0.0.1\n");

describe("the hosts file", () => {
  const hosts = [
    "# comment",
    "127.0.0.1 localhost",
    "::1 localhost ip6-localhost",
    "10.1.1.1 box.corp.test box BOX2 # comment",
    "10.1.1.2 box.corp.test other",
    "2001:db8::1 box",
    "10.1.1.1 again",
    "10.1.1.3",
    "not-an-address name",
    "10.1.1.4 bad_name! good",
    "  10.1.1.5\tindented",
  ].join("\n");

  test("a name has the addresses of its own lines, and an address the names of its own", () => {
    const it = new World(oneServer, file("/etc/hosts", hosts));
    expect(
      it.run(
        "lookup box 80 0",
        "lookup BOX.corp.test 80 4",
        "lookup box 80 6",
        "lookup other 0 0",
        "lookup again 0 4",
        "lookup good 0 4",
        "lookup indented 0 4",
        "reverse 10.1.1.1",
        "reverse 10.1.1.2",
        "reverse 2001:db8::1",
        "reverse 10.1.1.4",
      ),
    ).toMatchInlineSnapshot(`
      [
        "start",
        "read /etc/resolv.conf",
        "read /etc/nsswitch.conf",
        "servers 10.0.0.1#53#53#0",
        "read /etc/hosts",
        "done 0 name=box 2001:db8::1#80/0 10.1.1.1#80/0",
        "done 1 name=BOX.corp.test 10.1.1.1#80/0 10.1.1.2#80/0",
        "done 2 name=box 2001:db8::1#80/0",
        "done 3 name=other 10.1.1.2#0/0",
        "done 4 name=again 10.1.1.1#0/0",
        "done 5 name=good 10.1.1.4#0/0",
        "done 6 name=indented 10.1.1.5#0/0",
        "done 7 name=box.corp.test box BOX2 again",
        "done 8 name=box.corp.test other",
        "done 9 name=box",
        "done 10 name=good",
      ]
    `);
  });

  test("is read again once it was modified", () => {
    const it = new World(oneServer, file("/etc/hosts", "10.1.1.1 box\n", 1_600_000_000));
    expect(it.run("lookup box 0 4", "lookup box 0 4")).toEqual([
      "start",
      "read /etc/resolv.conf",
      "read /etc/nsswitch.conf",
      "servers 10.0.0.1#53#53#0",
      "read /etc/hosts",
      "done 0 name=box 10.1.1.1#0/0",
      "done 1 name=box 10.1.1.1#0/0",
    ]);
    expect(it.run(file("/etc/hosts", "10.1.1.2 box\n", 1_700_000_001), "lookup box 0 4")).toEqual([
      "read /etc/hosts",
      "done 2 name=box 10.1.1.2#0/0",
    ]);
    // A copy that kept its time, or a backup.
    expect(it.run("advance 5000", file("/etc/hosts", "10.1.1.3 box\n", 1_500_000_000), "lookup box 0 4")).toEqual([
      "read /etc/hosts",
      "done 3 name=box 10.1.1.3#0/0",
    ]);
    expect(it.run(file("/etc/hosts", "10.1.1.44 box\n", 1_500_000_000), "lookup box 0 4")).toEqual([
      "read /etc/hosts",
      "done 4 name=box 10.1.1.44#0/0",
    ]);
    expect(it.run("lookup box 0 4")).toEqual(["done 5 name=box 10.1.1.44#0/0"]);
    // Another file of the same size and time, moved into its place.
    expect(it.run(`${file("/etc/hosts", "10.1.1.55 box\n", 1_500_000_000)} 7`, "lookup box 0 4")).toEqual([
      "read /etc/hosts",
      "done 6 name=box 10.1.1.55#0/0",
    ]);
  });

  test("nsswitch.conf says whether it comes before the servers", () => {
    const world = [oneServer, file("/etc/hosts", "10.1.1.1 box\n")];
    const asks = (...more: string[]) => new World(...world, ...more).run("lookup box 0 4").slice(4);
    expect(asks(file("/etc/nsswitch.conf", "hosts: files dns\n"))).toEqual([
      "read /etc/hosts",
      "done 0 name=box 10.1.1.1#0/0",
    ]);
    expect(
      asks(file("/etc/nsswitch.conf", "passwd: files\nhosts:\tmdns4_minimal [NOTFOUND=return] dns files\n"))[0],
    ).toBe("open 1 udp 10.0.0.1#53#0");
    expect(
      new World(...world, file("/etc/nsswitch.conf", "hosts: files\n")).run("lookup missing 0 4").slice(4),
    ).toEqual(["read /etc/hosts", "done 0 error ECONNREFUSED"]);
    expect(asks(file("/etc/resolv.conf", "nameserver 10.0.0.1\nlookup bind file\n"))[0]).toBe(
      "open 1 udp 10.0.0.1#53#0",
    );
  });

  test("localhost is the loopback address whatever the file says", () => {
    const lookups = ["lookup localhost 0 0", "lookup a.LOCALHOST 0 4", "lookup localhost 0 6"];
    expect(new World(oneServer).run(...lookups).filter(line => line.startsWith("done"))).toEqual([
      "done 0 name=localhost ::1#0/0 127.0.0.1#0/0",
      "done 1 name=a.LOCALHOST 127.0.0.1#0/0",
      "done 2 name=localhost ::1#0/0",
    ]);
    const withDots = new World(oneServer).run("lookup localhost. 0 4", "lookup a.localhost. 0 6");
    expect(withDots.filter(line => /^(done|open)/.test(line))).toEqual([
      "done 0 name=localhost. 127.0.0.1#0/0",
      "done 1 name=a.localhost. ::1#0/0",
    ]);
    expect(
      new World(oneServer, file("/etc/hosts", "127.0.0.2 localhost\n"))
        .run(...lookups)
        .filter(line => line.startsWith("done")),
    ).toEqual([
      "done 0 name=localhost ::1#0/0 127.0.0.2#0/0",
      "done 1 name=a.LOCALHOST 127.0.0.1#0/0",
      "done 2 name=localhost ::1#0/0",
    ]);
    // Windows keeps a list.
    expect(
      new World(oneServer, file("/etc/hosts", "127.0.0.2 localhost\n"), "loopback 127.0.0.1 127.0.0.9 ::1")
        .run(...lookups)
        .filter(line => line.startsWith("done")),
    ).toEqual([
      "done 0 name=localhost ::1#0/0 127.0.0.1#0/0",
      "done 1 name=a.LOCALHOST 127.0.0.1#0/0",
      "done 2 name=localhost ::1#0/0",
    ]);
    expect(new World(oneServer, "loopback 127.0.0.2 127.0.0.3 ::2 ::3").run("lookup localhost 0 0").at(-1)).toBe(
      "done 0 name=localhost 127.0.0.2#0/0 ::2#0/0",
    );
  });
});

describe("the order of addresses", () => {
  test("is that of RFC 6724, by the address a packet to each would leave from", () => {
    const addresses = {
      "10.1.1.1": "10.0.0.9",
      "192.0.2.1": "none",
      "127.0.0.1": "127.0.0.1",
      "169.254.1.1": "10.0.0.9",
      "198.51.100.1": "198.51.100.9",
    };
    const addresses6 = {
      "20010db8000000000000000000000001": ["2001:db8::1", "2001:db8::9"],
      "20010db8ffff00000000000000000001": ["2001:db8:ffff::1", "2001:db8::9"],
      "fe800000000000000000000000000001": ["fe80::1", "fe80::9"],
      "fc000000000000000000000000000001": ["fc00::1", "fc00::9"],
      "20020102030400000000000000000001": ["2002:102:304::1", "2001:db8::9"],
      "20010000000000000000000000000001": ["2001::1", "none"],
      "00000000000000000000000000000001": ["::1", "::1"],
    };
    const it = new World(
      oneServer,
      ...Object.entries(addresses).map(([to, from]) => `route ${to} ${from}`),
      ...Object.values(addresses6).map(([to, from]) => `route ${to} ${from}`),
    );
    it.run("lookup host.test 0 0");
    const [first, second] = it.messages();
    it.reply(1, { answers: Object.keys(addresses).map(address => a("host.test", 60, address)) }, first);
    expect(
      it
        .reply(1, { answers: Object.keys(addresses6).map(address => aaaa("host.test", 60, address)) }, second)
        .find(line => line.startsWith("done"))!
        .split(" ")
        .slice(3),
    ).toMatchInlineSnapshot(`
      [
        "::1#0/60",
        "fe80::1#0/60",
        "2001:db8::1#0/60",
        "2001:db8:ffff::1#0/60",
        "127.0.0.1#0/60",
        "10.1.1.1#0/60",
        "198.51.100.1#0/60",
        "fc00::1#0/60",
        "2002:102:304::1#0/60",
        "169.254.1.1#0/60",
        "192.0.2.1#0/60",
        "2001::1#0/60",
      ]
    `);
  });

  test("is left alone if the routes cannot be asked for", () => {
    const it = new World(oneServer, "route 10.1.1.2 fails", "route 10.1.1.3 10.0.0.9");
    it.run("lookup host.test 0 4");
    expect(
      it.reply(1, { answers: ["10.1.1.1", "10.1.1.2", "10.1.1.3"].map(address => a("host.test", 60, address)) }),
    ).toContain("done 0 name=host.test 10.1.1.1#0/60 10.1.1.2#0/60 10.1.1.3#0/60");
  });
});

describe("timeouts and servers", () => {
  const twoServers = file("/etc/resolv.conf", "nameserver 10.0.0.1\nnameserver 10.0.0.2\n");

  test("each server in turn, for longer every round", () => {
    const it = new World(twoServers, "tries 3", "timeout 1000");
    it.run("query A a.test");
    while (!it.log.some(line => line.startsWith("done"))) it.run("expire");
    const timers = it.log.filter(line => line.startsWith("timer ")).map(line => Number(line.split(" ")[1]));
    const waits = timers.slice(0, -1).map((timer, i) => timer - (timers[i - 1] ?? 0));
    expect(it.log.filter(line => line.startsWith("open")).map(line => line.split(" ")[3])).toEqual([
      "10.0.0.1#53#0",
      "10.0.0.2#53#0",
      "10.0.0.1#53#0",
      "10.0.0.2#53#0",
      "10.0.0.1#53#0",
      "10.0.0.2#53#0",
    ]);
    expect(waits.slice(0, 2)).toEqual([1000, 1000]);
    // Up to half is taken off at random from the second round on.
    for (const wait of waits.slice(2, 4)) expect(wait).toBeWithin(1000, 2001);
    for (const wait of waits.slice(4, 6)) expect(wait).toBeWithin(2000, 4001);
    expect(it.log.at(-2)).toBe("done 0 error ETIMEOUT");
  });

  test("resolv.conf's options, unless the resolver was given its own", () => {
    const conf = file("/etc/resolv.conf", "nameserver 10.0.0.1\noptions timeout:3 attempts:2\n");
    const run = (...options: string[]) => {
      const it = new World(conf, ...options);
      it.run("query A a.test");
      while (!it.log.some(line => line.startsWith("done"))) it.run("expire");
      return [it.log.find(line => line.startsWith("timer")), it.questions().length];
    };
    expect(run()).toEqual(["timer 3000", 2]);
    expect(run("timeout 500", "tries 1")).toEqual(["timer 500", 1]);
  });

  test("a timeout is never under 250 ms nor over 5 s at first", () => {
    const first = (timeout: number) => new World(oneServer, `timeout ${timeout}`).run("query A a.test").at(-1);
    expect([first(1), first(249), first(251), first(5000), first(60000)]).toEqual([
      "timer 250",
      "timer 250",
      "timer 251",
      "timer 5000",
      "timer 5000",
    ]);
  });

  test("a socket a query timed out on takes no new query, and is closed once it has none", () => {
    const it = new World(oneServer, "tries 2");
    expect(it.run("query A a.test", "query A b.test").slice(4)).toMatchInlineSnapshot(`
      [
        "open 1 udp 10.0.0.1#53#0",
        "watch 1 r-",
        "send 1 dd7401000001000000000000016104746573740000010001",
        "timer 2000",
        "send 1 547d01000001000000000000016204746573740000010001",
      ]
    `);
    expect(it.run("advance 2000")).toMatchInlineSnapshot(`
      [
        "open 2 udp 10.0.0.1#53#0",
        "watch 2 r-",
        "send 2 547d01000001000000000000016204746573740000010001",
        "send 2 dd7401000001000000000000016104746573740000010001",
        "close 1",
        "timer 4641",
      ]
    `);
  });

  test("the second try goes out on another socket with the same id", () => {
    const it = new World(oneServer, "tries 2");
    it.run("query A a.test");
    const query = it.sent(1);
    it.run("advance 2000");
    expect(it.log).toContain("close 1");
    expect(it.reply(2, { answers: [a("a.test", 60, "1.2.3.4")] })).toContain("done 0 name=a.test 1.2.3.4/60");
    expect(query.id).toBe(it.sent(2).id);
  });

  test("an answer with a cookie of an impossible length is ignored, and the last cookie in it counts", () => {
    const cookie = (length: number) => Buffer.concat([u16(10, length), Buffer.alloc(length, 0xab)]);
    const answer = (...options: Buffer[]) => ({
      answers: [a("a.test", 60, "1.2.3.4")],
      additional: [record("", 41, 0, Buffer.concat(options), 1232)],
    });
    const other = Buffer.concat([u16(3, 2), Buffer.from("id")]);
    const it = new World(oneServer);
    it.run("query A a.test");
    for (const length of [1, 7, 41]) expect(it.reply(1, answer(cookie(length)))).toEqual([]);
    expect(it.reply(1, answer(cookie(8), other, cookie(7)))).toEqual([]);
    expect(it.reply(1, answer(cookie(7), other, cookie(8)))).toContain("done 0 name=a.test 1.2.3.4/60");
    for (const length of [0, 8, 40]) {
      const it = new World(oneServer);
      it.run("query A a.test");
      expect(it.reply(1, answer(cookie(length)))).toContain("done 0 name=a.test 1.2.3.4/60");
    }
  });

  test("a datagram that cannot be read ends the connection only if it has the id of a query on it", () => {
    const it = new World(oneServer);
    it.run("query A a.test");
    const id = it.sent(1).id;
    for (const stray of [
      "00",
      Buffer.alloc(40, 0xff).toString("hex"),
      u16(id ^ 1).toString("hex"),
      u16(id ^ 1).toString("hex") + "8180",
    ]) {
      expect(it.run(`deliver 1 ${stray}`)).toEqual([]);
    }
    expect(it.run(`deliver 1 ${u16(id).toString("hex")}8180`)).toContain("close 1");
    expect(it.reply(2, { answers: [a("a.test", 60, "1.2.3.4")] })).toContain("done 0 name=a.test 1.2.3.4/60");
  });

  test("after shutdown every request ends at once", () => {
    const it = new World(oneServer);
    it.run("query A a.test", "shutdown");
    const after = it.run("query A b.test", "lookup c.test 0 4", "reverse 10.0.0.1", "nameinfo 10.0.0.1 80");
    expect(after.filter(line => line !== "read /etc/hosts")).toEqual([
      "done 1 error EDESTRUCTION",
      "done 2 error EDESTRUCTION",
      "done 3 error EDESTRUCTION",
      "done 4 error EDESTRUCTION",
    ]);
  });

  test("`options rotate` starts with a server at random", () => {
    const conf = file(
      "/etc/resolv.conf",
      "nameserver 10.0.0.1\nnameserver 10.0.0.2\nnameserver 10.0.0.3\noptions rotate\n",
    );
    const it = new World(conf);
    it.run(...Array.from({ length: 12 }, (_, i) => `query A ${i}.test`));
    const asked = new Set(it.log.filter(line => line.startsWith("open")).map(line => line.split(" ")[3]));
    expect([...asked].sort()).toEqual(["10.0.0.1#53#0", "10.0.0.2#53#0", "10.0.0.3#53#0"]);
  });

  test("a server that failed goes behind the others until it answers", () => {
    const it = new World(twoServers);
    it.run("query A a.test", "expire");
    it.reply(2, { answers: [a("a.test", 60, "1.2.3.4")] });
    expect(it.run("query A b.test").filter(line => line.startsWith("open"))).toEqual(["open 3 udp 10.0.0.2#53#0"]);
  });

  test("a socket that cannot be opened counts against the server", () => {
    const it = new World(twoServers, "opens fail ok");
    expect(it.run("query A a.test").slice(4)).toMatchInlineSnapshot(`
      [
        "open fails udp 10.0.0.1#53#0",
        "open 1 udp 10.0.0.2#53#0",
        "watch 1 r-",
        "send 1 dd7401000001000000000000016104746573740000010001",
        "timer 2000",
      ]
    `);
    const none = new World(oneServer, "tries 2", "opens fail fail");
    expect(none.run("query A a.test").slice(4)).toMatchInlineSnapshot(`
      [
        "open fails udp 10.0.0.1#53#0",
        "open fails udp 10.0.0.1#53#0",
        "done 0 error ECONNREFUSED",
      ]
    `);
  });

  test("setServers() moves the queries of a server that is dropped to another", () => {
    const it = new World(twoServers);
    it.run("query A a.test");
    expect(it.run("servers 10.0.0.2#0#0#0 10.0.0.3#0#0#0")).toMatchInlineSnapshot(`
      [
        "open 2 udp 10.0.0.2#53#0",
        "watch 2 r-",
        "send 2 dd7401000001000000000000016104746573740000010001",
        "close 1",
        "servers 10.0.0.2#53#53#0 10.0.0.3#53#53#0",
      ]
    `);
  });
});

describe("TCP", () => {
  const truncated = (it: World, socket = 1) => it.reply(socket, { truncated: true });

  test("a truncated answer is asked for again on a connection", () => {
    const it = new World(oneServer);
    it.run("query A a.test");
    expect(truncated(it)).toMatchInlineSnapshot(`
      [
        "open 2 tcp 10.0.0.1#53#0",
        "watch 2 rw",
        "close 1",
      ]
    `);
    expect(it.run("writable 2")).toMatchInlineSnapshot(`
      [
        "send 2 0018dd7401000001000000000000016104746573740000010001",
        "watch 2 r-",
      ]
    `);
    expect(it.reply(2, { answers: [a("a.test", 60, "1.2.3.4")] })).toMatchInlineSnapshot(`
      [
        "close 2",
        "done 0 name=a.test 1.2.3.4/60",
        "timer none",
      ]
    `);
  });

  test("an answer may arrive a byte at a time", () => {
    const it = new World(oneServer);
    it.run("query A a.test");
    truncated(it);
    it.run("writable 2");
    const message = encode(it.sent(2), { answers: [a("a.test", 60, "1.2.3.4")] });
    const bytes = [...Buffer.concat([u16(message.length), message])];
    const last = bytes.pop()!;
    expect(it.run(...bytes.map(byte => `deliver 2 ${byte.toString(16).padStart(2, "0")}`))).toEqual([]);
    expect(it.run(`deliver 2 ${last.toString(16).padStart(2, "0")}`)).toContain("done 0 name=a.test 1.2.3.4/60");
  });

  test("several answers may arrive at once, with the start of another", () => {
    const it = new World(oneServer);
    it.run("query A a.test", "query A b.test", "query A c.test");
    const queries = it.messages();
    for (const query of queries) it.reply(1, { truncated: true }, query);
    it.run("writable 2");
    const frames = queries.map((query, i) => {
      const message = encode(query, { answers: [a(query.name, 60, `1.2.3.${i}`)] });
      return Buffer.concat([u16(message.length), message]);
    });
    const all = Buffer.concat(frames);
    const cut = frames[0].length + frames[1].length + 5;
    expect(it.run(`deliver 2 ${all.subarray(0, cut).toString("hex")}`).filter(line => line.startsWith("done"))).toEqual(
      ["done 0 name=a.test 1.2.3.0/60", "done 1 name=b.test 1.2.3.1/60"],
    );
    expect(it.run(`deliver 2 ${all.subarray(cut).toString("hex")}`).filter(line => line.startsWith("done"))).toEqual([
      "done 2 name=c.test 1.2.3.2/60",
    ]);
  });

  test("what the socket does not take is sent when it can be written to again", () => {
    const it = new World(oneServer);
    it.run("query A a.test");
    truncated(it);
    expect(it.run("sends 2 5 block 1", "writable 2", "writable 2", "writable 2", "writable 2")).toMatchInlineSnapshot(`
      [
        "send 2 0018dd7401",
        "send 2 blocks",
        "send 2 00",
        "send 2 0001000000000000016104746573740000010001",
        "watch 2 r-",
      ]
    `);
  });

  test("with TCP Fast Open the query goes out before the connection is made", () => {
    const it = new World(oneServer, "fast-open");
    it.run("query A a.test");
    expect(truncated(it)).toMatchInlineSnapshot(`
      [
        "open 2 tcp 10.0.0.1#53#0",
        "send 2 0018dd7401000001000000000000016104746573740000010001",
        "watch 2 rw",
        "close 1",
      ]
    `);
    expect(it.run("writable 2")).toMatchInlineSnapshot(`
      [
        "watch 2 r-",
      ]
    `);
  });

  test("a connection that breaks is made again for the queries on it", () => {
    const it = new World(oneServer, "tries 2");
    it.run("query A a.test");
    truncated(it);
    it.run("writable 2");
    expect(it.run("break 2")).toMatchInlineSnapshot(`
      [
        "open 3 tcp 10.0.0.1#53#0",
        "watch 3 rw",
        "close 2",
        "timer 3340",
      ]
    `);
    it.run("writable 3");
    expect(it.run("break 3")).toMatchInlineSnapshot(`
      [
        "close 3",
        "done 0 error ECONNREFUSED",
        "timer none",
      ]
    `);
  });

  test("a connection that ends in the middle of an answer is made again at once", () => {
    const it = new World(oneServer, "env RES_OPTIONS use-vc");
    it.run("query A a.test", "writable 1");
    expect(it.run("deliver 1 00")).toEqual([]);
    expect(it.run("deliver 1 -").slice(0, 3)).toEqual(["open 2 tcp 10.0.0.1#53#0", "watch 2 rw", "close 1"]);
  });

  test("`options use-vc` never uses UDP", () => {
    const it = new World(file("/etc/resolv.conf", "nameserver 10.0.0.1\noptions use-vc\n"));
    expect(it.run("query A a.test").slice(4, 6)).toEqual(["open 1 tcp 10.0.0.1#53#0", "watch 1 rw"]);
  });
});

describe("lookup()", () => {
  test("takes the addresses of the type it asked for only", () => {
    const both = [a("a.test", 60, "1.2.3.4"), aaaa("a.test", 60, "20010db8000000000000000000000001")];
    const answered = (family: number) => {
      const it = new World(oneServer);
      it.run(`lookup a.test 0 ${family}`);
      return it.reply(1, { answers: both }).find(line => line.startsWith("done"));
    };
    expect(answered(4)).toBe("done 0 name=a.test 1.2.3.4#0/60");
    expect(answered(6)).toBe("done 0 name=a.test 2001:db8::1#0/60");
    const it = new World(oneServer);
    it.run("lookup a.test 0 4");
    expect(it.reply(1, { answers: both.slice(1) })).toContain("done 0 error ENODATA");
  });

  test("a name is at most 255 bytes on the wire", () => {
    const label = Buffer.alloc(63, "a").toString();
    const ending = (last: number) => `${label}.${label}.${label}.${Buffer.alloc(last, "b")}`;
    const it = new World(oneServer);
    expect(it.run(`query A ${ending(61)}`).some(line => line.startsWith("send 1 "))).toBe(true);
    expect(it.run(`query A ${ending(62)}`, `lookup ${ending(62)}. 0 4`)).toEqual([
      "done 1 error EBADNAME",
      "read /etc/hosts",
      "done 2 error EBADNAME",
    ]);
  });
});

describe("lookupService()", () => {
  const services = [
    "# comment",
    "tcpmux 1/tcp",
    "echo\t\t7/udp",
    "echo\t\t7/tcp",
    "http 80/tcp www # comment",
    "https 443/udp",
    "#ssh 22/tcp",
    "  indented 23/tcp",
    "cut 24/tcp#comment",
    "hex 0x19/tcp",
    "octal 032/tcp",
    "slashes 27//tcp",
    "wrapped 65564/tcp",
    "nothing 29",
    "junk 30x/tcp",
    "\0nul 31/tcp",
    "ends 31/tcp\0",
    "ended\0 34/tcp",
    `${Buffer.alloc(32, "x")} 32/tcp`,
    `${Buffer.alloc(33, "y")} 33/tcp`,
  ].join("\n");

  test("the name from the hosts file or a PTR record, the service from the services file", () => {
    const it = new World(oneServer, file("/etc/hosts", "10.1.1.1 box.test box\n"), file("/etc/services", services));
    expect(
      it
        .run(
          ...[0, 1, 7, 80, 443, 22, 23, 24, 25, 26, 27, 28, 29, 30, 32, 33, 65535, 31, 34].map(
            port => `nameinfo 10.1.1.1 ${port}`,
          ),
        )
        .filter(line => line.startsWith("done")),
    ).toMatchInlineSnapshot(`
      [
        "done 0 name=box.test",
        "done 1 name=box.test service=tcpmux",
        "done 2 name=box.test service=echo",
        "done 3 name=box.test service=http",
        "done 4 name=box.test service=443",
        "done 5 name=box.test service=22",
        "done 6 name=box.test service=indented",
        "done 7 name=box.test service=cut",
        "done 8 name=box.test service=hex",
        "done 9 name=box.test service=octal",
        "done 10 name=box.test service=slashes",
        "done 11 name=box.test service=wrapped",
        "done 12 name=box.test service=29",
        "done 13 name=box.test service=30",
        "done 14 name=box.test service=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "done 15 name=box.test service=%",
        "done 16 name=box.test service=65535",
        "done 17 name=box.test service=ends",
        "done 18 name=box.test service=34",
      ]
    `);
    it.run("nameinfo 10.9.9.9 80");
    expect(it.questions()).toEqual(["1 12 9.9.9.10.in-addr.arpa"]);
    expect(it.reply(1, { answers: [record("9.9.9.10.in-addr.arpa", TYPE.PTR, 60, name("far.test"))] })).toContain(
      "done 19 name=far.test service=http",
    );
    it.run("nameinfo 10.9.9.8 80");
    expect(it.reply(2, { rcode: RCODE.NXDOMAIN })).toContain("done 20 error ENOTFOUND");
  });
});

describe("what is remembered", () => {
  test("an answer, for the lowest TTL in it and an hour at most, with the TTLs counted down", () => {
    const it = new World(oneServer);
    it.run("query A a.test");
    it.reply(1, { answers: [cname("a.test", 100, "b.test"), a("b.test", 50, "1.2.3.4")] });
    expect(it.run("advance 20000", "query A A.TEST")).toEqual(["done 1 name=b.test 1.2.3.4/30"]);
    expect(it.run("advance 29000", "query A a.test")).toEqual(["done 2 name=b.test 1.2.3.4/1"]);
    expect(it.run("advance 1000", "query A a.test")[0]).toBe("open 2 udp 10.0.0.1#53#0");
    it.reply(2, { answers: [a("a.test", 100_000, "1.2.3.4")] });
    expect(it.run("advance 3599000", "query A a.test")).toEqual(["done 4 name=a.test 1.2.3.4/96401"]);
    expect(it.run("advance 1000", "query A a.test")[0]).toBe("open 3 udp 10.0.0.1#53#0");
  });

  test("that there is nothing, for as long as the SOA record says", () => {
    for (const [rcode, error] of [
      [RCODE.NXDOMAIN, "ENOTFOUND"],
      [RCODE.NOERROR, "ENODATA"],
    ] as const) {
      const it = new World(oneServer);
      it.run("query A a.test");
      it.reply(1, { rcode, authority: [soa("test", 300, 30)] });
      expect(it.run("advance 29000", "query A a.test")).toEqual([`done 1 error ${error}`]);
      expect(it.run("advance 1000", "query A a.test")[0]).toBe("open 2 udp 10.0.0.1#53#0");
      it.reply(2, { rcode, authority: [soa("test", 20, 30)] });
      expect(it.run("advance 19000", "query A a.test")).toEqual([`done 3 error ${error}`]);
      expect(it.run("advance 1000", "query A a.test")[0]).toBe("open 3 udp 10.0.0.1#53#0");
      // Nothing says for how long.
      it.reply(3, { rcode });
      expect(it.run("query A a.test")[0]).toBe("open 4 udp 10.0.0.1#53#0");
    }
  });

  test("not a failure, a truncated answer or a TTL of 0", () => {
    for (const reply of [{ rcode: RCODE.SERVFAIL }, { answers: [a("a.test", 0, "1.2.3.4")] }]) {
      const it = new World(oneServer);
      it.run("query A a.test");
      it.reply(1, reply);
      expect(it.run("query A a.test")[0]).toBe("open 2 udp 10.0.0.1#53#0");
    }
    // TCP has no more to say than a truncated answer, so that one is handed over.
    const it = new World(oneServer, "tries 1");
    it.run("query A a.test");
    it.reply(1, { truncated: true });
    it.run("writable 2");
    expect(it.reply(2, { truncated: true, answers: [a("a.test", 60, "1.2.3.4")] })).toContain(
      "done 0 name=a.test 1.2.3.4/60",
    );
    expect(it.run("query A a.test")[0]).toBe("open 3 udp 10.0.0.1#53#0");
  });
});

// What c-ares 1.34.9, unmodified but for its random numbers, logged for the same scripts, with each call it makes of libc
// answered from the same made-up world: c-ares-driver/regenerate.ts writes the logs again. The numbered scripts reach every
// line of the resolver that a script for Linux can. Each of the others pins a case that those miss.
describe("c-ares", () => {
  /** What its driver says to whatever follows `shutdown`, and stops. */
  const AFTER_THE_END = "! after the end\n";

  /**
   * c-ares says what became of its sockets after everything else a call did, tells of states it only passes through, and
   * closes in another order. So this is, for each command, every other line, then where each socket ended up if that is news.
   */
  function normalized(log: string): string[][] {
    const known = new Map<string, string>();
    return log
      .split(AFTER_THE_END)[0]
      .split("? @\n")
      .map(part => {
        const lines = part.split("\n").filter(line => line !== "");
        const isAboutASocket = (line: string) => line.startsWith("watch ") || line.startsWith("close ");
        const touched = new Map<string, string>();
        for (const line of lines.filter(isAboutASocket)) {
          const [what, socket, events] = line.split(" ");
          touched.set(socket, what === "close" ? "closed" : events);
        }
        const news = [...touched].filter(([socket, state]) => known.get(socket) !== state).sort();
        for (const [socket, state] of news) known.set(socket, state);
        return [
          ...lines.filter(line => !isAboutASocket(line)),
          ...news.map(([socket, state]) => `${socket} is ${state}`),
        ];
      });
  }

  const entries = read().entries.map(entry => ({ ...entry, script: marked(entry.script) }));

  test("there are entries", () => {
    expect(entries.length).toBeGreaterThan(200);
  });

  test.each(entries.filter(entry => entry.ours === undefined))("did the same: $title", ({ script, theirs }) => {
    const expected = normalized(theirs);
    const log = normalized(dnsSimulate(script));
    expect(theirs.includes(AFTER_THE_END) ? log.slice(0, expected.length) : log).toEqual(expected);
  });

  test.each(entries.filter(entry => entry.ours !== undefined))("$title", ({ script, theirs, ours }) => {
    const log = dnsSimulate(script);
    expect(log).toBe(ours!);
    expect(normalized(log)).not.toEqual(normalized(theirs));
  });
});
