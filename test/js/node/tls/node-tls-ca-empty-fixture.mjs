// What `ca: []` does on each API that takes TLS options. Prints one JSON object for the mode in argv[2]. The modes
// up to "tls.createServer" use node:* alone and run on Node.js too.
//
// env: CERT + KEY, a self-signed pair for localhost that is its own root. The pair is the server's identity, and
// the client's where a client certificate is wanted. NODE_EXTRA_CA_CERTS names a file that holds CERT, so the
// default trust of this process accepts the pair. OTHER_CA is a root that did not issue it. KEYS is the directory
// of Node's key fixtures: its intermediate ca3 is in NODE_EXTRA_CA_CERTS too.
//
// A mode loads only the modules it uses: a debug build takes a second to load node:tls.
const { CERT: cert, KEY: key, OTHER_CA: otherCA, KEYS: keys } = process.env;

async function listen(server) {
  const { promise, resolve } = Promise.withResolvers();
  server.listen(0, "127.0.0.1", resolve);
  await promise;
  return server.address().port;
}

// "authorized", "unauthorized <code>" (the handshake completed) or "error <code>" (it was refused).
async function tlsConnect(port, options) {
  const tls = await import("node:tls");
  const { promise, resolve } = Promise.withResolvers();
  const socket = tls.connect({ host: "127.0.0.1", port, servername: "localhost", ...options }, () => {
    resolve(socket.authorized ? "authorized" : `unauthorized ${socket.authorizationError}`);
    // Not destroy(): that can drop the last flight of the handshake, which holds the client certificate.
    socket.end();
  });
  socket.on("error", err => resolve(`error ${err.code}`));
  return promise;
}

async function tlsServer(options = {}) {
  const tls = await import("node:tls");
  const server = tls.createServer({ cert, key, ...options }, socket => socket.on("error", () => {}));
  server.on("tlsClientError", () => {});
  return { server, port: await listen(server) };
}

// A server with `asks` wants a client certificate and lets every client in, to say what it makes of a certificate
// that a default root issued.
const asks = { requestCert: true, rejectUnauthorized: false };
const withCertificate = port => ({
  host: "127.0.0.1",
  port,
  servername: "localhost",
  cert,
  key,
  rejectUnauthorized: false,
});

const status = response =>
  response.then(
    res => `status ${res.status}`,
    err => `error ${err.code}`,
  );

