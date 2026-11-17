import { expect, test } from "bun:test";
import { once } from "events";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isDebug, isLinux, isMacOS } from "harness";
import type { AddressInfo } from "node:net";
import type { DetailedPeerCertificate, TLSSocket } from "node:tls";
import { join } from "path";
import tls from "tls";

const pem = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
// DER of every certificate in a PEM file, decoded without the X509 code under test.
const derOf = (text: string) =>
  Array.from(text.matchAll(/-----BEGIN CERTIFICATE-----([^-]+)-----END CERTIFICATE-----/g), m =>
    Buffer.from(m[1], "base64"),
  );

// ec10-cert.pem holds the client leaf and its issuer ca6. ca5 signed ca6. It is
// the only CA the server trusts, and the client does not send it.
const [leafDer, ca6Der] = derOf(pem("ec10-cert.pem"));
const [ca5Der] = derOf(pem("ca5-cert.pem"));
const nodeFoundation = { C: "US", ST: "CA", L: "SF", O: "The Node.js Foundation", OU: "Node.js" };
const leafSubject = { ...nodeFoundation, CN: "agent10.example.com" };
const leafIssuer = { ...nodeFoundation, CN: "ca6", emailAddress: "ca6@example.org" };

test.concurrent("server-side getPeerCertificate() returns the client certificate in every form", async () => {
  const { promise: serverSocketPromise, resolve: onServerSocket } = Promise.withResolvers<TLSSocket>();
  const server = tls.createServer(
    {
      key: pem("agent10-key.pem"),
      cert: pem("agent10-cert.pem"),
      ca: [pem("ca5-cert.pem")],
      requestCert: true,
      rejectUnauthorized: false,
    },
    onServerSocket,
  );
  await once(server.listen(0, "127.0.0.1"), "listening");
  const client = tls.connect({
    host: "127.0.0.1",
    port: (server.address() as AddressInfo).port,
    key: pem("ec10-key.pem"),
    cert: pem("ec10-cert.pem"),
    ca: [pem("ca2-cert.pem")],
    checkServerIdentity: () => undefined,
  });
  await once(client, "secureConnect");
  const serverSocket = await serverSocketPromise;
  try {
    // ca5 is in the server's store, so the chain verifies.
    expect(serverSocket.authorized).toBe(true);

    // No argument and `false` both return the leaf alone.
    const abbreviated = serverSocket.getPeerCertificate();
    expect(abbreviated).toEqual({
      subject: leafSubject,
      issuer: leafIssuer,
      subjectaltname: undefined,
      infoAccess: undefined,
      bits: 256,
      pubkey: Buffer.from(
        "043b96b1035527cc0f663a85aa49157ae61f62b7e0b2d70f3bb022706ae07d029e" +
          "16fcfea0b77af94f8e185305874f8b908ea84c00ec7ab58c172b9a8aa0c81730",
        "hex",
      ),
      asn1Curve: "prime256v1",
      nistCurve: "P-256",
      valid_from: "Sep  3 14:46:53 2022 GMT",
      valid_to: "Jun 17 14:46:53 2296 GMT",
      fingerprint: "25:47:A9:28:36:73:59:88:E5:14:A8:09:C2:DE:9D:70:8A:A6:B1:81",
      fingerprint256: "F9:04:DB:E6:94:77:28:BE:85:57:D4:6F:D7:6A:86:1D:87:39:FB:BB:9B:61:B0:5F:29:72:95:43:53:F9:51:FB",
      fingerprint512:
        "AD:26:33:24:D3:09:FC:11:66:B7:D0:97:C2:05:23:99:BC:26:BE:B3:7E:24:AE:04:91:03:1F:32:23:5C:E8:20:" +
        "C2:98:36:98:53:FE:1B:BF:1A:42:B9:91:A7:D7:A5:17:7A:B0:77:E5:67:88:16:0A:B2:C5:C7:53:8C:D4:BA:6B",
      ext_key_usage: undefined,
      serialNumber: "A97535039C5E962C",
      raw: leafDer,
      ca: false,
    });
    expect(abbreviated).not.toHaveProperty("issuerCertificate");
    expect(serverSocket.getPeerCertificate(false)).toEqual(abbreviated);

    // `true` adds the chain: what the client sent (leaf, ca6), then the root
    // from the server's own store (ca5), which links to itself.
    const detailed = serverSocket.getPeerCertificate(true);
    const chain: DetailedPeerCertificate[] = [];
    for (let cert = detailed; cert && !chain.includes(cert); cert = cert.issuerCertificate) chain.push(cert);
    expect(chain.map(({ subject, issuer, ca, raw }) => ({ subject: subject.CN, issuer: issuer.CN, ca, raw }))).toEqual([
      { subject: "agent10.example.com", issuer: "ca6", ca: false, raw: leafDer },
      { subject: "ca6", issuer: "ca5", ca: true, raw: ca6Der },
      { subject: "ca5", issuer: "ca5", ca: true, raw: ca5Der },
    ]);
    expect(chain.at(-1)!.issuerCertificate).toBe(chain.at(-1)!);
    const { issuerCertificate, ...detailedLeaf } = detailed;
    expect(detailedLeaf).toEqual(abbreviated);
  } finally {
    client.end();
    serverSocket.end();
    server.close();
  }
});

