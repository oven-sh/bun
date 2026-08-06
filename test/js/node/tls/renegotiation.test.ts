import type { Subprocess } from "bun";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
import type { IncomingMessage } from "http";
import { join } from "path";
let url: URL;
let process: Subprocess<"ignore", "pipe", "ignore"> | null = null;
beforeAll(async () => {
  process = Bun.spawn(["node", join(import.meta.dir, "renegotiation-feature.js")], {
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
    env: {
      ...bunEnv,
      SERVER_CERT: tls.cert,
      SERVER_KEY: tls.key,
    },
  });
  const { value } = await process.stdout.getReader().read();
  url = new URL(new TextDecoder().decode(value));
});

afterAll(() => {
  process?.kill();
});

it("allow renegotiation in fetch", async () => {
  const body = await fetch(url, {
    verbose: true,
    keepalive: false,
    tls: { rejectUnauthorized: false },
  }).then(res => res.text());
  expect(body).toBe("Hello World");
});

it("should fail if renegotiation fails using fetch", async () => {
  try {
    await fetch(url, {
      verbose: true,
      keepalive: false,
      tls: { rejectUnauthorized: true },
    }).then(res => res.text());
    expect.unreachable();
  } catch (e: any) {
    expect(e.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  }
});

it("allow renegotiation in https module", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  const req = require("https").request(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "GET",
      keepalive: false,
      rejectUnauthorized: false,
    },
    (res: IncomingMessage) => {
      res.setEncoding("utf8");
      let data = "";

      res.on("data", (chunk: string) => {
        data += chunk;
      });

      res.on("error", reject);
      res.on("end", () => resolve(data));
    },
  );
  req.on("error", reject);
  req.end();

  const body = await promise;
  expect(body).toBe("Hello World");
});

it("should fail if renegotiation fails using https", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  const req = require("https").request(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "GET",
      keepalive: false,
      rejectUnauthorized: true,
    },
    (res: IncomingMessage) => {
      res.setEncoding("utf8");
      let data = "";

      res.on("data", (chunk: string) => {
        data += chunk;
      });

      res.on("error", reject);
      res.on("end", () => resolve(data));
    },
  );
  req.on("error", reject);
  req.end();

  try {
    await promise;
    expect.unreachable();
  } catch (e: any) {
    expect(e.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  }
});
it("allow renegotiation in tls module", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();

  const socket = require("tls").connect({
    rejectUnauthorized: false,
    host: url.hostname,
    port: url.port,
  });
  let data = "";
  socket.on("data", (chunk: Buffer) => {
    data += chunk.toString();
    if (data.indexOf("0\r\n\r\n") !== -1) {
      const result = data.split("\r\n\r\n")[1].split("\r\n")[1];
      resolve(result);
    }
  });
  socket.on("error", reject);
  socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  const body = await promise;
  expect(body).toBe("Hello World");
});

it("should not crash when socket is closed inside the renegotiation handshake callback", async () => {
  // When a TLS 1.2 server initiates renegotiation and then sends application data, the
  // client-side SSL_read loop fires the on_handshake callback once the renegotiated
  // handshake completes. If user code closes the socket inside that callback, the SSL*
  // is freed (s->ssl = NULL) and the loop must not continue into SSL_read(NULL, ...).
  // Run in a subprocess so a NULL-deref SIGSEGV shows up as a non-zero exit instead of
  // taking down the test runner.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", renegotiationCloseInHandshakeFixture],
    env: {
      ...bunEnv,
      SERVER_HOST: url.hostname,
      SERVER_PORT: url.port,
      // If the subprocess segfaults in an ASAN build, symbolizing a ~1 GB
      // binary can take longer than the test timeout. We only need the exit
      // code / signal to assert that it did not crash.
      ASAN_OPTIONS: ((bunEnv.ASAN_OPTIONS ?? "") + ":symbolize=0").replace(/^:/, ""),
    },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode, signalCode: proc.signalCode, stderr }).toEqual({
    stdout: "ok",
    exitCode: 0,
    signalCode: null,
    stderr: expect.any(String),
  });
});