const modes = {
  async "tls.connect"() {
    const tls = await import("node:tls");
    const { server, port } = await tlsServer();
    const addedOtherCA = tls.createSecureContext({ ca: [] });
    addedOtherCA.context.addCACert(otherCA);
    const addedIssuer = tls.createSecureContext({ ca: [] });
    addedIssuer.context.addCACert(cert);
    const result = {
      "no ca": await tlsConnect(port, {}),
      "ca: []": await tlsConnect(port, { ca: [] }),
      // The two must not share one cached context, in either order.
      "no ca, again": await tlsConnect(port, {}),
      "ca: [], rejectUnauthorized: false": await tlsConnect(port, { ca: [], rejectUnauthorized: false }),
      // A falsy `ca` is not given.
      "ca: ''": await tlsConnect(port, { ca: "" }),
      "secureContext: createSecureContext({ ca: [] })": await tlsConnect(port, {
        secureContext: tls.createSecureContext({ ca: [] }),
      }),
      "createSecureContext({ ca: [] }), then addCACert(another root)": await tlsConnect(port, {
        secureContext: addedOtherCA,
      }),
      "createSecureContext({ ca: [] }), then addCACert(the issuer)": await tlsConnect(port, {
        secureContext: addedIssuer,
      }),
    };
    server.close();
    return result;
  },

  async "tls.connect over a stream"() {
    const tls = await import("node:tls");
    const net = await import("node:net");
    const { Duplex } = await import("node:stream");
    const { server, port } = await tlsServer();
    // A stream that is not a socket takes the TLS engine that has no file descriptor.
    const overDuplex = options => {
      const raw = net.connect(port, "127.0.0.1");
      const duplex = new Duplex({
        read() {},
        write(chunk, encoding, callback) {
          raw.write(chunk, callback);
        },
        final(callback) {
          raw.end(callback);
        },
      });
      raw.on("data", chunk => duplex.push(chunk));
      raw.on("end", () => duplex.push(null));
      raw.on("error", err => duplex.destroy(err));
      return tlsConnect(port, { socket: duplex, ...options }).finally(() => raw.destroy());
    };
    // A socket that is connected already starts TLS in place.
    const overSocket = async options => {
      const raw = net.connect(port, "127.0.0.1");
      const connected = Promise.withResolvers();
      raw.once("connect", connected.resolve);
      await connected.promise;
      return tlsConnect(port, { socket: raw, ...options });
    };
    const emptyContext = () => ({ secureContext: tls.createSecureContext({ ca: [] }) });
    const result = {
      "a Duplex": {
        "no ca": await overDuplex({}),
        "ca: []": await overDuplex({ ca: [] }),
        "secureContext: createSecureContext({ ca: [] })": await overDuplex(emptyContext()),
      },
      "a connected net.Socket": {
        "no ca": await overSocket({}),
        "ca: []": await overSocket({ ca: [] }),
        "secureContext: createSecureContext({ ca: [] })": await overSocket(emptyContext()),
        "no ca, again": await overSocket({}),
      },
    };
    server.close();
    return result;
  },

  async "tls.setDefaultCACertificates([])"() {
    const tls = await import("node:tls");
    const { server, port } = await tlsServer();
    const result = { "no ca, before the call": await tlsConnect(port, {}) };
    tls.setDefaultCACertificates([]);
    result["no ca"] = await tlsConnect(port, {});
    // A falsy `ca` is not given, so it takes the defaults, which are empty now.
    result["ca: ''"] = await tlsConnect(port, { ca: "" });
    server.close();
    return result;
  },

  async "node:https"() {
    const https = await import("node:https");
    const server = https.createServer({ cert, key }, (req, res) => res.end("ok"));
    const port = await listen(server);
    // `agent: false`: every request dials. Requests that share an agent are in the "pooled connections" mode.
    const get = options => {
      const { promise, resolve } = Promise.withResolvers();
      https
        .get({ host: "127.0.0.1", port, servername: "localhost", agent: false, ...options }, res => {
          res.resume();
          resolve(`status ${res.statusCode}`);
        })
        .on("error", err => resolve(`error ${err.code}`));
      return promise;
    };
    const serverSees = async options => {
      const { promise, resolve } = Promise.withResolvers();
      const server = https.createServer({ cert, key, ...asks, ...options }, (req, res) => {
        resolve(`authorized=${req.socket.authorized}, authorizationError=${req.socket.authorizationError}`);
        res.end();
      });
      const port = await listen(server);
      https.get({ ...withCertificate(port), agent: false }, res => res.resume()).on("error", () => {});
      const outcome = await promise;
      server.close();
      return outcome;
    };
    const result = {
      "https.get": { "no ca": await get({}), "ca: []": await get({ ca: [] }) },
      "https.createServer, requestCert": { "no ca": await serverSees({}), "ca: []": await serverSees({ ca: [] }) },
    };
    server.close();
    return result;
  },

  async "http2.connect"() {
    const http2 = await import("node:http2");
    const server = http2.createSecureServer({ cert, key });
    const port = await listen(server);
    const connect = options => {
      const { promise, resolve } = Promise.withResolvers();
      const session = http2.connect(`https://127.0.0.1:${port}`, options, () => {
        resolve("connected");
        session.destroy();
      });
      session.on("error", err => resolve(`error ${err.code}`));
      return promise;
    };
    const result = { "no ca": await connect({}), "ca: []": await connect({ ca: [] }) };
    server.close();
    return result;
  },

  async "tls.createServer"() {
    const tls = await import("node:tls");
    const fs = await import("node:fs");
    const path = await import("node:path");
    const serverSees = async (options, configure) => {
      const { server, port } = await tlsServer({ ...asks, ...options });
      configure?.(server);
      const { promise, resolve } = Promise.withResolvers();
      server.on("secureConnection", socket => {
        resolve(`authorized=${socket.authorized}`);
        socket.end();
      });
      const closed = Promise.withResolvers();
      const socket = tls.connect(withCertificate(port));
      socket.on("error", () => {});
      socket.on("close", closed.resolve);
      socket.resume();
      const [outcome] = await Promise.all([promise, closed.promise]);
      server.close();
      return outcome;
    };
    // A server with a leaf alone takes the rest of its chain from its trust store. This client trusts the root
    // alone, so it authorizes the server only when the intermediate came with the leaf.
    const pem = name => fs.readFileSync(path.join(keys, name), "utf8");
    const [leaf] = pem("agent6-cert.pem").split(/(?=-----BEGIN CERTIFICATE-----)/);
    const presentsItsChain = async options => {
      const { server, port } = await tlsServer({ cert: leaf, key: pem("agent6-key.pem"), ...options });
      const verify = { ca: [pem("ca1-cert.pem")], rejectUnauthorized: false, checkServerIdentity: () => undefined };
      const outcome = await tlsConnect(port, verify);
      server.close();
      return outcome;
    };
    return {
      "requestCert": {
        "no ca": await serverSees({}),
        "ca: []": await serverSees({ ca: [] }),
        "then setSecureContext({ ca: [] })": await serverSees({}, server =>
          server.setSecureContext({ cert, key, ca: [] }),
        ),
        "then addContext('localhost', { ca: [] })": await serverSees({}, server =>
          server.addContext("localhost", { cert, key, ca: [] }),
        ),
      },
      "a leaf-only cert": {
        "no ca": await presentsItsChain({}),
        "ca: []": await presentsItsChain({ ca: [] }),
      },
    };
  },

  async "fetch, WebSocket"() {
    const https = await import("node:https");
    const { default: nodeFetch } = await import("node-fetch");
    const { default: WS } = await import("ws");
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { cert, key },
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("ok");
      },
      websocket: { message() {} },
    });
    const url = `https://127.0.0.1:${server.port}/`;
    const opens = ws => {
      const { promise, resolve } = Promise.withResolvers();
      ws.onopen = () => {
        resolve("open");
        ws.close();
      };
      ws.onerror = () => resolve("error");
      return promise;
    };
    return {
      "fetch": {
        "no ca": await status(fetch(url, { keepalive: false })),
        "ca: []": await status(fetch(url, { tls: { ca: [] }, keepalive: false })),
      },
      "Bun.FetchSession": {
        "no ca": await status(new Bun.FetchSession().fetch(url)),
        "ca: []": await status(new Bun.FetchSession({ tls: { ca: [] } }).fetch(url)),
      },
      "node-fetch": {
        "no ca": await status(nodeFetch(url)),
        "ca: []": await status(nodeFetch(url, { agent: new https.Agent({ ca: [] }) })),
      },
      "WebSocket": {
        "no ca": await opens(new WebSocket(url)),
        "ca: []": await opens(new WebSocket(url, { tls: { ca: [] } })),
      },
      "ws": {
        "no ca": await opens(new WS(url)),
        "ca: []": await opens(new WS(url, { ca: [] })),
      },
    };
  },

  // The tls object of these sockets decides if they do TLS.
  async "Bun.connect, Bun.listen, Bun.serve"() {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", tls: { cert, key }, fetch: () => new Response("ok") });
    const handlers = resolve => ({
      // A socket without TLS sends this in the clear, and the server hangs up on it.
      open(socket) {
        socket.write("hello");
      },
      handshake(socket, success, verifyError) {
        resolve(socket.authorized ? "authorized" : `unauthorized ${verifyError?.code}`);
        socket.end();
      },
      data() {},
      connectError(socket, err) {
        resolve(`error ${err.code}`);
      },
      error(socket, err) {
        resolve(`error ${err.code}`);
      },
      close() {
        resolve("closed without a TLS handshake");
      },
    });
    const connect = tls => {
      const { promise, resolve } = Promise.withResolvers();
      const options = { hostname: "127.0.0.1", port: server.port, tls, socket: handlers(resolve) };
      Bun.connect(options).catch(err => resolve(`error ${err.code}`));
      return promise;
    };
    const upgrade = tls => {
      const { promise, resolve } = Promise.withResolvers();
      Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        socket: {
          open(raw) {
            raw.upgradeTLS({ tls, socket: handlers(resolve) });
          },
          data() {},
          // An upgradeTLS() that throws comes here.
          error(raw, err) {
            resolve(`error ${err.code}`);
          },
        },
      }).catch(err => resolve(`error ${err.code}`));
      return promise;
    };
    using lone = Bun.serve({ port: 0, hostname: "127.0.0.1", tls: { ca: [] }, fetch: () => new Response("ok") });
    // What a listener gets from a client that sends "hello" in the clear.
    const listenerGets = async tls => {
      const { promise, resolve } = Promise.withResolvers();
      using listener = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls,
        socket: {
          data(socket, chunk) {
            resolve(`plain text: ${chunk}`);
          },
          error() {},
        },
      });
      const sendsHello = {
        open(socket) {
          socket.write("hello");
        },
        data() {},
        error() {},
        close() {
          resolve("nothing: it closed the client");
        },
      };
      Bun.connect({ hostname: "127.0.0.1", port: listener.port, socket: sendsHello }).catch(() => {});
      return await promise;
    };
    return {
      "Bun.connect": {
        "tls: true": await connect(true),
        // `ca` is the only TLS option in these two. For a client it asks for TLS.
        "ca: []": await connect({ ca: [] }),
        "upgradeTLS, ca: []": await upgrade({ ca: [] }),
        // `cert`, `key` and `crl` are not given when they are empty: these are the same as `tls: {}`.
        "tls: {}": await connect({}),
        "cert: []": await connect({ cert: [] }),
        "key: []": await connect({ key: [] }),
        "crl: []": await connect({ crl: [] }),
      },
      // A server that has no certificate cannot do TLS. `ca: []` alone leaves it without TLS, as `tls: {}` does.
      "Bun.serve({ tls: { ca: [] } })": lone.url.protocol,
      "Bun.listen({ tls: { ca: [] } })": await listenerGets({ ca: [] }),
    };
  },

  // A request must not ride a connection that was verified for other TLS options.
  async "pooled connections"() {
    const https = await import("node:https");
    using origin = Bun.serve({ port: 0, hostname: "127.0.0.1", tls: { cert, key }, fetch: () => new Response("ok") });
    let connects = 0;
    const upstreams = new Map();
    using proxy = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(client, chunk) {
          if (upstreams.has(client)) return void upstreams.get(client).write(chunk);
          connects++;
          Bun.connect({
            hostname: "127.0.0.1",
            port: origin.port,
            socket: {
              open(upstream) {
                upstreams.set(client, upstream);
                client.write("HTTP/1.1 200 Connection established\r\n\r\n");
              },
              data(upstream, chunk) {
                client.write(chunk);
              },
              close() {
                client.end();
              },
              error() {},
            },
          });
        },
        close(client) {
          upstreams.get(client)?.end();
        },
        error() {},
      },
    });
    const url = `https://127.0.0.1:${origin.port}/`;
    const viaProxy = tls => status(fetch(url, { proxy: `http://127.0.0.1:${proxy.port}`, tls }));
    const tunnel = {
      "serverName": await viaProxy({ serverName: "localhost" }),
      // The tunnel is in the pool now. The same options take it, and so do options that are not given when empty.
      "serverName, again": await viaProxy({ serverName: "localhost" }),
      "serverName, cert: [], key: [], crl: []": await viaProxy({ serverName: "localhost", cert: [], key: [], crl: [] }),
      "CONNECT requests so far": connects,
      "serverName, ca: []": await viaProxy({ serverName: "localhost", ca: [] }),
      "CONNECT requests": connects,
      // An empty string is given too. No context can be made with an empty `sigalgs`, so a request that gets a
      // response here took the tunnel of other options.
      "serverName, sigalgs: ''": await viaProxy({ serverName: "localhost", sigalgs: "" }),
    };
    // Node gives `ca: []` the Agent name of no `ca`, so there the second request takes the first one's socket.
    const onOneAgent = async keepAlive => {
      const agent = new https.Agent({ keepAlive });
      const get = options => {
        const { promise, resolve } = Promise.withResolvers();
        https
          .get({ host: "127.0.0.1", port: origin.port, servername: "localhost", agent, ...options }, res => {
            res.resume();
            res.on("end", () => resolve(`status ${res.statusCode}`));
          })
          .on("error", err => resolve(`error ${err.code}`));
        return promise;
      };
      const rows = { "no ca": await get({}), "ca: []": await get({ ca: [] }) };
      agent.destroy();
      return rows;
    };
    // A `ca` that no context can be made with (`[""]`) must not share a name with either.
    const names = [{}, { ca: [] }, { ca: [""] }].map(options => https.globalAgent.getName({ host: "a", ...options }));
    return {
      "fetch through a CONNECT proxy": tunnel,
      "one https.Agent, keepAlive": await onOneAgent(true),
      "one https.Agent": await onOneAgent(false),
      "Agent names of no ca, ca: [] and ca: ['']": new Set(names).size,
    };
  },

  // A client that refuses the server does so during the handshake, before its own certificate goes out.
  async "a client certificate"() {
    const { server, port } = await tlsServer({ requestCert: true, rejectUnauthorized: false });
    const serverSaw = async client => {
      const { promise, resolve } = Promise.withResolvers();
      const onSecure = socket => {
        const sent = Object.keys(socket.getPeerCertificate()).length > 0;
        resolve(sent ? "the client certificate" : "no client certificate");
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
      };
      const onError = () => resolve("no client certificate");
      server.once("secureConnection", onSecure);
      server.once("tlsClientError", onError);
      const outcome = await client();
      const saw = await promise;
      server.off("secureConnection", onSecure);
      server.off("tlsClientError", onError);
      return `${outcome}, the server saw ${saw}`;
    };
    const bunConnect = tls => {
      const { promise, resolve } = Promise.withResolvers();
      Bun.connect({
        hostname: "127.0.0.1",
        port,
        tls,
        socket: {
          handshake(socket, success, verifyError) {
            resolve(socket.authorized ? "authorized" : `unauthorized ${verifyError?.code}`);
            socket.end();
          },
          data() {},
          error() {},
          connectError(socket, err) {
            resolve(`error ${err.code}`);
          },
        },
      }).catch(err => resolve(`error ${err.code}`));
      return promise;
    };
    const url = `https://127.0.0.1:${port}/`;
    const get = tls => status(fetch(url, { tls, keepalive: false }));
    const result = {
      "tls.connect": {
        "no ca": await serverSaw(() => tlsConnect(port, { cert, key })),
        "ca: []": await serverSaw(() => tlsConnect(port, { cert, key, ca: [] })),
      },
      "fetch": {
        "no ca": await serverSaw(() => get({ cert, key })),
        "ca: []": await serverSaw(() => get({ cert, key, ca: [] })),
      },
      "Bun.connect": {
        "no ca": await serverSaw(() => bunConnect({ cert, key })),
        "ca: []": await serverSaw(() => bunConnect({ cert, key, ca: [] })),
      },
    };
    server.close();
    return result;
  },

  // Each row has a server of its own, which drops the connection when the TLS handshake is done. A client that
  // refuses the server's certificate never gets that far.
  async "RedisClient, Bun.SQL"() {
    const tls = await import("node:tls");
    const net = await import("node:net");
    const wire = await import("../../sql/wire-frames");
    // `prelude` is what the protocol says in the clear before TLS starts. It resolves when the ClientHello is next.
    const row = async (prelude, connect) => {
      const handshake = Promise.withResolvers();
      const server = net.createServer(async raw => {
        raw.on("error", () => {});
        await prelude?.(raw);
        const secure = new tls.TLSSocket(raw, { isServer: true, cert, key });
        secure.on("error", () => {});
        secure.on("secure", () => {
          handshake.resolve("handshake completed");
          setImmediate(() => raw.destroy());
        });
      });
      const client = connect(await listen(server));
      // A client that the server drops after the handshake can dial again, so its query need not settle.
      const outcome = await Promise.race([handshake.promise, client.failed]);
      await client.close();
      server.close();
      return outcome;
    };
    const postgres = raw =>
      new Promise(resolve =>
        raw.once("data", () => {
          raw.write(wire.pgSSLResponse("S"));
          resolve();
        }),
      );
    const mysql = raw =>
      new Promise(resolve => {
        const capabilities = wire.MYSQL_DEFAULT_CAPABILITIES | wire.MYSQL_CLIENT_LONG_PASSWORD | wire.MYSQL_CLIENT_SSL;
        raw.write(wire.mysqlHandshakeV10({ capabilities }));
        let received = Buffer.alloc(0);
        const onData = chunk => {
          received = Buffer.concat([received, chunk]);
          const length = received.length < 4 ? Infinity : received[0] | (received[1] << 8) | (received[2] << 16);
          if (received.length < 4 + length) return;
          raw.off("data", onData);
          raw.pause();
          // The ClientHello can come with the SSLRequest packet.
          if (received.length > 4 + length) raw.unshift(received.subarray(4 + length));
          resolve();
        };
        raw.on("data", onData);
      });
    const code = settled =>
      settled.then(
        () => "no error",
        err => `error ${err.code}`,
      );
    const redis = tls => port => {
      const client = new Bun.RedisClient(`rediss://127.0.0.1:${port}`, { tls, autoReconnect: false });
      return { failed: code(client.send("PING", [])), close: () => client.close() };
    };
    const sql = (adapter, options) => port => {
      const url = `${adapter}://user:pass@127.0.0.1:${port}/db?sslmode=verify-full`;
      const sql = new Bun.SQL({ url, max: 1, ...options });
      return { failed: code(sql`SELECT 1`), close: () => sql.close() };
    };
    return {
      "RedisClient": {
        "tls: true": await row(undefined, redis(true)),
        "ca: []": await row(undefined, redis({ ca: [] })),
      },
      "Bun.SQL, postgres": {
        "no ca": await row(postgres, sql("postgres", {})),
        "ca: []": await row(postgres, sql("postgres", { tls: { ca: [] } })),
      },
      "Bun.SQL, mysql": {
        "no ca": await row(mysql, sql("mysql", {})),
        "ca: []": await row(mysql, sql("mysql", { tls: { ca: [] } })),
      },
    };
  },
};

console.log(JSON.stringify(await modes[process.argv[2]](), null, 2));
process.exit(0);
