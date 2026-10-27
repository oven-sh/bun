// node-dns.test.js resolves public hostnames. These tests need no network.
import { describe, expect, test } from "bun:test";
import { isLinux, runWithError } from "harness";
import dns from "node:dns";
import {
  a,
  aaaa,
  cname,
  dnsServer,
  type DnsServer,
  encode,
  name,
  type Query,
  QUESTION_NAME,
  RCODE,
  record,
  text,
  TYPE,
  u16,
  u32,
} from "./dns-server";

describe.each([
  ["dns.Resolver", dns.Resolver],
  ["dns.promises.Resolver", dns.promises.Resolver],
])("%s", (_name, Resolver: any) => {
  test("an instance has Resolver.prototype", () => {
    const resolver = new Resolver();
    expect(Object.getPrototypeOf(resolver)).toBe(Resolver.prototype);
    expect(resolver.constructor).toBe(Resolver);
  });

  test("a subclass instance has the subclass prototype and its own servers", () => {
    class PinnedResolver extends Resolver {
      getServers() {
        return super.getServers().map((server: string) => `pinned ${server}`);
      }
    }

    const resolver = new (PinnedResolver as any)({ timeout: 1000, tries: 1 });
    expect(Object.getPrototypeOf(resolver)).toBe(PinnedResolver.prototype);
    expect(resolver).toBeInstanceOf(Resolver);

    resolver.setServers(["192.0.2.1"]);
    expect(resolver.getServers()).toEqual(["pinned 192.0.2.1"]);
    expect(dns.getServers()).not.toContain("192.0.2.1");
  });

  test("throws a TypeError when called without new", () => {
    expect(() => Resolver()).toThrow(TypeError);
  });

  test.each([
    ["resolve", "ERR_INVALID_ARG_TYPE"],
    ["resolveAny", "ERR_INVALID_ARG_TYPE"],
    ["reverse", "ERR_INVALID_ARG_TYPE"],
    ["setLocalAddress", "ERR_INVALID_IP_ADDRESS"],
    ["setServers", "ERR_INVALID_ARG_TYPE"],
  ])("_handle.%s() treats a missing argument as undefined", (method, code) => {
    const handle = new Resolver()._handle;
    const missing = runWithError(() => handle[method]());
    expect(missing).toMatchObject({ name: "TypeError", code });
    expect(missing).toEqual(runWithError(() => handle[method](undefined)));
  });
});

function resolverFor(servers: DnsServer | DnsServer[], options?: dns.ResolverOptions) {
  const resolver = new dns.promises.Resolver(options);
  resolver.setServers([servers].flat().map(server => server.address));
  return resolver;
}

/** What a rejected query says, without the stack. */
async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    value => {
      throw new Error(`resolved with ${JSON.stringify(value)}`);
    },
    error => error,
  );
  const { name, code, errno, syscall, hostname, message } = error;
  return { name, code, errno, syscall, hostname, message };
}

const sent = (server: DnsServer) => server.queries.map(query => `${query.transport} ${query.type} ${query.name}`);

