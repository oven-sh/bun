// fetch and WebSocket are built natively, so tls.setDefaultCACertificates() has to reach them as it does node:tls.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls as serverCert, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
const otherCA = fixture("ca1-cert.pem");

const prelude = /* js */ `
  import tls from "node:tls";
  const { good, other, key, clientCert, clientKey } = JSON.parse(process.env.CERTS);
  const server = Bun.serve({
    port: 0,
    tls: { cert: good, key },
    fetch(req, srv) {
      return srv.upgrade(req) ? undefined : new Response("ok");
    },
    websocket: { message() {} },
  });
  const viaFetch = (opts, url = server.url) =>
    fetch(url, opts).then(r => r.text()).then(() => "OK", e => e.code);
  const viaWs = opts => {
    const { promise, resolve } = Promise.withResolvers();
    const ws = new WebSocket(server.url.href.replace("https", "wss"), opts);
    ws.onopen = () => { ws.close(); resolve("OK"); };
    ws.onerror = () => resolve("REFUSED");
    return promise;
  };
  const report = async () => ({ fetch: await viaFetch(), ws: await viaWs() });
`;

async function run(body: string, extraEnv?: { SSL_CERT_FILE: "good" }) {
  using dir = tempDir("default-ca-native-clients", {
    "run.mjs": prelude + body + "\nprocess.exit(0);",
    "good.pem": serverCert.cert,
  });
  const { SSL_CERT_FILE, SSL_CERT_DIR, NODE_EXTRA_CA_CERTS, ...env } = bunEnv as Record<string, string>;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.mjs"],
    env: {
      ...env,
      ...(extraEnv && { SSL_CERT_FILE: join(String(dir), "good.pem") }),
      CERTS: JSON.stringify({
        good: serverCert.cert,
        other: otherCA,
        key: serverCert.key,
        clientCert: fixture("agent1-cert.pem"),
        clientKey: fixture("agent1-key.pem"),
      }),
    },
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
}

const refused = { fetch: "DEPTH_ZERO_SELF_SIGNED_CERT", ws: "REFUSED" };

test.concurrent("the default list is trusted, and not before it is set", async () => {
  const result = await run(`
    const before = await report();
    tls.setDefaultCACertificates([good]);
    console.log(JSON.stringify({ before, after: await report() }));
  `);
  expect(result).toEqual({ before: refused, after: { fetch: "OK", ws: "OK" } });
});

test.concurrent("replacing the list refuses new connections", async () => {
  const result = await run(`
    tls.setDefaultCACertificates([good]);
    const first = await report();
    tls.setDefaultCACertificates([other]);
    console.log(JSON.stringify({ first, second: await report() }));
  `);
  expect(result).toEqual({ first: { fetch: "OK", ws: "OK" }, second: refused });
});

test.concurrent("an empty list trusts nothing", async () => {
  const result = await run(
    `
    tls.setDefaultCACertificates([]);
    const viaTls = () => {
      const { promise, resolve } = Promise.withResolvers();
      const socket = tls.connect({ port: server.port, host: "localhost", ca: undefined });
      socket.on("secureConnect", () => { socket.destroy(); resolve("OK"); });
      socket.on("error", e => resolve(e.code));
      return promise;
    };
    console.log(JSON.stringify({ ...(await report()), tls: await viaTls() }));
  `,
    { SSL_CERT_FILE: "good" },
  );
  expect(result).toEqual({
    fetch: "DEPTH_ZERO_SELF_SIGNED_CERT",
    ws: "REFUSED",
    tls: "DEPTH_ZERO_SELF_SIGNED_CERT",
  });
});

test.concurrent("an empty default also covers an empty ca beside other options", async () => {
  const result = await run(
    `
    tls.setDefaultCACertificates([]);
    const opts = { tls: { ca: [], serverName: "localhost" } };
    console.log(JSON.stringify({ fetch: await viaFetch(opts), ws: await viaWs(opts) }));
  `,
    { SSL_CERT_FILE: "good" },
  );
  expect(result).toEqual({ fetch: "DEPTH_ZERO_SELF_SIGNED_CERT", ws: "REFUSED" });
});

test.concurrent("a certificate failure carries its code on cause", async () => {
  const result = await run(`
    const error = await fetch(server.url).catch(e => e);
    console.log(JSON.stringify({ code: error.code, cause: error.cause?.code }));
  `);
  expect(result).toEqual({ code: "DEPTH_ZERO_SELF_SIGNED_CERT", cause: "DEPTH_ZERO_SELF_SIGNED_CERT" });
});

test.concurrent("a native server checks client certificates against the default list", async () => {
  const result = await run(`
    const mtls = () => {
      const strict = Bun.serve({
        port: 0,
        tls: { cert: good, key, requestCert: true, rejectUnauthorized: true },
        fetch: () => new Response("ok"),
      });
      return viaFetch({ tls: { ca: [good], cert: clientCert, key: clientKey } }, strict.url);
    };
    tls.setDefaultCACertificates([other]);
    const issuerListed = await mtls();
    tls.setDefaultCACertificates([good]);
    console.log(JSON.stringify({ issuerListed, issuerAbsent: (await mtls()) === "OK" ? "OK" : "REFUSED" }));
  `);
  expect(result).toEqual({ issuerListed: "OK", issuerAbsent: "REFUSED" });
});

test.concurrent("an explicit ca wins over the default list", async () => {
  const result = await run(`
    tls.setDefaultCACertificates([other]);
    const opts = { tls: { ca: [good] } };
    console.log(JSON.stringify({ fetch: await viaFetch(opts), ws: await viaWs(opts) }));
  `);
  expect(result).toEqual({ fetch: "OK", ws: "OK" });
});

test.concurrent("TLS options without ca still use the default list", async () => {
  const result = await run(`
    tls.setDefaultCACertificates([good]);
    const opts = { tls: { serverName: "localhost" } };
    console.log(JSON.stringify({ fetch: await viaFetch(opts), ws: await viaWs(opts) }));
  `);
  expect(result).toEqual({ fetch: "OK", ws: "OK" });
});

test.concurrent("a worker keeps its own default", async () => {
  const result = await run(`
    tls.setDefaultCACertificates([good]);
    const worker = new Worker(URL.createObjectURL(new Blob([\`
      fetch(\${JSON.stringify(server.url.href)}).then(() => "OK", e => e.code).then(postMessage);
    \`])));
    const { promise, resolve } = Promise.withResolvers();
    worker.onmessage = e => resolve(e.data);
    console.log(JSON.stringify({ main: await viaFetch(), worker: await promise }));
  `);
  expect(result).toEqual({ main: "OK", worker: "DEPTH_ZERO_SELF_SIGNED_CERT" });
});