// Guards the server getPeerCertificate() paths against a native leak on every
// call. #29881 fixed two: the +1 X509 reference from SSL_get_peer_certificate,
// and the BIO behind every `raw` Buffer (JSX509Certificate::computeRaw), about
// 900 bytes for each certificate converted.
//
// The loop runs in node-tls-getpeercert-leak-fixture.ts so that the memory it
// samples tracks live memory. In this process it does not:
// - ASAN parks every freed block in a 256 MB quarantine, so RSS follows the
//   allocation volume. ASAN reads ASAN_OPTIONS only when the process starts.
// - The JIT compiles on its own threads. On an ASAN build, one FTL compile in
//   the middle of the loop is a 10 MB step. The leak is native, so the fixture
//   runs without the JIT.
//
// A debug build spends about 1 ms on each certificate, 50 times the release
// build, so it can only run a short loop. That is enough on Linux, where the
// fixture reads an exact number. Other debug builds skip the test.
test.skipIf(isDebug && !isLinux).concurrent(
  "server-side getPeerCertificate() does not leak",
  async () => {
    // One iteration calls getPeerCertificate(), (false) and (true). That converts
    // five certificates: 1 + 1 + 3 for the chain. With the computeRaw leak put
    // back, one iteration leaks 4.5 KB (6 KB on an ASAN build).
    const maxBytesPerIteration = 1500;
    // The loop has to be long enough that the bound, summed over the run, is
    // well above what a run with no leak moves by:
    //   Linux          200: bound 5 MB, no leak moves by 0.3 MB
    //   Linux debug     30: bound 0.8 MB, no leak moves by 0.1 MB
    //   Windows        600: bound 15 MB, no leak moves by 0.4 MB
    //   macOS         1500: bound 38 MB, not measured. The old in-process form of
    //                       this test has shown 21 MB of benign growth on macOS
    //                       CI VMs.
    const iterationsPerRound = isLinux ? (isDebug ? 30 : 200) : isMacOS ? 1500 : 600;
    const rounds = 20;
    const warmupRounds = 2;

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        join(import.meta.dir, "node-tls-getpeercert-leak-fixture.ts"),
        String(rounds),
        String(iterationsPerRound),
      ],
      env: {
        ...bunEnv,
        BUN_JSC_useJIT: "0",
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
          .filter(Boolean)
          .join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { samples, ...report } = JSON.parse(stdout) as { samples: number[] };
    // The socket in the fixture holds the real client certificate, so the loop
    // took the SSL_get_peer_certificate path.
    expect(report).toEqual({
      peer: { subject: leafSubject, issuer: leafIssuer, raw: leafDer.toString("base64") },
      iterations: rounds * iterationsPerRound,
    });
    expect(samples).toHaveLength(rounds);

    // `samples` is the resident memory after the full GC that ends each round.
    // The growth per round is the median slope over every pair of samples
    // (Theil-Sen). A few stray samples cannot move it, and they do happen:
    // mimalloc returns freed pages to the OS from a background thread.
    const measured = samples.slice(warmupRounds);
    const slopes: number[] = [];
    for (let i = 0; i < measured.length; i++) {
      for (let j = i + 1; j < measured.length; j++) slopes.push((measured[j] - measured[i]) / (j - i));
    }
    const bytesPerRound = slopes.sort((a, b) => a - b)[slopes.length >> 1];
    expect(bytesPerRound / iterationsPerRound).toBeLessThan(maxBytesPerIteration);
    expect(exitCode).toBe(0);
  },
  // The debug loop takes about 8 s.
  60_000,
);