describe.concurrent("a resolver and a local server", () => {
  const records: Record<number, (owner: string) => Buffer[]> = {
    [TYPE.A]: owner => [a(owner, 60, "1.2.3.4"), a(owner, 70, "5.6.7.8")],
    [TYPE.AAAA]: owner => [aaaa(owner, 80, "20010db8000000000000000000000001")],
    [TYPE.MX]: owner => [record(owner, TYPE.MX, 90, Buffer.concat([u16(10), name("mail.test")]))],
    [TYPE.TXT]: owner => [
      record(owner, TYPE.TXT, 90, Buffer.concat([text("hello"), text("world")])),
      record(owner, TYPE.TXT, 90, text("second")),
    ],
    [TYPE.NS]: owner => [record(owner, TYPE.NS, 90, name("ns1.test")), record(owner, TYPE.NS, 90, name("ns2.test"))],
    [TYPE.CNAME]: owner => [cname(owner, 90, "target.test")],
    [TYPE.SOA]: owner => [
      record(owner, TYPE.SOA, 90, Buffer.concat([name("ns.test"), name("admin.test"), u32(1, 2, 3, 4, 5)])),
    ],
    [TYPE.PTR]: owner => [
      record(owner, TYPE.PTR, 90, name("ptr1.test")),
      record(owner, TYPE.PTR, 90, name("ptr2.test")),
    ],
    [TYPE.SRV]: owner => [record(owner, TYPE.SRV, 90, Buffer.concat([u16(1, 2, 443), name("srv.test")]))],
    [TYPE.NAPTR]: owner => [
      record(owner, TYPE.NAPTR, 90, Buffer.concat([u16(1, 2), text("S"), text("SIP+D2U"), text(""), name("sip.test")])),
    ],
    [TYPE.CAA]: owner => [
      record(owner, TYPE.CAA, 90, Buffer.concat([Buffer.from([0]), text("issue"), Buffer.from("ca.test")])),
      record(owner, TYPE.CAA, 90, Buffer.concat([Buffer.from([128]), text("iodef"), Buffer.from("mailto:a@ca.test")])),
    ],
  };

  const everything = () =>
    dnsServer(query => ({
      answers:
        query.type === TYPE.ANY
          ? Object.values(records).flatMap(make => make(query.name))
          : (records[query.type]?.(query.name) ?? []),
    }));

  test("every kind of record", async () => {
    await using server = await everything();
    const resolver = resolverFor(server);
    expect({
      A: await resolver.resolve4("a.test"),
      // Another name: an answer from the cache has had its age taken off its TTLs.
      "A with ttl": await resolver.resolve4("ttl.test", { ttl: true }),
      AAAA: await resolver.resolve6("a.test"),
      "AAAA with ttl": await resolver.resolve6("ttl.test", { ttl: true }),
      MX: await resolver.resolveMx("a.test"),
      TXT: await resolver.resolveTxt("a.test"),
      NS: await resolver.resolveNs("a.test"),
      CNAME: await resolver.resolveCname("a.test"),
      SOA: await resolver.resolveSoa("a.test"),
      PTR: await resolver.resolvePtr("a.test"),
      SRV: await resolver.resolveSrv("a.test"),
      NAPTR: await resolver.resolveNaptr("a.test"),
      CAA: await resolver.resolveCaa("a.test"),
    }).toMatchInlineSnapshot(`
      {
        "A": [
          "1.2.3.4",
          "5.6.7.8",
        ],
        "A with ttl": [
          {
            "address": "1.2.3.4",
            "ttl": 60,
          },
          {
            "address": "5.6.7.8",
            "ttl": 70,
          },
        ],
        "AAAA": [
          "2001:db8::1",
        ],
        "AAAA with ttl": [
          {
            "address": "2001:db8::1",
            "ttl": 80,
          },
        ],
        "CAA": [
          {
            "critical": 0,
            "issue": "ca.test",
          },
          {
            "critical": 128,
            "iodef": "mailto:a@ca.test",
          },
        ],
        "CNAME": [
          "target.test",
        ],
        "MX": [
          {
            "exchange": "mail.test",
            "priority": 10,
          },
        ],
        "NAPTR": [
          {
            "flags": "S",
            "order": 1,
            "preference": 2,
            "regexp": "",
            "replacement": "sip.test",
            "service": "SIP+D2U",
          },
        ],
        "NS": [
          "ns1.test",
          "ns2.test",
        ],
        "PTR": [
          "ptr1.test",
          "ptr2.test",
        ],
        "SOA": {
          "expire": 4,
          "hostmaster": "admin.test",
          "minttl": 5,
          "nsname": "ns.test",
          "refresh": 2,
          "retry": 3,
          "serial": 1,
        },
        "SRV": [
          {
            "name": "srv.test",
            "port": 443,
            "priority": 1,
            "weight": 2,
          },
        ],
        "TXT": [
          [
            "hello",
          ],
          [
            "world",
          ],
          [
            "second",
          ],
        ],
      }
    `);
  });

  test("resolveAny()", async () => {
    await using server = await everything();
    expect(await resolverFor(server).resolveAny("a.test")).toMatchInlineSnapshot(`
      [
        {
          "address": "1.2.3.4",
          "ttl": 60,
          "type": "A",
        },
        {
          "address": "5.6.7.8",
          "ttl": 70,
          "type": "A",
        },
        {
          "address": "2001:db8::1",
          "ttl": 80,
          "type": "AAAA",
        },
        {
          "exchange": "mail.test",
          "priority": 10,
          "type": "MX",
        },
        {
          "type": "NS",
          "value": "ns1.test",
        },
        {
          "type": "NS",
          "value": "ns2.test",
        },
        {
          "entries": [
            "hello",
            "world",
            "second",
          ],
          "type": "TXT",
        },
        {
          "name": "srv.test",
          "port": 443,
          "priority": 1,
          "type": "SRV",
          "weight": 2,
        },
        {
          "type": "PTR",
          "value": "ptr1.test",
        },
        {
          "type": "PTR",
          "value": "ptr2.test",
        },
        {
          "flags": "S",
          "order": 1,
          "preference": 2,
          "regexp": "",
          "replacement": "sip.test",
          "service": "SIP+D2U",
          "type": "NAPTR",
        },
        {
          "expire": 4,
          "hostmaster": "admin.test",
          "minttl": 5,
          "nsname": "ns.test",
          "refresh": 2,
          "retry": 3,
          "serial": 1,
          "type": "SOA",
        },
        {
          "critical": 0,
          "issue": "ca.test",
          "type": "CAA",
        },
        {
          "critical": 128,
          "iodef": "mailto:a@ca.test",
          "type": "CAA",
        },
      ]
    `);
  });

  test("resolve() takes the record type by name", async () => {
    await using server = await everything();
    const resolver = resolverFor(server);
    expect(await resolver.resolve("a.test")).toEqual(["1.2.3.4", "5.6.7.8"]);
    expect(await resolver.resolve("a.test", "MX")).toEqual([{ exchange: "mail.test", priority: 10 }]);
    expect(await resolver.resolve("a.test", "PTR")).toEqual(["ptr1.test", "ptr2.test"]);
  });

  test("a query asks for recursion and carries nothing but the question", async () => {
    await using server = await everything();
    await resolverFor(server).resolve4("a.test");
    const [{ message, id }] = server.queries;
    expect(message.toString("hex")).toBe(
      Buffer.concat([u16(id, 0x0100, 1, 0, 0, 0), name("a.test"), u16(TYPE.A, 1)]).toString("hex"),
    );
  });

  test("reverse() asks for the PTR records of the address", async () => {
    await using server = await everything();
    const resolver = resolverFor(server);
    expect(await resolver.reverse("9.8.7.6")).toEqual(["ptr1.test", "ptr2.test"]);
    expect(await resolver.reverse("2001:db8::1")).toEqual(["ptr1.test", "ptr2.test"]);
    expect(sent(server)).toEqual([
      "udp 12 6.7.8.9.in-addr.arpa",
      "udp 12 1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa",
    ]);
  });

  test.each([
    ["NXDOMAIN", "ENOTFOUND", 4],
    ["FORMERR", "EFORMERR", 2],
    ["SERVFAIL", "ESERVFAIL", 3],
    ["NOTIMP", "ENOTIMP", 5],
    ["REFUSED", "EREFUSED", 6],
  ] as const)("%s is %s", async (rcode, code, errno) => {
    await using server = await dnsServer(() => ({ rcode: RCODE[rcode] }));
    await using other = await dnsServer(query => ({ answers: [a(query.name, 60, "1.2.3.4")] }));
    expect(await failure(resolverFor([server, other]).resolve4("a.test"))).toEqual({
      name: "DNSException",
      code,
      errno,
      syscall: "queryA",
      hostname: "a.test",
      message: `queryA ${code} a.test`,
    });
    // What a server says is the answer, whatever it says.
    expect(server.queries.length).toBe(1);
    expect(other.queries).toEqual([]);
  });

  test("an answer without records is ENOTFOUND", async () => {
    await using server = await dnsServer(() => ({}));
    const resolver = resolverFor(server);
    const methods = ["4", "6", "Mx", "Soa", "Txt", "Ns", "Srv", "Naptr", "Caa", "Ptr", "Cname", "Any"] as const;
    const failures = await Promise.all(methods.map(method => failure(resolver[`resolve${method}`]("a.test"))));
    expect(failures.map(({ message }) => message)).toEqual([
      "queryA ENOTFOUND a.test",
      "queryAaaa ENOTFOUND a.test",
      "queryMx ENOTFOUND a.test",
      "querySoa ENOTFOUND a.test",
      "queryTxt ENOTFOUND a.test",
      "queryNs ENOTFOUND a.test",
      "querySrv ENOTFOUND a.test",
      "queryNaptr ENOTFOUND a.test",
      "queryCaa ENOTFOUND a.test",
      "queryPtr ENOTFOUND a.test",
      "queryCname ENOTFOUND a.test",
      "queryAny ENOTFOUND a.test",
    ]);
    expect(await failure(resolver.reverse("1.2.3.4"))).toMatchObject({
      message: "getHostByAddr ENOTFOUND 1.2.3.4",
      syscall: "getHostByAddr",
      hostname: "1.2.3.4",
    });
  });

  test("an address is found at the end of a chain of aliases", async () => {
    await using server = await dnsServer(query => ({
      answers: [
        cname(query.name, 300, "one.test"),
        cname("one.test", 20, "two.test"),
        a("two.test", 100, "1.2.3.4"),
        a("two.test", 10, "5.6.7.8"),
      ],
    }));
    expect(await resolverFor(server).resolve4("a.test", { ttl: true })).toMatchInlineSnapshot(`
      [
        {
          "address": "1.2.3.4",
          "ttl": 20,
        },
        {
          "address": "5.6.7.8",
          "ttl": 10,
        },
      ]
    `);
  });

  test("names are compressed, and are printed with escapes", async () => {
    await using server = await dnsServer(query => ({
      answers: [
        record(QUESTION_NAME, TYPE.NS, 60, Buffer.concat([text("ns"), QUESTION_NAME])),
        record(QUESTION_NAME, TYPE.NS, 60, name(["a.b", "c\\d", Buffer.from([0x01, 0x7f, 0xff]), "e f", '"(;)@$'])),
      ],
    }));
    expect(await resolverFor(server).resolveNs("a.test")).toMatchInlineSnapshot(`
      [
        "ns.a.test",
        "a\\.b.c\\\\d.\\001\\127\\255.e f.\\"\\(\\;\\)\\@\\$",
      ]
    `);
  });

  test("the question of a reply may differ in case", async () => {
    await using server = await dnsServer(query => ({
      question: Buffer.concat([name("A.TeSt"), u16(query.type, 1)]),
      answers: [a("A.TeSt", 60, "1.2.3.4")],
    }));
    expect(await resolverFor(server).resolve4("a.test")).toEqual(["1.2.3.4"]);
  });

  test("replies to something else are ignored", async () => {
    await using server = await dnsServer(query => [
      encode(query, { id: query.id ^ 1, answers: [a(query.name, 60, "6.6.6.1")] }),
      encode(query, {
        question: Buffer.concat([name("b.test"), u16(query.type, 1)]),
        answers: [a("b.test", 60, "6.6.6.2")],
      }),
      encode(query, {
        question: Buffer.concat([name(query.name), u16(TYPE.AAAA, 1)]),
        answers: [a(query.name, 60, "6.6.6.3")],
      }),
      encode(query, { answers: [a(query.name, 60, "1.2.3.4")] }),
    ]);
    expect(await resolverFor(server).resolve4("a.test")).toEqual(["1.2.3.4"]);
    expect(server.queries.length).toBe(1);
  });

  test.each([
    ["shorter than a header", (query: Query) => u16(query.id, 0x8180, 1)],
    [
      "cut off in a record",
      (query: Query) => encode(query, { answers: [a(query.name, 60, "1.2.3.4")] }).subarray(0, -2),
    ],
    [
      "a name that points at itself",
      (query: Query) =>
        encode(query, { answers: [record(Buffer.from([0xc0, 12 + query.question.length]), 1, 60, u32(1))] }),
    ],
    [
      "an address of 3 bytes",
      (query: Query) => encode(query, { answers: [record(query.name, 1, 60, Buffer.alloc(3))] }),
    ],
    ["no question", (query: Query) => Buffer.concat([u16(query.id, 0x8180, 0, 1, 0, 0), a(query.name, 60, "1.2.3.4")])],
  ])("a malformed reply is EBADRESP once every try got one: %s", async (_, reply) => {
    await using server = await dnsServer(reply);
    expect(await failure(resolverFor(server, { tries: 2 }).resolve4("a.test"))).toMatchObject({
      code: "EBADRESP",
      errno: 10,
    });
    expect(server.queries.length).toBe(2);
  });

  test("bytes after the last record are ignored", async () => {
    await using server = await dnsServer(query =>
      Buffer.concat([encode(query, { answers: [a(query.name, 60, "1.2.3.4")] }), Buffer.from("junk")]),
    );
    expect(await resolverFor(server).resolve4("a.test")).toEqual(["1.2.3.4"]);
  });

  test("only the answer section and the class IN count, and a ttl is at most 2^31 - 1", async () => {
    await using server = await dnsServer(query => ({
      answers: [
        a(query.name, 0xffffffff, "1.2.3.4"),
        record(query.name, TYPE.A, 60, Buffer.from([7, 7, 7, 7]), 3),
        aaaa(query.name, 60, "20010db8000000000000000000000001"),
      ],
      authority: [a(query.name, 60, "8.8.8.8")],
      additional: [a(query.name, 60, "8.8.4.4")],
    }));
    expect(await resolverFor(server).resolve4("a.test", { ttl: true })).toEqual([
      { address: "1.2.3.4", ttl: 2147483647 },
    ]);
  });

  test("a truncated reply is asked for again over TCP", async () => {
    await using server = await dnsServer(query =>
      query.transport === "udp" ? { truncated: true } : { answers: [a(query.name, 60, "1.2.3.4")] },
    );
    expect(await resolverFor(server).resolve4("a.test")).toEqual(["1.2.3.4"]);
    expect(sent(server)).toEqual(["udp 1 a.test", "tcp 1 a.test"]);
  });

  test("queries over TCP share a connection", async () => {
    const names = ["a.test", "b.test", "c.test"];
    const all = Promise.withResolvers<void>();
    let waiting = 0;
    await using server = await dnsServer(async query => {
      if (query.transport === "udp") return { truncated: true };
      if (++waiting === names.length) all.resolve();
      await all.promise;
      return { answers: [a(query.name, 60, `1.2.3.${names.indexOf(query.name)}`)] };
    });
    const resolver = resolverFor(server);
    expect(await Promise.all(names.map(name => resolver.resolve4(name)))).toEqual([
      ["1.2.3.0"],
      ["1.2.3.1"],
      ["1.2.3.2"],
    ]);
    expect(server.connections).toBe(1);
  });

  test("a server that hangs up on TCP is asked again", async () => {
    await using server = await dnsServer(query => (query.transport === "udp" ? { truncated: true } : "hang up"));
    expect(await failure(resolverFor(server, { tries: 2 }).resolve4("a.test"))).toMatchObject({
      code: "ECONNREFUSED",
      errno: 11,
    });
    expect(sent(server)).toEqual(["udp 1 a.test", "tcp 1 a.test", "tcp 1 a.test"]);
    expect(server.connections).toBe(2);
  });

  test("a server that never answers is asked `tries` times", async () => {
    await using server = await dnsServer(() => undefined);
    expect(await failure(resolverFor(server, { timeout: 1, tries: 2 }).resolve4("a.test"))).toEqual({
      name: "DNSException",
      code: "ETIMEOUT",
      errno: 12,
      syscall: "queryA",
      hostname: "a.test",
      message: "queryA ETIMEOUT a.test",
    });
    expect(sent(server)).toEqual(["udp 1 a.test", "udp 1 a.test"]);
  });

  test("the next server is asked when one does not answer", async () => {
    await using silent = await dnsServer(() => undefined);
    await using server = await dnsServer(query => ({ answers: [a(query.name, 60, "1.2.3.4")] }));
    expect(await resolverFor([silent, server], { timeout: 1 }).resolve4("a.test")).toEqual(["1.2.3.4"]);
    expect(sent(silent)[0]).toBe("udp 1 a.test");
  });

  test("the next server is asked when nothing listens on one", async () => {
    let closed: DnsServer;
    {
      await using gone = await dnsServer(() => undefined);
      closed = gone;
    }
    await using server = await dnsServer(query => ({ answers: [a(query.name, 60, "1.2.3.4")] }));
    expect(await resolverFor([closed, server]).resolve4("a.test")).toEqual(["1.2.3.4"]);
  });

  test("nothing listens on the only server", async () => {
    let closed: DnsServer;
    {
      await using gone = await dnsServer(() => undefined);
      closed = gone;
    }
    expect(await failure(resolverFor(closed).resolve4("a.test"))).toMatchObject({ code: "ECONNREFUSED", errno: 11 });
  });

  test("an answer is remembered for as long as it says", async () => {
    await using server = await dnsServer(query => ({
      answers: [a(query.name, query.name === "fleeting.test" ? 0 : 60, "1.2.3.4")],
    }));
    const resolver = resolverFor(server);
    for (let i = 0; i < 2; i++) {
      expect(await resolver.resolve4("lasting.test")).toEqual(["1.2.3.4"]);
      expect(await resolver.resolve4("LASTING.test")).toEqual(["1.2.3.4"]);
      expect(await resolver.resolve4("fleeting.test")).toEqual(["1.2.3.4"]);
    }
    expect(sent(server)).toMatchInlineSnapshot(`
      [
        "udp 1 lasting.test",
        "udp 1 fleeting.test",
        "udp 1 fleeting.test",
      ]
    `);
  });

  test("that a name does not exist is remembered if the reply says for how long", async () => {
    const soa = record("test", TYPE.SOA, 60, Buffer.concat([name("ns.test"), name("admin.test"), u32(1, 2, 3, 4, 30)]));
    await using server = await dnsServer(query => ({
      rcode: RCODE.NXDOMAIN,
      authority: query.name === "soa.test" ? [soa] : [],
    }));
    const resolver = resolverFor(server);
    for (let i = 0; i < 2; i++) {
      expect(await failure(resolver.resolve4("soa.test"))).toMatchObject({ code: "ENOTFOUND" });
      expect(await failure(resolver.resolve4("bare.test"))).toMatchObject({ code: "ENOTFOUND" });
    }
    expect(sent(server)).toEqual(["udp 1 soa.test", "udp 1 bare.test", "udp 1 bare.test"]);
  });

  test("that a name has no record of a type is remembered if the reply says for how long", async () => {
    const soa = record("test", TYPE.SOA, 60, Buffer.concat([name("ns.test"), name("admin.test"), u32(1, 2, 3, 4, 30)]));
    await using server = await dnsServer(query => ({ authority: query.name === "soa.test" ? [soa] : [] }));
    const resolver = resolverFor(server);
    for (let i = 0; i < 2; i++) {
      expect(await failure(resolver.resolve4("soa.test"))).toMatchObject({ code: "ENOTFOUND" });
      expect(await failure(resolver.resolve4("bare.test"))).toMatchObject({ code: "ENOTFOUND" });
    }
    expect(sent(server)).toEqual(["udp 1 soa.test", "udp 1 bare.test", "udp 1 bare.test"]);
  });

  test("setServers() forgets what was remembered", async () => {
    await using first = await dnsServer(query => ({ answers: [a(query.name, 60, "1.1.1.1")] }));
    await using second = await dnsServer(query => ({ answers: [a(query.name, 60, "2.2.2.2")] }));
    const resolver = resolverFor(first);
    expect(await resolver.resolve4("a.test")).toEqual(["1.1.1.1"]);
    resolver.setServers([second.address]);
    expect(await resolver.resolve4("a.test")).toEqual(["2.2.2.2"]);
  });

  test("the same question asked twice at once is sent once", async () => {
    await using server = await dnsServer(query => ({ answers: [a(query.name, 0, "1.2.3.4")] }));
    const resolver = resolverFor(server);
    expect(
      await Promise.all([
        resolver.resolve4("a.test"),
        resolver.resolve4("a.test", { ttl: true }),
        resolver.resolve6("a.test").catch(error => error.code),
      ]),
    ).toEqual([["1.2.3.4"], [{ address: "1.2.3.4", ttl: 0 }], "ENOTFOUND"]);
    expect(sent(server).sort()).toEqual(["udp 1 a.test", "udp 28 a.test"]);
  });

  test("cancel() ends what is in flight with ECANCELLED", async () => {
    const asked = Promise.withResolvers<void>();
    await using server = await dnsServer(query => {
      if (query.index === 1) asked.resolve();
      return undefined;
    });
    const resolver = resolverFor(server);
    const pending = [failure(resolver.resolve4("a.test")), failure(resolver.reverse("1.2.3.4"))];
    await asked.promise;
    resolver.cancel();
    expect(await Promise.all(pending)).toMatchInlineSnapshot(`
      [
        {
          "code": "ECANCELLED",
          "errno": 24,
          "hostname": "a.test",
          "message": "queryA ECANCELLED a.test",
          "name": "DNSException",
          "syscall": "queryA",
        },
        {
          "code": "ECANCELLED",
          "errno": 24,
          "hostname": "1.2.3.4",
          "message": "getHostByAddr ECANCELLED 1.2.3.4",
          "name": "DNSException",
          "syscall": "getHostByAddr",
        },
      ]
    `);
    // It can be used again.
    expect(resolver.getServers()).toEqual([server.address]);
  });

  test("a query made from the callback of a cancelled one is not cancelled", async () => {
    const asked = Promise.withResolvers<void>();
    await using server = await dnsServer(query => {
      if (query.name === "first.test") return void asked.resolve();
      return { answers: [a(query.name, 60, "1.2.3.4")] };
    });
    const resolver = new dns.Resolver();
    resolver.setServers([server.address]);
    const { promise, resolve } = Promise.withResolvers<unknown>();
    resolver.resolve4("first.test", error => {
      resolver.resolve4("second.test", (_, addresses) => resolve([error?.code, addresses]));
    });
    await asked.promise;
    resolver.cancel();
    expect(await promise).toEqual(["ECANCELLED", ["1.2.3.4"]]);
  });

  test("setServers() while a query is in flight", async () => {
    const asked = Promise.withResolvers<void>();
    await using server = await dnsServer(() => void asked.resolve());
    const resolver = resolverFor(server);
    const pending = failure(resolver.resolve4("a.test"));
    await asked.promise;
    expect(runWithError(() => resolver.setServers(["127.0.0.1"]))).toMatchObject({
      code: "ERR_DNS_SET_SERVERS_FAILED",
    });
    expect(resolver.getServers()).toEqual([server.address]);
    resolver.cancel();
    expect(await pending).toMatchObject({ code: "ECANCELLED" });
  });

  test("getServers() prints a port only if it is not 53", () => {
    const resolver = new dns.promises.Resolver();
    resolver.setServers(["1.2.3.4", "1.2.3.4:53", "1.2.3.4:5353", "::1", "[::1]:53", "[2001:db8::1]:5353"]);
    expect(resolver.getServers()).toMatchInlineSnapshot(`
      [
        "1.2.3.4",
        "1.2.3.4:5353",
        "::1",
        "[2001:db8::1]:5353",
      ]
    `);
  });

  test.skipIf(!isLinux)("setLocalAddress() chooses where queries come from", async () => {
    await using server = await dnsServer(query =>
      query.transport === "udp" && query.name === "tcp.test"
        ? { truncated: true }
        : { answers: [a(query.name, 60, "1.2.3.4")] },
    );
    const resolver = resolverFor(server);
    resolver.setLocalAddress("127.0.0.9");
    await resolver.resolve4("udp.test");
    await resolver.resolve4("tcp.test");
    expect(server.queries.map(query => `${query.transport} ${query.from}`)).toEqual([
      "udp 127.0.0.9",
      "udp 127.0.0.9",
      "tcp 127.0.0.9",
    ]);
  });

  test.each([
    ["a space", "a b.test"],
    ["an empty label", "a..test"],
    ["a leading dot", ".a.test"],
    ["a label of 64 bytes", `${Buffer.alloc(64, "a")}.test`],
    ["an escape of nothing", "a\\"],
    ["a byte that is not ASCII", "\u00e9.test"],
  ])("a name that cannot be sent: %s", async (_, hostname) => {
    await using server = await dnsServer(() => ({}));
    expect(await failure(resolverFor(server).resolve4(hostname))).toEqual({
      name: "DNSException",
      code: "ENOTFOUND",
      errno: 8,
      syscall: "queryA",
      hostname,
      message: `queryA ENOTFOUND ${hostname}`,
    });
    expect(server.queries).toEqual([]);
  });

  test.each([
    ["a.test.", ["a", "test"]],
    [".", []],
    ["_x._tcp.test", ["_x", "_tcp", "test"]],
    ["a\\.b.test", ["a.b", "test"]],
    ["a\\065.test", ["aA", "test"]],
    [`${Buffer.alloc(63, "a")}.test`, [Buffer.alloc(63, "a").toString(), "test"]],
  ])("%s is sent as its labels", async (hostname, labels) => {
    await using server = await dnsServer(() => ({ answers: [a(QUESTION_NAME, 60, "1.2.3.4")] }));
    expect(await resolverFor(server).resolve4(hostname)).toEqual(["1.2.3.4"]);
    expect(server.queries.map(query => query.question.toString("hex"))).toEqual([
      Buffer.concat([name(labels), u16(TYPE.A, 1)]).toString("hex"),
    ]);
  });

  test("a name under .onion is never sent", async () => {
    await using server = await dnsServer(() => ({}));
    expect(await failure(resolverFor(server).resolve4("x.onion"))).toMatchObject({ code: "ENOTFOUND" });
    expect(server.queries).toEqual([]);
  });
});

// Not beside the tests above: these keep the thread busy for longer than a query of theirs may take.
describe("a resolver with much to do", () => {
  test("a reply over TCP of nearly 64 KiB", async () => {
    const addresses = Array.from({ length: 4000 }, (_, i) => `10.0.${i >> 8}.${i & 255}`);
    await using server = await dnsServer(query =>
      query.transport === "udp"
        ? { truncated: true }
        : { answers: addresses.map(address => a(QUESTION_NAME, 60, address)) },
    );
    expect(await resolverFor(server).resolve4("a.test")).toEqual(addresses);
  });

  test("300 questions at once", async () => {
    await using server = await dnsServer(query => ({
      answers: [a(query.name, 60, `10.0.${parseInt(query.name) >> 8}.${parseInt(query.name) & 255}`)],
    }));
    const resolver = resolverFor(server);
    const count = 300;
    const results = await Promise.all(Array.from({ length: count }, (_, i) => resolver.resolve4(`${i}.test`)));
    expect(results).toEqual(Array.from({ length: count }, (_, i) => [`10.0.${i >> 8}.${i & 255}`]));
    expect(new Set(server.queries.map(query => query.id)).size).toBe(count);
  });
});
