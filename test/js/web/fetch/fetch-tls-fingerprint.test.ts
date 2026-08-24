import { describe, expect, test } from "bun:test";
import { tls as tlsCert } from "harness";

// Chrome 143 on desktop (node-libcurl-ja3 / tls.peet.ws). The extension field
// lists what Chrome sends; Chrome itself shuffles the order on every connection.
const CHROME_JA3 =
  "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-5-10-11-13-16-18-23-27-35-43-45-51-17613-65037-65281,4588-29-23-24,0";

const TLS13_SUITES = [0x1301, 0x1302, 0x1303];
const EXT = {
  serverName: 0,
  statusRequest: 5,
  supportedGroups: 10,
  ecPointFormats: 11,
  signatureAlgorithms: 13,
  alpn: 16,
  sct: 18,
  padding: 21,
  extendedMasterSecret: 23,
  compressCertificate: 27,
  sessionTicket: 35,
  supportedVersions: 43,
  pskKeyExchangeModes: 45,
  keyShare: 51,
  alpsOld: 17513,
  alps: 17613,
  ech: 65037,
  renegotiationInfo: 65281,
};

function isGrease(value: number) {
  return (value & 0x0f0f) === 0x0a0a && value >> 8 === (value & 0xff);
}

interface ClientHello {
  version: number;
  ciphers: number[];
  extensions: { type: number; data: Uint8Array }[];
  extensionTypes: number[];
  groups: number[];
  pointFormats: number[];
  alpn: string[];
  supportedVersions: number[];
  keyShareGroups: number[];
  certCompression: number[];
  alps: { codepoint: number; protocols: string[] } | null;
  /** JA3 string: GREASE values removed, SNI kept when present. */
  ja3: string;
}

function parseClientHello(bytes: Uint8Array): ClientHello {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const u8 = () => bytes[p++];
  const u16 = () => {
    const v = view.getUint16(p);
    p += 2;
    return v;
  };
  const u16list = (data: Uint8Array) => {
    const out: number[] = [];
    for (let i = 0; i + 1 < data.length; i += 2) out.push((data[i] << 8) | data[i + 1]);
    return out;
  };

  expect(u8()).toBe(0x16); // handshake record
  u16(); // record version
  u16(); // record length
  expect(u8()).toBe(0x01); // ClientHello
  p += 3; // handshake length
  const version = u16();
  p += 32; // random
  const sessionIdLength = u8();
  p += sessionIdLength;
  const cipherBytes = u16();
  const ciphers: number[] = [];
  for (let i = 0; i < cipherBytes; i += 2) ciphers.push(u16());
  const compressionLength = u8();
  p += compressionLength;
  const extensionBytes = u16();
  const end = p + extensionBytes;
  const extensions: ClientHello["extensions"] = [];
  while (p < end) {
    const type = u16();
    const len = u16();
    extensions.push({ type, data: bytes.subarray(p, p + len) });
    p += len;
  }
  expect(p).toBe(bytes.length);

  const ext = (type: number) => extensions.find(e => e.type === type)?.data;

  const groupsData = ext(EXT.supportedGroups);
  const groups = groupsData ? u16list(groupsData.subarray(2)) : [];
  const formatsData = ext(EXT.ecPointFormats);
  const pointFormats = formatsData ? Array.from(formatsData.subarray(1)) : [];

  const alpn: string[] = [];
  const alpnData = ext(EXT.alpn);
  if (alpnData) {
    let i = 2;
    while (i < alpnData.length) {
      const len = alpnData[i++];
      alpn.push(new TextDecoder().decode(alpnData.subarray(i, i + len)));
      i += len;
    }
  }

  const versionsData = ext(EXT.supportedVersions);
  const supportedVersions = versionsData ? u16list(versionsData.subarray(1)) : [];

  const keyShareGroups: number[] = [];
  const keyShareData = ext(EXT.keyShare);
  if (keyShareData) {
    let i = 2;
    while (i + 4 <= keyShareData.length) {
      keyShareGroups.push((keyShareData[i] << 8) | keyShareData[i + 1]);
      const len = (keyShareData[i + 2] << 8) | keyShareData[i + 3];
      i += 4 + len;
    }
  }

  const compressData = ext(EXT.compressCertificate);
  const certCompression = compressData ? u16list(compressData.subarray(1)) : [];

  let alps: ClientHello["alps"] = null;
  for (const codepoint of [EXT.alps, EXT.alpsOld]) {
    const data = ext(codepoint);
    if (!data) continue;
    const protocols: string[] = [];
    let i = 2;
    while (i < data.length) {
      const len = data[i++];
      protocols.push(new TextDecoder().decode(data.subarray(i, i + len)));
      i += len;
    }
    alps = { codepoint, protocols };
  }

  const extensionTypes = extensions.map(e => e.type);
  const ja3 = [
    version,
    ciphers.filter(c => !isGrease(c)).join("-"),
    extensionTypes.filter(t => !isGrease(t)).join("-"),
    groups.filter(g => !isGrease(g)).join("-"),
    pointFormats.join("-"),
  ].join(",");

  return {
    version,
    ciphers,
    extensions,
    extensionTypes,
    groups,
    pointFormats,
    alpn,
    supportedVersions,
    keyShareGroups,
    certCompression,
    alps,
    ja3,
  };
}

