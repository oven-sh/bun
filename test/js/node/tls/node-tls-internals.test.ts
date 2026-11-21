import { addBlockedSPKIForTesting, canonicalizeIP, clearBlockedSPKIsForTesting } from "bun:internal-for-testing";
import { bunEnv, bunExe, expectRssDeltaBelow } from "harness";
import { createTest } from "node-harness";
import { createHash, createPublicKey, sign, X509Certificate } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import net, { type AddressInfo } from "node:net";
import { join } from "node:path";
import {
  connect,
  createServer,
  getCACertificates,
  rootCertificates,
  type ConnectionOptions,
  type Server,
  type TlsOptions,
  type TLSSocket,
} from "tls";
import { tlsRecords } from "./tls-handshake-alert-utils";
const { afterEach, describe, expect } = createTest(import.meta.path);

describe("NodeTLS.cpp", () => {
  test("canonicalizeIP", () => {
    expect(canonicalizeIP("127.0.0.1")).toBe("127.0.0.1");
    expect(canonicalizeIP("10.1.0.1")).toBe("10.1.0.1");
    expect(canonicalizeIP("::1")).toBe("::1");
    expect(canonicalizeIP("fe80:0:0:0:0:0:0:1")).toBe("fe80::1");
    expect(canonicalizeIP("fe80:0:0:0:0:0:0:0")).toBe("fe80::");
    expect(canonicalizeIP("fe80::0000:0010:0001")).toBe("fe80::10:1");
    expect(canonicalizeIP("0001:2222:3333:4444:5555:6666:7777:0088")).toBe("1:2222:3333:4444:5555:6666:7777:88");

    expect(canonicalizeIP("0001:2222:3333:4444:5555:6666::")).toBe("1:2222:3333:4444:5555:6666::");

    expect(canonicalizeIP("a002:B12:00Ba:4444:5555:6666:0:0")).toBe("a002:b12:ba:4444:5555:6666::");

    // IPv4 address represented in IPv6
    expect(canonicalizeIP("0:0:0:0:0:ffff:c0a8:101")).toBe("::ffff:192.168.1.1");

    expect(canonicalizeIP("::ffff:192.168.1.1")).toBe("::ffff:192.168.1.1");
  });

  // Node.js parses with libuv's uv_inet_pton: a dotted quad, or an IPv6 address
  // up to the first "%". The zone id is not in the result and is not checked.
  // The text is a C string there, so it ends at a NUL. Every expected value
  // was taken from Node.js v26.3.0.
  test("canonicalizeIP reads an address in the strict form and drops a zone id", () => {
    const long = `fe80::1%${Buffer.alloc(64, "z").toString()}`;
    const expected: Record<string, string | null> = {
      "::1%lo": "::1",
      "fe80::1%eth0": "fe80::1",
      "FE80:0:0:0:0:0:0:1%eth0": "fe80::1",
      "::ffff:1.2.3.4%lo": "::ffff:1.2.3.4",
      "1:2:3:4:5:6:7::%lo": "1:2:3:4:5:6:7:0",
      "fe80::1%12": "fe80::1",
      "fe80::1%": "fe80::1",
      "fe80::1%eth0%eth1": "fe80::1",
      "fe80::1%br_lan": "fe80::1",
      "fe80::1%eth0/64": "fe80::1",
      "fe80::1%et\0h0": "fe80::1",
      "::1\0": "::1",
      "::1\0%lo": "::1",
      "1.2.3.4\0/8": "1.2.3.4",
      [long]: "fe80::1",
      // An IPv4 address takes no zone, and the address before the zone is in the strict form.
      "1.2.3.4%lo": null,
      "::1.2.3%lo": null,
      "::01.2.3.4%lo": null,
      "fe80::12345%lo": null,
      "fe80::1 %eth0": null,
      "fe80::1/64%eth0": null,
      "10.0.0\0%a/b": null,
      "%lo": null,
      // ares_inet_pton reads each of these: "127.1" as 127.1.0.0, "10" as 10.0.0.0.
      "127.1": null,
      "10": null,
      "0x7f000001": null,
      "127.000.000.001": null,
      "1.2.3": null,
      "01.2.3.4": null,
      "::1.2.3": null,
      "::01.2.3.4": null,
      "1.2.3.4/8": null,
      "::1/64": null,
      "127.1\0": null,
    };
    const actual = Object.keys(expected).map(text => [text, canonicalizeIP(text) ?? null]);
    expect(Object.fromEntries(actual)).toEqual(expected);
  });

  test("rootCertificates", () => {
    expect(rootCertificates).toBeInstanceOf(Array);
    expect(rootCertificates.length).toBeGreaterThan(0);
    expect(typeof rootCertificates[0]).toBe("string");

    for (const cert of rootCertificates) {
      expect(cert).toStartWith("-----BEGIN CERTIFICATE-----");
      expect(cert).toEndWith("-----END CERTIFICATE-----");
    }
  });

  // The bundled roots are embedded as DER and tls.rootCertificates re-encodes
  // them; the strings must stay exactly what they were when they were embedded
  // as PEM text (72-column body, trailing newline before the END line, none
  // after), and each must be the certificate it claims to be.
  test("rootCertificates are the DER roots re-encoded in the historical format", () => {
    for (const pem of rootCertificates) {
      const lines = pem.split("\n");
      expect(lines[0]).toBe("-----BEGIN CERTIFICATE-----");
      expect(lines.at(-1)).toBe("-----END CERTIFICATE-----");
      const body = lines.slice(1, -1);
      expect(body.length).toBeGreaterThan(0);
      for (let i = 0; i < body.length - 1; i++) expect(body[i].length).toBe(72);
      expect(body.at(-1)!.length).toBeGreaterThan(0);
      expect(body.at(-1)!.length).toBeLessThanOrEqual(72);
      const der = new X509Certificate(pem).raw;
      expect(body.join("")).toBe(der.toString("base64"));
    }
    expect(new Set(rootCertificates).size).toBe(rootCertificates.length);
  });

  // The binary under test must embed exactly the packages/bun-usockets/root_certs.der in this checkout (format:
  // u32 count, u32 offsets[count + 1], DER certificates back to back; little-endian), listed by root_certs.txt.
  test("rootCertificates are this checkout's root_certs.der, in order", () => {
    const usockets = join(import.meta.dir, "../../../../packages/bun-usockets");
    const blob = readFileSync(join(usockets, "root_certs.der"));
    const names = readFileSync(join(usockets, "root_certs.txt"), "utf8")
      .split("\n")
      .filter(line => line && !line.startsWith("#"));
    const count = blob.readUInt32LE(0);
    const offset = (i: number) => blob.readUInt32LE(4 + 4 * i);
    const data = blob.subarray(4 + 4 * (count + 1));
    expect(data.length).toBe(offset(count));
    expect(names.length).toBe(count);

    expect(rootCertificates.length).toBe(count);
    expect(getCACertificates("bundled")).toEqual<readonly string[]>(rootCertificates);
    for (let i = 0; i < count; i++) {
      const der = data.subarray(offset(i), offset(i + 1));
      const cert = new X509Certificate(rootCertificates[i]);
      expect(cert.raw.equals(der)).toBe(true);
      // Every entry is a self-issued CA certificate.
      expect(cert.ca).toBe(true);
      expect(cert.issuer).toBe(cert.subject);
    }
  });

  // root_certs.der is binary, so a diff cannot be reviewed; certdata.txt (Mozilla's list) can.
  test("every bundled root is a certificate certdata.txt trusts for server auth", () => {
    const lines = readFileSync(join(import.meta.dir, "../../../../packages/bun-usockets/certdata.txt"), "latin1").split(
      "\n",
    );
    const trusted: string[] = [];
    let sha1 = "";
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === "CKA_CERT_SHA1_HASH MULTILINE_OCTAL") {
        sha1 = "";
        while (lines[++i] !== "END")
          for (const octal of lines[i].split("\\").slice(1)) sha1 += parseInt(octal, 8).toString(16).padStart(2, "0");
      } else if (lines[i] === "CKA_TRUST_SERVER_AUTH CK_TRUST CKT_NSS_TRUSTED_DELEGATOR") trusted.push(sha1);
    }
    const bundled = rootCertificates.map(pem => createHash("sha1").update(new X509Certificate(pem).raw).digest("hex"));
    expect(bundled.toSorted()).toEqual(trusted.toSorted());
  });
});

