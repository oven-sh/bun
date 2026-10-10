// A `ca` that is given replaces the default roots, also when it lists no certificate: then no CA is trusted.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/secure-context.js#L177-L184
import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, tls as pair, tempDir } from "harness";
import { join } from "path";

// A debug build takes seconds to start a child and to load node:tls, node:https or node:http2.
const timeout = 30_000;
const keys = join(import.meta.dir, "..", "test", "fixtures", "keys");
const pem = (name: string) => Bun.file(join(keys, name)).text();

// The fixture needs `using` and tls.setDefaultCACertificates(): Node.js v24.5.0.
const node = nodeExe();
const nodeVersion = node
  ? spawnSync({ cmd: [node, "-p", "process.versions.node"] })
      .stdout.toString()
      .trim()
  : "";
const nodeRunsTheFixture = nodeVersion !== "" && Bun.semver.satisfies(nodeVersion, ">=24.5.0");

// Runs one mode of the fixture. In the child, the certificate in use and the intermediate ca3 are default roots
// (NODE_EXTRA_CA_CERTS). So a "no ca" row is authorized, and a `ca: []` row is refused only because the empty list
// took the place of the default roots.
async function run(exe: string, mode: string) {
  using dir = tempDir("ca-empty", { "roots.pem": [pair.cert, await pem("ca3-cert.pem")].join("\n") });
  await using proc = spawn({
    cmd: [exe, join(import.meta.dir, "node-tls-ca-empty-fixture.mjs"), mode],
    env: {
      ...bunEnv,
      NODE_EXTRA_CA_CERTS: join(String(dir), "roots.pem"),
      CERT: pair.cert,
      KEY: pair.key,
      OTHER_CA: await pem("ca2-cert.pem"),
      KEYS: keys,
      // An ambient NO_PROXY that lists 127.0.0.1 makes fetch() ignore its `proxy` option.
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      ALL_PROXY: undefined,
      NO_PROXY: undefined,
      http_proxy: undefined,
      https_proxy: undefined,
      all_proxy: undefined,
      no_proxy: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let rows: unknown = stdout;
  try {
    rows = JSON.parse(stdout);
  } catch {}
  return { rows, stderr, exitCode };
}

const refused = "error DEPTH_ZERO_SELF_SIGNED_CERT";
const unauthorized = "unauthorized DEPTH_ZERO_SELF_SIGNED_CERT";

// These modes use node:* alone. Node.js prints the same rows.
const onNodeToo = {
  "tls.connect": {
    "no ca": "authorized",
    "ca: []": refused,
    "no ca, again": "authorized",
    "ca: [], rejectUnauthorized: false": unauthorized,
    "ca: ''": "authorized",
    "secureContext: createSecureContext({ ca: [] })": refused,
    "createSecureContext({ ca: [] }), then addCACert(another root)": refused,
    "createSecureContext({ ca: [] }), then addCACert(the issuer)": "authorized",
  },
  "tls.connect over a stream": {
    "a Duplex": {
      "no ca": "authorized",
      "ca: []": refused,
      "secureContext: createSecureContext({ ca: [] })": refused,
    },
    "a connected net.Socket": {
      "no ca": "authorized",
      "ca: []": refused,
      "secureContext: createSecureContext({ ca: [] })": refused,
      "no ca, again": "authorized",
    },
  },
  "tls.setDefaultCACertificates([])": {
    "no ca, before the call": "authorized",
    "no ca": refused,
    "ca: ''": refused,
  },
  "node:https": {
    "https.get": { "no ca": "status 200", "ca: []": refused },
    "https.createServer, requestCert": {
      "no ca": "authorized=true, authorizationError=null",
      "ca: []": "authorized=false, authorizationError=DEPTH_ZERO_SELF_SIGNED_CERT",
    },
  },
  "http2.connect": { "no ca": "connected", "ca: []": refused },
  "tls.createServer": {
    "requestCert": {
      "no ca": "authorized=true",
      "ca: []": "authorized=false",
      "then setSecureContext({ ca: [] })": "authorized=false",
      "then addContext('localhost', { ca: [] })": "authorized=false",
    },
    "a leaf-only cert": {
      "no ca": "authorized",
      "ca: []": "unauthorized UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    },
  },
};

describe.each([
  ["bun", bunExe()],
  ["node", nodeRunsTheFixture ? node : null],
])("an empty ca list trusts no certificate (%s)", (runtime, exe) => {
  for (const [mode, rows] of Object.entries(onNodeToo)) {
    test.concurrent.skipIf(!exe)(
      mode,
      async () => {
        expect(await run(exe!, mode)).toEqual({ rows, stderr: "", exitCode: 0 });
      },
      timeout,
    );
  }
});

describe("an empty ca list trusts no certificate on Bun's own APIs", () => {
  const onBun = {
    "fetch, WebSocket": {
      "fetch": { "no ca": "status 200", "ca: []": refused },
      "Bun.FetchSession": { "no ca": "status 200", "ca: []": refused },
      "node-fetch": { "no ca": "status 200", "ca: []": refused },
      "WebSocket": { "no ca": "open", "ca: []": "error" },
      "ws": { "no ca": "open", "ca: []": "error" },
    },
    "Bun.connect": {
      "tls: true": "authorized",
      "ca: []": unauthorized,
      "upgradeTLS, ca: []": unauthorized,
      "Bun.serve({ tls: { ca: [] } })": "https:",
      "tls: {}": "closed without a TLS handshake",
      "cert: []": "closed without a TLS handshake",
      "key: []": "closed without a TLS handshake",
      "crl: []": "closed without a TLS handshake",
    },
    "pooled connections": {
      "fetch through a CONNECT proxy": {
        "serverName": "status 200",
        "serverName, again": "status 200",
        "serverName, cert: [], key: [], crl: []": "status 200",
        "CONNECT requests so far": 1,
        "serverName, ca: []": refused,
        "CONNECT requests": 2,
        "serverName, sigalgs: ''": "error FailedToOpenSocket",
      },
      "one https.Agent, keepAlive": { "no ca": "status 200", "ca: []": refused },
      "one https.Agent": { "no ca": "status 200", "ca: []": refused },
    },
    "a client certificate": {
      "tls.connect": {
        "no ca": "authorized, the server saw the client certificate",
        "ca: []": `${refused}, the server saw no client certificate`,
      },
      "fetch": {
        "no ca": "status 200, the server saw the client certificate",
        "ca: []": `${refused}, the server saw no client certificate`,
      },
      "Bun.connect": {
        "no ca": "authorized, the server saw the client certificate",
        "ca: []": `${unauthorized}, the server saw no client certificate`,
      },
    },
    "RedisClient, Bun.SQL": {
      "RedisClient": { "tls: true": "handshake completed", "ca: []": refused },
      "Bun.SQL, postgres": { "no ca": "handshake completed", "ca: []": refused },
      "Bun.SQL, mysql": { "no ca": "handshake completed", "ca: []": refused },
    },
  };

  for (const [mode, rows] of Object.entries(onBun)) {
    test.concurrent(
      mode,
      async () => {
        expect(await run(bunExe(), mode)).toEqual({ rows, stderr: "", exitCode: 0 });
      },
      timeout,
    );
  }
});

// Node's own test of `ca: []`. Here ca1 and ca2, which issued the certificates of its servers, are default roots.
test.concurrent(
  "test-tls-client-verify.js passes when its CAs are default roots",
  async () => {
    using dir = tempDir("ca-empty-node-test", {
      "roots.pem": [await pem("ca1-cert.pem"), await pem("ca2-cert.pem")].join("\n"),
    });
    await using proc = spawn({
      cmd: [bunExe(), join(import.meta.dir, "..", "test", "parallel", "test-tls-client-verify.js")],
      env: { ...bunEnv, NODE_EXTRA_CA_CERTS: join(String(dir), "roots.pem") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The file prints one of these for each connection, and asserts that the two values are equal.
    const verdicts = stderr.split("\n").filter(line => line.startsWith("expected: "));
    const authorized = "expected: true authed: true";
    const notAuthorized = "expected: false authed: false";
    expect({ verdicts, stdout, exitCode }).toEqual({
      verdicts: [
        ...[authorized, notAuthorized, notAuthorized], // ca: [ca1]
        ...[notAuthorized, notAuthorized, notAuthorized], // ca: []
        ...[authorized, notAuthorized, authorized], // ca: [ca1, ca2]
      ],
      stdout: "successful tests: 3\n",
      exitCode: 0,
    });
  },
  timeout,
);

// The default roots are loaded for a context that trusts them, and for no other. The load is visible here:
// it warns about a NODE_EXTRA_CA_CERTS file that does not exist.
test.concurrent(
  "a context that was given a ca does not load the default roots",
  async () => {
    using dir = tempDir("ca-empty-no-defaults", {});
    const listen = async (contexts: string) => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `const { CERT: cert, KEY: key } = process.env;
          for (const tls of ${contexts}) {
            Bun.listen({ hostname: "127.0.0.1", port: 0, tls: { cert, key, ...tls }, socket: { data() {} } }).stop(true);
          }`,
        ],
        env: { ...bunEnv, NODE_EXTRA_CA_CERTS: "missing.pem", CERT: pair.cert, KEY: pair.key },
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      return { stderr, exitCode };
    };
    const [givenCA, noCA] = await Promise.all([
      listen(`[{ ca: [] }, { ca: [], allowPartialTrustChain: true }, { ca: cert, allowPartialTrustChain: true }]`),
      listen(`[{ allowPartialTrustChain: true }]`),
    ]);
    expect({ givenCA, noCA }).toEqual({
      givenCA: { stderr: "", exitCode: 0 },
      noCA: {
        stderr: "Warning: Ignoring extra certs from `missing.pem`, load failed: No such file or directory\n",
        exitCode: 0,
      },
    });
  },
  timeout,
);