/**
 * Accepts one TCP connection, returns the raw ClientHello it receives, and
 * closes the connection. The fetch then fails; only the first flight matters.
 */
async function captureClientHello(tls: Record<string, unknown>, init: Record<string, unknown> = {}) {
  const { promise, resolve, reject } = Promise.withResolvers<Uint8Array>();
  let received = new Uint8Array(0);
  using listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket, chunk) {
        const next = new Uint8Array(received.length + chunk.length);
        next.set(received);
        next.set(chunk, received.length);
        received = next;
        if (received.length < 5) return;
        const recordLength = 5 + ((received[3] << 8) | received[4]);
        if (received.length < recordLength) return;
        resolve(received.subarray(0, recordLength));
        socket.end();
      },
      error(_socket, error) {
        reject(error);
      },
    },
  });

  // The server never answers, so the fetch always fails. Swallow that.
  const request = fetch(`https://127.0.0.1:${listener.port}/`, {
    ...init,
    tls: { rejectUnauthorized: false, ...tls },
  }).catch(() => {});
  const hello = parseClientHello(await promise);
  await request;
  return hello;
}

describe("fetch TLS fingerprint options", () => {
  test("the default ClientHello advertises no GREASE and no fingerprint-only extensions", async () => {
    const hello = await captureClientHello({});
    expect(hello.version).toBe(0x0303);
    expect(hello.ciphers.some(isGrease)).toBe(false);
    expect(hello.extensionTypes.some(isGrease)).toBe(false);
    expect(hello.groups.some(isGrease)).toBe(false);
    expect(hello.ciphers.slice(0, 3).sort()).toEqual(TLS13_SUITES);
    expect(hello.alpn).toEqual(["http/1.1"]);
    expect(hello.extensionTypes).toContain(EXT.statusRequest);
    expect(hello.extensionTypes).toContain(EXT.sct);
    expect(hello.extensionTypes).toContain(EXT.sessionTicket);
    expect(hello.extensionTypes).not.toContain(EXT.compressCertificate);
    expect(hello.extensionTypes).not.toContain(EXT.alps);
    expect(hello.extensionTypes).not.toContain(EXT.alpsOld);
    expect(hello.extensionTypes).not.toContain(EXT.ech);
  });

  test("ja3 sets the cipher order, the groups and the extension set", async () => {
    const hello = await captureClientHello({ ja3: CHROME_JA3 });
    const [, ciphers, extensions, groups, formats] = CHROME_JA3.split(",");

    // Cipher suites in the exact order of the string (TLS 1.3 suites forced
    // AES-first so this does not depend on the machine's AES hardware).
    expect(hello.ciphers.join("-")).toBe(ciphers);
    expect(hello.groups.join("-")).toBe(groups);
    expect(hello.pointFormats.join("-")).toBe(formats);

    // Same extension set. BoringSSL fixes the order, and padding (21) depends
    // on the ClientHello size, so compare as sets without it. No SNI: the
    // request goes to an IP literal.
    const expected = extensions
      .split("-")
      .map(Number)
      .filter(t => t !== EXT.serverName)
      .sort((a, b) => a - b);
    const actual = hello.extensionTypes.filter(t => t !== EXT.padding).sort((a, b) => a - b);
    expect(actual).toEqual(expected);

    expect(hello.certCompression).toEqual([2]); // brotli
    expect(hello.alps).toEqual({ codepoint: EXT.alps, protocols: ["h2"] });
    expect(hello.keyShareGroups).toEqual([4588, 29]);
    expect(hello.supportedVersions).toEqual([0x0304, 0x0303]);
    expect(hello.ciphers.some(isGrease)).toBe(false);
  });

  test("ja3 without TLS 1.3 suites offers TLS 1.2 only", async () => {
    const hello = await captureClientHello({
      ja3: "771,49195-49199-156-47,0-5-10-11-13-16-18-23-35-65281,29-23,0",
    });
    expect(hello.ciphers).toEqual([49195, 49199, 156, 47]);
    expect(hello.extensionTypes).not.toContain(EXT.supportedVersions);
    expect(hello.extensionTypes).not.toContain(EXT.keyShare);
    expect(hello.extensionTypes).not.toContain(EXT.pskKeyExchangeModes);
    expect(hello.groups).toEqual([29, 23]);
  });

  test("ja3 with TLS 1.3 suites only offers TLS 1.3 only", async () => {
    const hello = await captureClientHello({ ja3: "771,4865-4866-4867,0-10-13-16-43-45-51,29,0" });
    expect(hello.ciphers).toEqual(TLS13_SUITES);
    expect(hello.supportedVersions).toEqual([0x0304]);
    expect(hello.extensionTypes).not.toContain(EXT.sessionTicket);
    expect(hello.extensionTypes).not.toContain(EXT.extendedMasterSecret);
    expect(hello.extensionTypes).not.toContain(EXT.renegotiationInfo);
    expect(hello.extensionTypes).not.toContain(EXT.ecPointFormats);
  });

  test("ja3 can put ChaCha20 first among the TLS 1.3 suites", async () => {
    const hello = await captureClientHello({ ja3: "771,4867-4865-4866-49195,0-10-11-13-16-23-43-45-51-65281,29,0" });
    expect(hello.ciphers).toEqual([0x1303, 0x1301, 0x1302, 49195]);
  });

  test("ja3 GREASE values turn on grease", async () => {
    const hello = await captureClientHello({
      ja3: "771,2570-4865-4866-4867-49195,0-10-11-13-16-23-43-45-51-65281-2570,2570-29-23,0",
    });
    expect(hello.ciphers.filter(isGrease)).toHaveLength(1);
    expect(hello.groups.filter(isGrease)).toHaveLength(1);
    expect(hello.extensionTypes.filter(isGrease).length).toBeGreaterThan(0);
  });

  test("grease adds GREASE values to ciphers, extensions, groups and versions", async () => {
    const hello = await captureClientHello({ grease: true });
    expect(hello.ciphers.filter(isGrease)).toHaveLength(1);
    expect(hello.ciphers[0]).toSatisfy(isGrease);
    expect(hello.groups.filter(isGrease)).toHaveLength(1);
    expect(hello.supportedVersions.filter(isGrease)).toHaveLength(1);
    expect(hello.extensionTypes.filter(isGrease).length).toBeGreaterThan(0);
  });

  test("permuteExtensions shuffles the extension order", async () => {
    const fixed = await Promise.all([captureClientHello({}), captureClientHello({})]);
    expect(fixed[0].extensionTypes).toEqual(fixed[1].extensionTypes);

    // BoringSSL appends a padding extension (21) whenever the shuffle leaves an
    // empty-bodied extension last, so compare the sets without it.
    const withoutPadding = (types: number[]) => types.filter(t => t !== EXT.padding).sort((a, b) => a - b);
    const orders = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const hello = await captureClientHello({ permuteExtensions: true });
      orders.add(hello.extensionTypes.join("-"));
      expect(withoutPadding(hello.extensionTypes)).toEqual(withoutPadding(fixed[0].extensionTypes));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  test("certificateCompression lists the algorithms in the given order", async () => {
    expect((await captureClientHello({ certificateCompression: true })).certCompression).toEqual([2]);
    expect(
      (await captureClientHello({ certificateCompression: ["zstd", "zlib", "brotli", "zlib"] })).certCompression,
    ).toEqual([3, 1, 2]);
    expect((await captureClientHello({ certificateCompression: false })).extensionTypes).not.toContain(
      EXT.compressCertificate,
    );
  });

  test("applicationSettings picks the ALPS codepoint", async () => {
    expect((await captureClientHello({ applicationSettings: true })).alps).toEqual({
      codepoint: EXT.alps,
      protocols: ["h2"],
    });
    expect((await captureClientHello({ applicationSettings: 17513 })).alps).toEqual({
      codepoint: EXT.alpsOld,
      protocols: ["h2"],
    });
    expect((await captureClientHello({ applicationSettings: 17613 })).alps?.codepoint).toBe(EXT.alps);
  });

  test("echGrease adds a GREASE encrypted_client_hello extension", async () => {
    const hello = await captureClientHello({ echGrease: true });
    const ech = hello.extensions.find(e => e.type === EXT.ech);
    expect(ech).toBeDefined();
    expect(ech!.data.length).toBeGreaterThan(32);
  });

  test("ocspStapling, signedCertificateTimestamps and sessionTickets remove their extensions", async () => {
    const hello = await captureClientHello({
      ocspStapling: false,
      signedCertificateTimestamps: false,
      sessionTickets: false,
    });
    expect(hello.extensionTypes).not.toContain(EXT.statusRequest);
    expect(hello.extensionTypes).not.toContain(EXT.sct);
    expect(hello.extensionTypes).not.toContain(EXT.sessionTicket);
  });

  test("explicit options win over what ja3 implies", async () => {
    const hello = await captureClientHello({
      ja3: CHROME_JA3,
      certificateCompression: false,
      applicationSettings: false,
      echGrease: false,
      ciphers: "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
      ecdhCurve: "X25519",
    });
    expect(hello.extensionTypes).not.toContain(EXT.compressCertificate);
    expect(hello.extensionTypes).not.toContain(EXT.alps);
    expect(hello.extensionTypes).not.toContain(EXT.ech);
    expect(hello.ciphers).toEqual([...TLS13_SUITES, 49199]);
    expect(hello.groups).toEqual([29]);

    // The other direction: an extension ja3 leaves out can be added back.
    const withTickets = await captureClientHello({
      ja3: "771,4865-4866-4867-49195,0-10-11-13-16-23-43-45-51-65281,29,0",
      sessionTickets: true,
    });
    expect(withTickets.extensionTypes).toContain(EXT.sessionTicket);
  });

  test("the ClientHello inside a CONNECT tunnel carries the fingerprint", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<Uint8Array>();
    let connectRequest: string | null = null;
    let received = new Uint8Array(0);
    using proxy = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket, chunk) {
          if (connectRequest === null) {
            connectRequest = new TextDecoder().decode(chunk);
            socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
            return;
          }
          const next = new Uint8Array(received.length + chunk.length);
          next.set(received);
          next.set(chunk, received.length);
          received = next;
          if (received.length < 5) return;
          const recordLength = 5 + ((received[3] << 8) | received[4]);
          if (received.length < recordLength) return;
          resolve(received.subarray(0, recordLength));
          socket.end();
        },
        error(_socket, error) {
          reject(error);
        },
      },
    });
    const request = fetch("https://example.invalid/", {
      proxy: `http://127.0.0.1:${proxy.port}`,
      tls: { rejectUnauthorized: false, ja3: CHROME_JA3, grease: true },
    }).catch(() => {});
    const hello = parseClientHello(await promise);
    await request;

    expect(connectRequest).toStartWith("CONNECT example.invalid:443 ");
    expect(hello.ciphers.filter(c => !isGrease(c)).join("-")).toBe(CHROME_JA3.split(",")[1]);
    expect(hello.ciphers.filter(isGrease)).toHaveLength(1);
    expect(hello.groups.filter(g => !isGrease(g))).toEqual([4588, 29, 23, 24]);
    expect(hello.certCompression).toEqual([2]);
    expect(hello.alps?.protocols).toEqual(["h2"]);
    expect(hello.extensionTypes).toContain(EXT.ech);
  });

  test("the fingerprinted ClientHello completes a handshake with Bun.serve", async () => {
    using server = Bun.serve({
      port: 0,
      tls: tlsCert,
      fetch: () => new Response("hello"),
    });
    const response = await fetch(`https://localhost:${server.port}/`, {
      tls: {
        ca: tlsCert.cert,
        ja3: CHROME_JA3,
        grease: true,
        permuteExtensions: true,
      },
    });
    expect(await response.text()).toBe("hello");
    expect(response.status).toBe(200);
  });

  describe("invalid options throw", () => {
    const attempt = async (tls: Record<string, unknown>) => fetch("https://127.0.0.1:1/", { tls });

    test.each([
      ["771,4865", "expected 5 comma-separated fields"],
      ["771,4865-4866-4867,0,29", "expected 5 comma-separated fields"],
      ["771,4865-x,0,29,0", "ciphers must be dash-separated decimal numbers"],
      ["771,4865-4866-4867,0-10-13-16-43-45-51,70000,0", "groups must be dash-separated decimal numbers"],
      ["768,4865-4866-4867,0,29,0", "unsupported TLS version 768"],
      ["772,4865-4866-4867,0,29,0", "unsupported TLS version 772"],
      ["771,,0-10,29,0", "the cipher list is empty"],
      ["771,255-4865-4866-4867,0,29,0", "cipher suite 255 is not supported"],
      ["771,4865-4866-4867-52396,0,29,0", "cipher suite 52396 is not supported"],
      ["771,4865-4866,0,29,0", "TLS 1.3 cipher suites must lead the list as"],
      ["771,4865-4867-4866,0,29,0", "TLS 1.3 cipher suites must lead the list as"],
      ["771,49195-4865-4866-4867,0,29,0", "TLS 1.3 cipher suites must lead the list as"],
      ["771,4865-49195-4866-4867,0,29,0", "TLS 1.3 cipher suites must lead the list as"],
      ["771,4865-4866-4867,0-34,29,0", "extension 34 cannot be sent"],
      ["771,4865-4866-4867,0-28,29,0", "extension 28 cannot be sent"],
      ["771,4865-4866-4867-49195,0-5-10-11-13-18-35-43-45-51-65281,29,0", "extension 16 is always sent"],
      ["771,4865-4866-4867-49195,0-10-11-13-16-43-45-51-65281,29,0", "extension 23 is always sent"],
      ["771,4865-4866-4867,0-10-13-16,29,0", "extension 43 is always sent"],
      ["771,4865-4866-4867,0-10-13-16-43-45-51,256-29,0", "supported group 256 is not supported"],
      ["771,4865-4866-4867,0-10-13-16-43-45-51,29,1", "only point format 0"],
    ])("ja3 %s", async (ja3, message) => {
      await expect(attempt({ ja3 })).rejects.toThrow(message);
    });

    test("applicationSettings must be a boolean or a known codepoint", async () => {
      await expect(attempt({ applicationSettings: 1234 })).rejects.toThrow(
        "applicationSettings must be a boolean, 17513 or 17613",
      );
    });

    test("certificateCompression entries must be known algorithms", async () => {
      await expect(attempt({ certificateCompression: ["gzip"] })).rejects.toThrow(
        'certificateCompression entries must be "zlib", "brotli" or "zstd"',
      );
    });
  });
});