// Port of node's test/parallel/test-tls-spki-blocklist.js. The chain is agent6 -> ca3 (intermediate) -> ca1 (root), and
// agent6-cert.pem bundles ca3. ca1 signs agent1 directly. ca2 is unrelated to both.
describe("blocked public keys", () => {
  const readKey = (name: string) => readFileSync(join(import.meta.dir, "../test/fixtures/keys", name), "utf8");
  const spkiSha256 = (pem: string) =>
    createHash("sha256")
      .update(new X509Certificate(pem).publicKey.export({ type: "spki", format: "der" }))
      .digest();

  const rootCert = readKey("ca1-cert.pem");
  const leafKey = readKey("agent6-key.pem");
  const leafChain = readKey("agent6-cert.pem");
  const unaffectedKey = readKey("agent1-key.pem");
  const unaffectedCert = readKey("agent1-cert.pem");
  const unrelatedCert = readKey("ca2-cert.pem");

  const intermediateSpkiHash = spkiSha256(readKey("ca3-cert.pem"));
  const leafSpkiHash = spkiSha256(leafChain);
  const unrelatedSpkiHash = spkiSha256(unrelatedCert);

  const servers: Server[] = [];
  // A TLS 1.3 client is done before the server has read its certificate, so clients stay open until the test is over.
  const clients: TLSSocket[] = [];
  afterEach(() => {
    clearBlockedSPKIsForTesting();
    for (const client of clients.splice(0)) client.destroy();
    for (const server of servers.splice(0)) server.close();
  });

  async function listen(options: TlsOptions) {
    const server = createServer(options, socket => socket.resume());
    servers.push(server);
    await once(server.listen(0, "127.0.0.1"), "listening");
    return server;
  }

  const authorization = ({ authorized, authorizationError }: TLSSocket) => ({ authorized, authorizationError });

  /** What the client saw: the error that ended the handshake, or how the connection was authorized. */
  function connectTo(server: Server, options: ConnectionOptions) {
    const { promise, resolve } = Promise.withResolvers<object>();
    const client = connect({
      host: "127.0.0.1",
      port: (server.address() as AddressInfo).port,
      checkServerIdentity: () => undefined,
      ...options,
    });
    clients.push(client);
    client.once("error", err => resolve({ error: (err as NodeJS.ErrnoException).code }));
    client.once("secureConnect", () => resolve(authorization(client)));
    client.once("close", () => resolve({ closed: true }));
    return promise;
  }

  /** What the server saw of its next client: the same, from the other side. */
  function nextClientOf(server: Server) {
    const { promise, resolve } = Promise.withResolvers<object>();
    server.once("secureConnection", socket => resolve(authorization(socket)));
    server.once("tlsClientError", (err, socket) =>
      resolve({ error: (err as NodeJS.ErrnoException).code, ...authorization(socket) }),
    );
    return promise;
  }

  describe("in the server's chain", () => {
    const server = () => listen({ key: leafKey, cert: leafChain });

    test("nothing blocked: the chain is accepted", async () => {
      expect(await connectTo(await server(), { ca: rootCert })).toEqual({ authorized: true, authorizationError: null });
    });

    test("a blocked intermediate is rejected", async () => {
      addBlockedSPKIForTesting(intermediateSpkiHash);
      expect(await connectTo(await server(), { ca: rootCert })).toEqual({ error: "CERT_REVOKED" });
    });

    test("a blocked leaf is rejected", async () => {
      addBlockedSPKIForTesting(leafSpkiHash);
      expect(await connectTo(await server(), { ca: rootCert })).toEqual({ error: "CERT_REVOKED" });
    });

    test("rejectUnauthorized: false reports CERT_REVOKED", async () => {
      addBlockedSPKIForTesting(intermediateSpkiHash);
      expect(await connectTo(await server(), { ca: rootCert, rejectUnauthorized: false })).toEqual({
        authorized: false,
        authorizationError: "CERT_REVOKED",
      });
    });

    test("a blocked key takes precedence over an untrusted root", async () => {
      expect(await connectTo(await server(), { ca: unrelatedCert })).toEqual({
        error: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      });
      addBlockedSPKIForTesting(intermediateSpkiHash);
      expect(await connectTo(await server(), { ca: unrelatedCert })).toEqual({ error: "CERT_REVOKED" });
    });

    test("clearing the list accepts the chain again", async () => {
      addBlockedSPKIForTesting(intermediateSpkiHash);
      clearBlockedSPKIsForTesting();
      expect(await connectTo(await server(), { ca: rootCert })).toEqual({ authorized: true, authorizationError: null });
    });

    test("the hook validates its argument", () => {
      // @ts-expect-error
      expect(() => addBlockedSPKIForTesting("not a buffer")).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
      );
      expect(() => addBlockedSPKIForTesting(Buffer.alloc(31))).toThrow(
        expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
      );
    });
  });

  describe("outside the verified chain", () => {
    const server = () => listen({ key: leafKey, cert: `${leafChain}\n${unrelatedCert}` });

    test("an unused certificate the peer sent is ignored when the chain verifies", async () => {
      addBlockedSPKIForTesting(unrelatedSpkiHash);
      expect(await connectTo(await server(), { ca: rootCert })).toEqual({ authorized: true, authorizationError: null });
    });

    test("every certificate the peer sent is checked when the chain does not verify", async () => {
      addBlockedSPKIForTesting(unrelatedSpkiHash);
      expect(await connectTo(await server(), { ca: unrelatedCert })).toEqual({ error: "CERT_REVOKED" });
    });
  });

  describe("in the client's chain", () => {
    const server = (rejectUnauthorized: boolean) =>
      listen({ key: unaffectedKey, cert: unaffectedCert, ca: rootCert, requestCert: true, rejectUnauthorized });
    const client = { key: leafKey, cert: leafChain, ca: rootCert };

    test("nothing blocked: the chain is accepted", async () => {
      const listening = await server(true);
      const seen = nextClientOf(listening);
      connectTo(listening, client);
      expect(await seen).toEqual({ authorized: true, authorizationError: null });
    });

    test("rejectUnauthorized: false reports CERT_REVOKED", async () => {
      addBlockedSPKIForTesting(intermediateSpkiHash);
      const listening = await server(false);
      const seen = nextClientOf(listening);
      connectTo(listening, client);
      expect(await seen).toEqual({ authorized: false, authorizationError: "CERT_REVOKED" });
    });

    test("rejectUnauthorized: true rejects the client", async () => {
      addBlockedSPKIForTesting(intermediateSpkiHash);
      const listening = await server(true);
      const seen = nextClientOf(listening);
      connectTo(listening, client);
      expect(await seen).toEqual({ error: "CERT_REVOKED", authorized: false, authorizationError: "CERT_REVOKED" });
    });
  });

  // fetch() runs its handshakes on another thread than the one that fills the list.
  describe("fetch", () => {
    const serve = () =>
      Bun.serve({ port: 0, tls: { key: leafKey, cert: leafChain }, fetch: () => new Response("reached") });
    const get = (url: URL) =>
      fetch(url, { tls: { ca: rootCert, checkServerIdentity: () => undefined } }).then(
        res => res.text(),
        err => err.code,
      );

    test("nothing blocked: the chain is accepted", async () => {
      using server = serve();
      expect(await get(server.url)).toBe("reached");
    });

    test("a blocked intermediate is rejected", async () => {
      addBlockedSPKIForTesting(intermediateSpkiHash);
      using server = serve();
      expect(await get(server.url)).toBe("CERT_REVOKED");
    });
  });
});

