import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tls as tlsCert } from "harness";
import WebSocket from "ws";

// https://github.com/oven-sh/bun/issues/31396
//
// The npm `ws` package accepts TLS options as top-level options on the
// WebSocket constructor and forwards them to https.request/tls.connect:
//
//   new WebSocket("wss://host", { rejectUnauthorized: false });
//
// Bun's `ws` shim only read TLS options from `options.tls`, so top-level keys
// like `rejectUnauthorized: false` were dropped and connecting to a self-signed
// `wss://` server failed with "TLS handshake failed".
describe("ws top-level TLS options", () => {
  function serveTls() {
    return Bun.serve({
      port: 0,
      tls: { key: tlsCert.key, cert: tlsCert.cert },
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("expected websocket", { status: 400 });
      },
      websocket: {
        open(ws) {
          ws.close();
        },
        message() {},
      },
    });
  }

  it("rejectUnauthorized: false connects to a self-signed server", async () => {
    await using server = serveTls();
    const { resolve, reject, promise } = Promise.withResolvers<void>();

    const ws = new WebSocket(`wss://localhost:${server.port}`, { rejectUnauthorized: false });
    ws.on("open", () => {
      ws.close();
      resolve();
    });
    ws.on("error", reject);

    await promise;
  });

  it("a self-signed server is still rejected without rejectUnauthorized: false", async () => {
    await using server = serveTls();
    const { resolve, reject, promise } = Promise.withResolvers<{ message: string }>();

    const ws = new WebSocket(`wss://localhost:${server.port}`);
    ws.on("open", () => reject(new Error("unexpectedly connected to a self-signed server")));
    ws.on("error", resolve);

    const err = await promise;
    expect(err.message).toContain("TLS handshake failed");
  });

  // The agent's `ca` must still reach the handshake when a top-level TLS key
  // is present: the self-signed cert is its own CA, so with the default
  // `rejectUnauthorized: true` the connection only opens if `ca` was kept.
  it("keeps agent TLS options alongside top-level TLS options", async () => {
    await using server = serveTls();
    const { resolve, reject, promise } = Promise.withResolvers<void>();

    const agent = { connectOpts: { ca: tlsCert.cert } };
    const ws = new WebSocket(`wss://localhost:${server.port}`, { agent, servername: "localhost" });
    ws.on("open", () => {
      ws.close();
      resolve();
    });
    ws.on("error", reject);

    await promise;
  });

  // On a conflict the top-level key wins: the agent says `rejectUnauthorized:
  // false` but the top level says `true`, so the self-signed server is rejected.
  // Reversing the merge order would let the agent's `false` win and connect.
  it("top-level TLS options win over the agent on conflict", async () => {
    await using server = serveTls();
    const { resolve, reject, promise } = Promise.withResolvers<{ message: string }>();

    const agent = { connectOpts: { rejectUnauthorized: false } };
    const ws = new WebSocket(`wss://localhost:${server.port}`, { agent, rejectUnauthorized: true });
    ws.on("open", () => reject(new Error("agent rejectUnauthorized:false won over the top-level true")));
    ws.on("error", resolve);

    const err = await promise;
    expect(err.message).toContain("TLS handshake failed");
  });

  // Node/`ws` accept `ALPNProtocols` as a string[], but Bun's native TLS parser
  // only takes string/ArrayBuffer/null. Forwarding the array form used to throw
  // a TypeError from the constructor; it must stay a no-op (WebSocket negotiates
  // subprotocols over Sec-WebSocket-Protocol, not TLS ALPN) so the rest of the
  // options still apply and the connection proceeds.
  it("ignores a string[] ALPNProtocols instead of throwing", async () => {
    await using server = serveTls();
    const { resolve, reject, promise } = Promise.withResolvers<void>();

    const ws = new WebSocket(`wss://localhost:${server.port}`, {
      rejectUnauthorized: false,
      ALPNProtocols: ["http/1.1"],
    });
    ws.on("open", () => {
      ws.close();
      resolve();
    });
    ws.on("error", reject);

    await promise;
  });

  // Node/`ws` accept `key`/`cert` as an array of `{ pem, passphrase }` objects
  // (per-key passphrases), but Bun's native parser only understands
  // string/ArrayBuffer/Blob (or arrays of those). Forwarding the object-array
  // form used to throw a TypeError from the constructor; it must stay a no-op
  // (as it was before top-level TLS forwarding) so construction doesn't throw.
  it("ignores an object-array key instead of throwing", async () => {
    await using server = serveTls();
    const { resolve, reject, promise } = Promise.withResolvers<void>();

    // The server doesn't request a client cert, so dropping the unparseable key
    // is harmless and the connection still opens with rejectUnauthorized: false.
    const ws = new WebSocket(`wss://localhost:${server.port}`, {
      rejectUnauthorized: false,
      key: [{ pem: tlsCert.key, passphrase: "" }],
      cert: tlsCert.cert,
    });
    ws.on("open", () => {
      ws.close();
      resolve();
    });
    ws.on("error", reject);

    await promise;
  });

  // The bare (non-array) `{ pem, passphrase }` object form must behave the same
  // as the array-wrapped form above: the native parser has no arm for a plain
  // object, so it's skipped rather than forwarded into a constructor throw.
  it("ignores a bare object key instead of throwing", async () => {
    await using server = serveTls();
    const { resolve, reject, promise } = Promise.withResolvers<void>();

    const ws = new WebSocket(`wss://localhost:${server.port}`, {
      rejectUnauthorized: false,
      key: { pem: tlsCert.key, passphrase: "" },
      cert: tlsCert.cert,
    });
    ws.on("open", () => {
      ws.close();
      resolve();
    });
    ws.on("error", reject);

    await promise;
  });

  // An explicit Bun `tls` object is a hard override: an agent's connect options
  // (which target the proxy hop) must not leak into it. Here the explicit `tls`
  // leaves `rejectUnauthorized` at its default (true) while the agent carries
  // `rejectUnauthorized: false`. The agent's value must not disable target
  // verification, so the self-signed server is still rejected.
  it("keeps an explicit tls object authoritative over agent options", async () => {
    await using server = serveTls();
    const { resolve, reject, promise } = Promise.withResolvers<{ message: string }>();

    const agent = { connectOpts: { rejectUnauthorized: false } };
    const ws = new WebSocket(`wss://localhost:${server.port}`, { tls: {}, agent });
    ws.on("open", () => reject(new Error("agent rejectUnauthorized:false leaked into explicit tls")));
    ws.on("error", resolve);

    const err = await promise;
    expect(err.message).toContain("TLS handshake failed");
  });

  // These mutate globals, so each runs in its own process. The script prints
  // "open" or "error:<message>" and the parent asserts on that.
  async function runInChild(script: string): Promise<string> {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return stdout.trim();
  }

  const childPreamble = `
    import WebSocket from "ws";
    const tls = ${JSON.stringify({ key: tlsCert.key, cert: tlsCert.cert })};
    const server = Bun.serve({
      port: 0,
      tls,
      fetch(req, s) { if (s.upgrade(req)) return; return new Response("", { status: 400 }); },
      websocket: { open(ws) { ws.close(); }, message() {} },
    });
    function connect(options) {
      return new Promise(resolve => {
        const ws = new WebSocket("wss://localhost:" + server.port, options);
        ws.on("open", () => { ws.close(); resolve("open"); });
        ws.on("error", e => resolve("error:" + e.message));
      });
    }
  `;

  // A polluted Object.prototype.rejectUnauthorized must not disable
  // verification: only own properties of the options object are read.
  it("ignores a polluted Object.prototype.rejectUnauthorized", async () => {
    const out = await runInChild(`${childPreamble}
      Object.prototype.rejectUnauthorized = false;
      Object.prototype.allowPartialTrustChain = true;
      console.log(await connect({}));
      server.stop(true);
    `);
    expect(out).toContain("error:");
    expect(out).toContain("TLS handshake failed");
  });

  // The file-shape check must use the ArrayBuffer.isView captured at module
  // load. A Buffer key reaches that check (a string short-circuits before it),
  // so a live ArrayBuffer.isView lookup would throw here and fail the test.
  it("still forwards a Buffer key after ArrayBuffer.isView is clobbered", async () => {
    const out = await runInChild(`${childPreamble}
      ArrayBuffer.isView = () => { throw new Error("clobbered"); };
      console.log(await connect({
        rejectUnauthorized: false,
        key: [Buffer.from(tls.key)],
        cert: Buffer.from(tls.cert),
      }));
      server.stop(true);
    `);
    expect(out).toBe("open");
  });
});