const renegotiationCloseInHandshakeFixture = /* js */ `
const { promise: done, resolve } = Promise.withResolvers();
let handshakes = 0;
const socket = await Bun.connect({
  hostname: process.env.SERVER_HOST,
  port: Number(process.env.SERVER_PORT),
  tls: { rejectUnauthorized: false },
  socket: {
    open() {},
    data() {},
    error() {
      resolve();
    },
    close() {
      resolve();
    },
    handshake(socket) {
      handshakes++;
      if (handshakes === 1) {
        // Trigger the server's request handler so it initiates renegotiation
        // and writes application data once the renegotiated handshake completes.
        socket.write("GET / HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n");
      } else {
        // Second handshake = renegotiation completed. Closing here used to NULL
        // s->ssl while ssl_on_data's SSL_read loop was still running.
        socket.terminate();
        resolve();
      }
    },
  },
});
await done;
if (handshakes < 2) {
  throw new Error("expected renegotiation handshake callback to fire, got " + handshakes + " handshake(s)");
}
console.log("ok");
`;

it("should terminate the connection when the peer exceeds the renegotiation limit over a duplex socket", async () => {
  // tls.connect({ socket: <Duplex> }) is encrypted by the SSLWrapper path
  // (UpgradedDuplex) rather than the uSockets C path. It must apply the same
  // per-connection renegotiation cap: a malicious TLS 1.2 server that spams
  // HelloRequest messages otherwise forces a full handshake each time
  // (unbounded CPU per connection).
  await using attacker = Bun.spawn({
    cmd: [
      "node",
      "-e",
      `
        const tls = require("tls");
        let renegs = 0;
        const server = tls.createServer(
          {
            cert: process.env.SERVER_CERT,
            key: process.env.SERVER_KEY,
            minVersion: "TLSv1.2",
            maxVersion: "TLSv1.2",
          },
          socket => {
            socket.on("error", () => {});
            const again = () => {
              if (renegs >= 10) {
                socket.write("DONE");
                return;
              }
              socket.renegotiate({ rejectUnauthorized: false }, err => {
                if (err) return;
                renegs++;
                again();
              });
            };
            again();
          },
        );
        server.listen(0, () => console.log(server.address().port));
      `,
    ],
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
    env: { ...bunEnv, SERVER_CERT: tls.cert, SERVER_KEY: tls.key },
  });
  const { value } = await attacker.stdout.getReader().read();
  const port = Number(new TextDecoder().decode(value).trim());

  const net = require("net");
  const { Duplex } = require("stream");
  const raw = net.connect(port, "127.0.0.1");
  const duplex = new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      raw.write(chunk, encoding, callback);
    },
    final(callback) {
      raw.end();
      callback();
    },
  });
  raw.on("data", (chunk: Buffer) => duplex.push(chunk));
  raw.on("end", () => duplex.push(null));
  raw.on("close", () => duplex.destroy());

  const { promise: outcome, resolve } = Promise.withResolvers<string>();
  let received = "";
  const socket = require("tls").connect({ socket: duplex, rejectUnauthorized: false });
  socket.on("data", (chunk: Buffer) => {
    received += chunk.toString();
    if (received.includes("DONE")) resolve("got-response");
  });
  socket.on("error", () => {});
  socket.on("close", () => resolve("closed"));

  // The SSLWrapper must tear the connection down once the peer exceeds the
  // renegotiation limit, before the attacker finishes its 10 renegotiations
  // and delivers the response.
  expect(await outcome).toBe("closed");
});

it("should fail if renegotiation fails using tls module", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();

  const socket = require("tls").connect({
    rejectUnauthorized: true,
    host: url.hostname,
    port: url.port,
  });
  let data = "";
  socket.on("data", (chunk: Buffer) => {
    data += chunk.toString();
    if (data.indexOf("0\r\n\r\n") !== -1) {
      const result = data.split("\r\n\r\n")[1].split("\r\n")[1];
      resolve(result);
    }
  });
  socket.on("error", reject);
  socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  try {
    await promise;
    expect.unreachable();
  } catch (e: any) {
    expect(e.code).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  }
});