// A certificate of a `ca` option is parsed whole when the context is made, so that a bad one fails there and not in a
// handshake. A bundled root is known to parse ("rootCertificates are this checkout's root_certs.der" above), so it is
// not parsed to find out, and the context refers to the bytes that the binary embeds.
describe("bundled roots in a ca option", () => {
  const readKey = (name: string) => readFileSync(join(import.meta.dir, "../test/fixtures/keys", name), "utf8");
  const der = (pem: string) => Buffer.from(pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, ""), "base64");
  const pem = (der: Uint8Array) =>
    `-----BEGIN CERTIFICATE-----\n${Buffer.from(der)
      .toString("base64")
      .match(/.{1,64}/g)!
      .join("\n")}\n-----END CERTIFICATE-----\n`;
  /** One DER element. */
  function tlv(tag: number, ...parts: Uint8Array[]) {
    const body = Buffer.concat(parts);
    const length =
      body.length < 0x80
        ? [body.length]
        : body.length < 0x100
          ? [0x81, body.length]
          : [0x82, body.length >> 8, body.length & 0xff];
    return Buffer.concat([Buffer.from([tag, ...length]), body]);
  }
  /** The elements inside one. */
  function elements(element: Buffer) {
    const headerAt = (at: number) => 2 + (element[at + 1] & 0x80 ? element[at + 1] & 0x7f : 0);
    const found: Buffer[] = [];
    for (let at = headerAt(0); at < element.length;) {
      const header = headerAt(at);
      const end = at + header + (header > 2 ? element.readUIntBE(at + 2, header - 2) : element[at + 1]);
      found.push(element.subarray(at, end));
      at = end;
    }
    return found;
  }
  /** The fields of a certificate from its subject on: the subject, the public key, then any extensions. */
  function fromSubject(certificate: Buffer) {
    const fields = elements(elements(certificate)[0]);
    return fields.slice(fields[0][0] === 0xa0 ? 5 : 4);
  }

  // ca1 signed the certificate of agent1.
  const otherCA = readKey("ca1-cert.pem");
  const agentKey = readKey("agent1-key.pem");
  const agentCert = readKey("agent1-cert.pem");

  const root = rootCertificates[0] + "\n";
  const rootDER = der(root);
  // Not the bundled root, and still a certificate: the last byte is in its signature.
  const rootWithAnotherSignature = pem(Buffer.concat([rootDER.subarray(0, -1), Buffer.from([rootDER.at(-1)! ^ 1])]));
  // Blocks that are not certificates.
  const rootCutShort = pem(rootDER.subarray(0, 200));
  const rootWithAnotherTag = pem(Buffer.concat([Buffer.from([0x31]), rootDER.subarray(1)]));
  const rootWithOneByteMore = pem(Buffer.concat([rootDER, Buffer.from([0])]));
  // Only a full parse refuses this one: it is the root up to its public key, which has another tag.
  const rootWithAKeyThatDoesNotParse = (() => {
    const [, key] = fromSubject(rootDER);
    const changed = Buffer.from(rootDER);
    changed[key.byteOffset - rootDER.byteOffset] = 0x31;
    return pem(changed);
  })();

  test.concurrent("only the certificates that are not bundled roots are parsed", async () => {
    const lists = {
      "every bundled root": [...rootCertificates],
      "every bundled root in one string": rootCertificates.join("\n"),
      "every bundled root and another certificate": [...rootCertificates, otherCA],
      "a bundled root twice": [root, root],
      "another certificate": [otherCA],
      "a bundled root with another signature": [root, rootWithAnotherSignature],
      // Nothing after a block that is not a certificate is read from its string.
      "a bundled root, then its first 200 bytes, then another certificate": [root + rootCutShort + otherCA],
      "a bundled root with another tag": [root, rootWithAnotherTag],
      "a bundled root with one byte more": [root, rootWithOneByteMore],
      "a bundled root with a key that does not parse": [root, rootWithAKeyThatDoesNotParse],
    };
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import { sslCaCertsParsed } from "bun:internal-for-testing";
        import { createSecureContext, setDefaultCACertificates } from "node:tls";
        const lists = await Bun.stdin.json();
        const results = {};
        function count(name, options) {
          const before = sslCaCertsParsed();
          let refused;
          try {
            createSecureContext(options);
          } catch (error) {
            refused = error.code + ": " + error.message;
          }
          results[name] = { parsed: sslCaCertsParsed() - before, refused };
        }
        for (const [name, ca] of Object.entries(lists)) count(name, { ca });
        // A context with no ca takes the list of the override as its ca.
        setDefaultCACertificates(lists["every bundled root and another certificate"]);
        count("no ca, after setDefaultCACertificates() of every bundled root and another certificate");
        console.log(JSON.stringify(results));
        `,
      ],
      env: bunEnv,
      stdin: new Blob([JSON.stringify(lists)]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      "every bundled root": { parsed: 0 },
      "every bundled root in one string": { parsed: 0 },
      "every bundled root and another certificate": { parsed: 1 },
      "a bundled root twice": { parsed: 0 },
      "another certificate": { parsed: 1 },
      "a bundled root with another signature": { parsed: 1 },
      "a bundled root, then its first 200 bytes, then another certificate": { parsed: 1 },
      "a bundled root with another tag": { parsed: 1, refused: "ERR_BORINGSSL: Invalid CA" },
      "a bundled root with one byte more": { parsed: 1, refused: "ERR_BORINGSSL: Invalid CA" },
      "a bundled root with a key that does not parse": { parsed: 1, refused: "ERR_BORINGSSL: Invalid CA" },
      "no ca, after setDefaultCACertificates() of every bundled root and another certificate": { parsed: 1 },
    });
    expect(exitCode).toBe(0);
  });

  // A context held a copy of the DER of each certificate of its `ca`: 127 KB for the bundled roots.
  test.concurrent("a context holds no copy of the DER of a bundled root", async () => {
    await expectRssDeltaBelow(
      [
        "-e",
        `
        import { createSecureContext, rootCertificates } from "node:tls";
        const ca = [...rootCertificates];
        const contexts = [];
        const build = () => {
          for (let i = 0; i < 64; i++) contexts.push(createSecureContext({ ca }));
        };
        // What the process allocates once is paid for here.
        for (let round = 0; round < 2; round++) {
          build();
          Bun.gc(true);
        }
        const rssBefore = process.memoryUsage.rss();
        build();
        console.log(JSON.stringify({ deltaMiB: (process.memoryUsage.rss() - rssBefore) / 1024 / 1024 }));
        `,
      ],
      // 2.6 MiB, and 3.9 MiB under ASAN. With the copies, 64 contexts held 11 MiB, and 14 MiB under ASAN.
      { release: 6, debug: 8 },
    );
  });

  /** A certificate for the key of agent1 that names the subject of `issuer` as its issuer. That CA did not sign it. */
  function certificateThatNames(issuer: Buffer) {
    const sha256WithRSA = tlv(0x30, tlv(0x06, Buffer.from("2a864886f70d01010b", "hex")), tlv(0x05));
    const commonName = tlv(0x06, Buffer.from("550403", "hex"));
    const time = (ms: number) => {
      const text = new Date(ms).toISOString().replace(/[-:T]|\.\d+/g, "");
      return tlv(0x17, Buffer.from(text.slice(2)));
    };
    const tbs = tlv(
      0x30,
      tlv(0xa0, tlv(0x02, Buffer.from([2]))),
      tlv(0x02, Buffer.from([1])),
      sha256WithRSA,
      fromSubject(issuer)[0],
      tlv(0x30, time(Date.now() - 86_400_000), time(Date.now() + 86_400_000)),
      tlv(0x30, tlv(0x31, tlv(0x30, commonName, tlv(0x0c, Buffer.from("localhost"))))),
      createPublicKey(agentKey).export({ type: "spki", format: "der" }),
    );
    return pem(tlv(0x30, tbs, sha256WithRSA, tlv(0x03, Buffer.from([0]), sign("sha256", tbs, agentKey))));
  }

  const servers: Server[] = [];
  afterEach(() => {
    for (const server of servers.splice(0)) server.close();
  });
  async function listen(options: TlsOptions) {
    const server = createServer(options, socket => socket.resume());
    servers.push(server);
    await once(server.listen(0, "127.0.0.1"), "listening");
    return server;
  }
  /** What a client that trusts `ca` makes of the chain of `server`. */
  async function verdict(server: Server, ca: string[]) {
    const socket = connect({
      host: "127.0.0.1",
      port: (server.address() as AddressInfo).port,
      ca,
      rejectUnauthorized: false,
      checkServerIdentity: () => undefined,
    });
    try {
      await once(socket, "secureConnect");
      return socket.authorized ? "authorized" : String(socket.authorizationError);
    } finally {
      socket.destroy();
    }
  }

  test("a chain that names a bundled root finds that root and no other", async () => {
    const roots = rootCertificates.map(pem => ({ pem, x509: new X509Certificate(pem), length: der(pem).length }));
    const twinOf = (root: (typeof roots)[number]) =>
      roots.find(other => other.length === root.length && other.x509.subject !== root.x509.subject);
    // The issuer has an RSA key, because the signature check needs a key of the kind that signed. Another root has its
    // length, so a lookup that compares less than every byte can take one for the other. Of those, it expires last.
    const [issuer] = roots
      .filter(root => root.x509.publicKey.asymmetricKeyType === "rsa" && twinOf(root))
      .sort((a, b) => Date.parse(b.x509.validTo) - Date.parse(a.x509.validTo));
    // With a `ca` of its own, the server does not send the issuer from its default store.
    const server = await listen({ key: agentKey, cert: certificateThatNames(der(issuer.pem)), ca: [otherCA] });
    expect({
      "the issuer": await verdict(server, [issuer.pem]),
      "every bundled root": await verdict(server, [...rootCertificates]),
      "a bundled root of the same length": await verdict(server, [twinOf(issuer)!.pem]),
      "every bundled root but the issuer": await verdict(
        server,
        rootCertificates.filter(root => root !== issuer.pem),
      ),
    }).toEqual({
      // Found, and its key did not make the signature.
      "the issuer": "CERT_SIGNATURE_FAILURE",
      "every bundled root": "CERT_SIGNATURE_FAILURE",
      "a bundled root of the same length": "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "every bundled root but the issuer": "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    });
  });

  test("the other certificates of the list are trusted", async () => {
    const server = await listen({ key: agentKey, cert: agentCert });
    expect({
      "every bundled root and the CA": await verdict(server, [...rootCertificates, otherCA]),
      "the CA between two bundled roots, in one string": await verdict(server, [
        [rootCertificates[0], otherCA, rootCertificates[1]].join("\n"),
      ]),
      "every bundled root": await verdict(server, [...rootCertificates]),
      "the CA after a block that is not a certificate": await verdict(server, [root + rootCutShort + otherCA]),
    }).toEqual({
      "every bundled root and the CA": "authorized",
      "the CA between two bundled roots, in one string": "authorized",
      "every bundled root": "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "the CA after a block that is not a certificate": "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    });
  });

  test("a server names a bundled root to its clients", async () => {
    const server = await listen({
      key: agentKey,
      cert: agentCert,
      ca: [otherCA, root, otherCA],
      requestCert: true,
      rejectUnauthorized: false,
    });
    // The CertificateRequest of a TLS 1.2 handshake goes out in the clear.
    const fromServer: Buffer[] = [];
    const relay = net.createServer(client => {
      const upstream = net.connect((server.address() as AddressInfo).port, "127.0.0.1");
      upstream.on("data", chunk => fromServer.push(chunk));
      client.pipe(upstream).pipe(client);
      client.on("error", () => upstream.destroy());
      upstream.on("error", () => client.destroy());
    });
    await once(relay.listen(0, "127.0.0.1"), "listening");
    const socket = connect({
      host: "127.0.0.1",
      port: (relay.address() as AddressInfo).port,
      maxVersion: "TLSv1.2",
      rejectUnauthorized: false,
    });
    try {
      await once(socket, "secureConnect");
    } finally {
      socket.destroy();
      relay.close();
    }
    const handshake = Buffer.concat(
      tlsRecords(Buffer.concat(fromServer))
        .filter(record => record.type === 22)
        .map(record => Buffer.from(record.body, "hex")),
    );
    // Message type 13, before ServerHelloDone (14).
    let certificateRequest = Buffer.alloc(0);
    for (let at = 0; at + 4 <= handshake.length && handshake[at] !== 14;) {
      const end = at + 4 + handshake.readUIntBE(at + 1, 3);
      if (handshake[at] === 13) certificateRequest = handshake.subarray(at, end);
      at = end;
    }
    expect({
      "the bundled root": certificateRequest.includes(fromSubject(rootDER)[0]),
      "the other CA": certificateRequest.includes(fromSubject(der(otherCA))[0]),
    }).toEqual({ "the bundled root": true, "the other CA": true });
  });
});
