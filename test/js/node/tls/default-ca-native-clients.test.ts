// fetch and WebSocket are built natively, so tls.setDefaultCACertificates() has to reach them as it does node:tls.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tls as serverCert, tempDir } from "harness";
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

test.concurrent("trusts the default list only after it's set", async () => {
  const result = await run(`
    const before = await report();
    tls.setDefaultCACertificates([good]);
    console.log(JSON.stringify({ before, after: await report() }));
  `);
  expect(result).toEqual({ before: refused, after: { fetch: "OK", ws: "OK" } });
});

test.concurrent("refuses new connections after the list is replaced", async () => {
  const result = await run(`
    tls.setDefaultCACertificates([good]);
    const first = await report();
    tls.setDefaultCACertificates([other]);
    console.log(JSON.stringify({ first, second: await report() }));
  `);
  expect(result).toEqual({ first: { fetch: "OK", ws: "OK" }, second: refused });
});

test.concurrent("fetch follows NODE_TLS_REJECT_UNAUTHORIZED when it changes after the list is set", async () => {
  const result = await run(`
    tls.setDefaultCACertificates([other]);
    const close = { headers: { connection: "close" } };
    const verdicts = [await viaFetch(close)];
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    verdicts.push(await viaFetch(close));
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
    verdicts.push(await viaFetch(close));
    console.log(JSON.stringify(verdicts));
  `);
  expect(result).toEqual([refused.fetch, "OK", refused.fetch]);
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

test.concurrent.each([
  ["", "OK", "OK"],
  ["other", "OK", "OK"],
  ["good", refused.fetch, "REFUSED"],
])("an empty ca uses the built-in store, not the default list [%s]", async (list, verdict, native) => {
  const result = await run(
    `
    tls.setDefaultCACertificates([${list}]);
    const viaTls = options => {
      const { promise, resolve } = Promise.withResolvers();
      const socket = tls.connect({ port: server.port, host: "localhost", ...options });
      socket.on("secureConnect", () => { socket.destroy(); resolve("OK"); });
      socket.on("error", e => resolve(e.code));
      return promise;
    };
    const viaConnect = tls => {
      const { promise, resolve } = Promise.withResolvers();
      Bun.connect({
        hostname: "localhost",
        port: server.port,
        tls,
        socket: { data() {}, handshake(socket) { resolve(socket.authorized ? "OK" : "REFUSED"); socket.end(); } },
      });
      return promise;
    };
    const all = async tls => ({
      fetch: await viaFetch({ tls }),
      session: await viaFetch({ session: new Bun.FetchSession({ tls }) }),
      ws: await viaWs({ tls }),
      connect: await viaConnect(tls),
      tls: await viaTls(tls),
    });
    console.log(JSON.stringify([await all({ ca: [] }), await all({ ca: [], serverName: "localhost" })]));
  `,
    // The built-in store trusts the server only in the rows whose list doesn't.
    list === "good" ? undefined : { SSL_CERT_FILE: "good" },
  );
  const expected = { fetch: verdict, session: verdict, ws: native, connect: native, tls: verdict };
  expect(result).toEqual([expected, expected]);
});

test.concurrent("a server with an empty ca doesn't take client certificates of the default list", async () => {
  const result = await run(`
    tls.setDefaultCACertificates([other]);
    const options = { cert: good, key, ca: [], requestCert: true, rejectUnauthorized: true };
    const native = Bun.serve({ port: 0, tls: options, fetch: () => new Response("ok") });
    const node = (await import("node:https")).createServer(options, (req, res) => res.end("ok"));
    await new Promise(resolve => node.listen(0, resolve));
    const client = { tls: { ca: good, cert: clientCert, key: clientKey } };
    console.log(JSON.stringify([
      (await viaFetch(client, native.url)) === "OK",
      (await viaFetch(client, "https://localhost:" + node.address().port)) === "OK",
    ]));
  `);
  expect(result).toEqual([false, false]);
});

// fetch.preconnect() does nothing on Windows.
test.skipIf(isWindows).concurrent.each(["http", "https"])(
  "fetch.preconnect() opens the %s connection that fetch() then takes",
  async scheme => {
    const result = await run(`
    let connections = 0;
    const opened = Promise.withResolvers();
    const origin = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      tls: ${scheme === "https" ? "{ key, cert: good }" : "undefined"},
      socket: {
        open() {
          connections++;
          if (${scheme === "http"}) opened.resolve();
        },
        handshake: opened.resolve,
        data: socket => void socket.end("HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\nConnection: close\\r\\n\\r\\nok"),
      },
    });
    const url = "${scheme}://localhost:" + origin.port + "/";
    tls.setDefaultCACertificates([good]);
    fetch.preconnect(url);
    await opened.promise;
    // A whole request to another origin: the HTTP thread has pooled the new socket by the end of it.
    await viaFetch();
    const body = await (await fetch(url)).text();
    console.log(JSON.stringify({ body, connections }));
  `);
    expect(result).toEqual({ body: "ok", connections: 1 });
  },
);

test.concurrent("sets error.cause.code on a certificate failure", async () => {
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

test.concurrent("a FetchSession with TLS options follows the list", async () => {
  const result = await run(
    `
    const create = ca => new Bun.FetchSession({ tls: { rejectUnauthorized: true, ca } });
    const [used, unused, ownCA] = [create(), create(), create(good)];
    const all = async () => [await viaFetch({ session: used }), await viaFetch({ session: unused }), await viaFetch({ session: ownCA })];
    const before = await viaFetch({ session: used });
    tls.setDefaultCACertificates([]);
    const emptied = await all();
    tls.setDefaultCACertificates([good]);
    console.log(JSON.stringify({ before, emptied, filled: await all() }));
  `,
    { SSL_CERT_FILE: "good" },
  );
  expect(result).toEqual({ before: "OK", emptied: [refused.fetch, refused.fetch, "OK"], filled: ["OK", "OK", "OK"] });
});

test.concurrent("a RedisClient with TLS options follows the list when it connects", async () => {
  const result = await run(
    `
    const redis = Bun.listen({
      hostname: "localhost",
      port: 0,
      tls: { cert: good, key },
      socket: { data: socket => void socket.write("+OK\\r\\n") },
    });
    const create = ca =>
      new Bun.RedisClient("rediss://localhost:" + redis.port, { tls: { rejectUnauthorized: true, ca }, autoReconnect: false });
    const connect = client => client.connect().then(() => (client.close(), "OK"), () => "REFUSED");
    const [used, unused, ownCA] = [create(), create(), create(good)];
    const all = async () => [await connect(used), await connect(unused), await connect(ownCA)];
    const before = await connect(used);
    tls.setDefaultCACertificates([]);
    const emptied = await all();
    tls.setDefaultCACertificates([good]);
    console.log(JSON.stringify({ before, emptied, filled: await all() }));
  `,
    { SSL_CERT_FILE: "good" },
  );
  expect(result).toEqual({ before: "OK", emptied: ["REFUSED", "REFUSED", "OK"], filled: ["OK", "OK", "OK"] });
});

test.concurrent("a worker has its own default list", async () => {
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
