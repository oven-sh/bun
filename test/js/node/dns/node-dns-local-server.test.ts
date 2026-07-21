// node:dns Resolver tests against an in-process authoritative UDP DNS server
// (RFC 1035). Deterministic: every query goes to 127.0.0.1, never the network.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import dgram from "node:dgram";
import * as dns from "node:dns";
import * as dns_promises from "node:dns/promises";
import { once } from "node:events";

// zone: name -> { TYPE: [rrdata, ...] }. A TXT rrdata is the array of
// <character-string>s carried by ONE resource record (RFC 1035 section 3.3.14).
const ZONES: Record<string, Record<string, string[][]>> = {
  "txt.bun.test": {
    TXT: [
      ["hello", "world"], // one RR split into two character-strings
      ["single"],
    ],
  },
  // Exists (has TXT) but has no address records: an A query is NODATA.
  "onlytxt.bun.test": { TXT: [["only"]] },
};
const TYPE: Record<string, number> = { TXT: 16 };
const TYPENAME: Record<number, string> = { 16: "TXT", 255: "ANY" };

let server: dgram.Socket;
let serverList: string[];
let resolver: dns.Resolver;
let promiseResolver: InstanceType<typeof dns_promises.Resolver>;

beforeAll(async () => {
  server = dgram.createSocket("udp4");
  server.on("message", (msg, rinfo) => {
    // QNAME starts at offset 12: length-prefixed labels ending with a 0 byte.
    let off = 12;
    const labels: string[] = [];
    while (msg[off] !== 0) {
      labels.push(msg.toString("ascii", off + 1, off + 1 + msg[off]));
      off += 1 + msg[off];
    }
    off += 1;
    const qtype = msg.readUInt16BE(off);
    const question = msg.subarray(12, off + 4);

    const zone = ZONES[labels.join(".").toLowerCase()];
    let rcode = 0;
    const answers: Buffer[] = [];
    if (!zone) {
      rcode = 3; // NXDOMAIN
    } else {
      const wanted = TYPENAME[qtype];
      const types = wanted === "ANY" ? Object.keys(zone) : zone[wanted] ? [wanted] : [];
      for (const t of types) {
        for (const rr of zone[t]) {
          // TXT RDATA: each character-string is length-prefixed.
          const rdata = Buffer.concat(rr.map(s => Buffer.concat([Buffer.from([s.length]), Buffer.from(s, "ascii")])));
          const rrHeader = Buffer.alloc(12);
          rrHeader.writeUInt16BE(0xc00c, 0); // NAME: pointer back to the qname at offset 12
          rrHeader.writeUInt16BE(TYPE[t], 2);
          rrHeader.writeUInt16BE(1, 4); // class IN
          rrHeader.writeUInt32BE(60, 6); // TTL
          rrHeader.writeUInt16BE(rdata.length, 10);
          answers.push(Buffer.concat([rrHeader, rdata]));
        }
      }
      // The name exists but has no RRs of this type: NOERROR with 0 answers.
    }

    const header = Buffer.alloc(12);
    msg.copy(header, 0, 0, 2); // echo the query id
    header.writeUInt16BE(0x8180 | rcode, 2); // QR=1 RD=1 RA=1
    header.writeUInt16BE(1, 4); // QDCOUNT
    header.writeUInt16BE(answers.length, 6); // ANCOUNT
    server.send(Buffer.concat([header, question, ...answers]), rinfo.port, rinfo.address);
  });
  server.bind(0, "127.0.0.1");
  await once(server, "listening");

  serverList = ["127.0.0.1:" + (server.address() as dgram.AddressInfo).port];
  resolver = new dns.Resolver({ timeout: 2000, tries: 2 });
  resolver.setServers(serverList);
  promiseResolver = new dns_promises.Resolver({ timeout: 2000, tries: 2 });
  promiseResolver.setServers(serverList);
});

afterAll(() => {
  server?.close();
});

describe("resolveTxt", () => {
  // https://github.com/oven-sh/bun/issues/21370: a TXT record longer than 255
  // bytes is split into several <character-string>s; node returns one inner
  // array per record so `entries.map(e => e.join(""))` reassembles it.
  test("groups the character-strings of one record together (promises)", async () => {
    expect(await promiseResolver.resolveTxt("txt.bun.test")).toEqual([["hello", "world"], ["single"]]);
  });

  test("groups the character-strings of one record together (callback)", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string[][]>();
    resolver.resolveTxt("txt.bun.test", (err, records) => (err ? reject(err) : resolve(records)));
    expect(await promise).toEqual([["hello", "world"], ["single"]]);
  });

  test("resolveAny yields one TXT entry object per record", async () => {
    expect(await promiseResolver.resolveAny("txt.bun.test")).toEqual([
      { entries: ["hello", "world"], type: "TXT" },
      { entries: ["single"], type: "TXT" },
    ]);
  });
});

describe("an empty NOERROR answer (NODATA)", () => {
  // "The name exists but has no records of this type" must surface as
  // ENODATA, distinct from NXDOMAIN's ENOTFOUND: consumers make different
  // cache/retry/fallback decisions for the two.
  test("resolve4 rejects with ENODATA (promises)", async () => {
    const err: any = await promiseResolver.resolve4("onlytxt.bun.test").then(
      () => null,
      e => e,
    );
    expect({ code: err?.code, syscall: err?.syscall, hostname: err?.hostname }).toEqual({
      code: "ENODATA",
      syscall: "queryA",
      hostname: "onlytxt.bun.test",
    });
  });

  test("resolve4 reports ENODATA (callback)", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string | undefined>();
    resolver.resolve4("onlytxt.bun.test", err => (err ? resolve(err.code) : reject(new Error("expected an error"))));
    expect(await promise).toBe("ENODATA");
  });

  test("a nonexistent name is still ENOTFOUND", async () => {
    expect(
      await promiseResolver.resolve4("nxdomain.bun.test").then(
        () => null,
        (e: any) => e.code,
      ),
    ).toBe("ENOTFOUND");
  });

  test("lookup() through the c-ares backend folds both NODATA and NXDOMAIN into ENOTFOUND", async () => {
    // The c-ares lookup backend uses the module-level server list (a per-instance
    // Resolver has no lookup()), so point the global at the local server.
    const saved = dns.getServers();
    dns.setServers(serverList);
    try {
      const lookupCode = (name: string) =>
        Bun.dns.lookup(name, { backend: "c-ares" }).then(
          () => null,
          (e: any) => e.code,
        );
      expect(await Promise.all([lookupCode("onlytxt.bun.test"), lookupCode("nxdomain.bun.test")])).toEqual([
        "DNS_ENOTFOUND",
        "DNS_ENOTFOUND",
      ]);
    } finally {
      dns.setServers(saved);
    }
  });
});
