/**
 * What a node:quic server does with a connection from its first packet to the
 * end of its handshake: which connections get a session, which are refused,
 * and which session gets what a handshake reports.
 *
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under a Node.js that has QUIC
 * (`./configure --experimental-quic`). The expected values were recorded from
 * Node v26.3.0. Where Bun differs on purpose, the test says what Node does.
 */
import assert from "node:assert";
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { connect, listen, QuicEndpoint } from "node:quic";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { connectionIds, startRelay, undecryptable } from "./quic-relay.ts";

const isBun = typeof Bun !== "undefined";
const keysDir = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));

const transportParams = { maxIdleTimeout: 1 };
const sni = { "*": { keys: [key], certs: [cert] } };
const alpn = "handshake-test";
const dial: any = { alpn, servername: "localhost", verifyPeer: "manual", transportParams };
const tls13Labels = [
  "CLIENT_HANDSHAKE_TRAFFIC_SECRET",
  "CLIENT_TRAFFIC_SECRET_0",
  "EXPORTER_SECRET",
  "SERVER_HANDSHAKE_TRAFFIC_SECRET",
  "SERVER_TRAFFIC_SECRET_0",
];
const connectionRefused = { code: "ERR_QUIC_TRANSPORT_ERROR", errorCode: 2n };

// An NSS key log line is "<label> <client random> <secret>".
const keyLogOf = (lines: string[]) => {
  const fields = lines.map(line => String(line).trim().split(" "));
  return { labels: fields.map(f => f[0]).sort(), clientRandoms: new Set(fields.map(f => f[1])).size };
};
const quiet = (session: any) => {
  session.onerror = () => {};
  session.closed.catch(() => {});
  session.opened.catch(() => {});
  return session;
};
// "fulfilled", or the fields of the error that a test compares.
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => "fulfilled" as const,
    (e: any) => ({ code: e?.code, errorCode: e?.errorCode }),
  );
const sendTo = (port: number, datagram: Buffer) =>
  new Promise<void>((resolve, reject) => {
    const socket = createSocket("udp4");
    socket.send(datagram, port, "127.0.0.1", error => {
      socket.close();
      error ? reject(error) : resolve();
    });
  });

describe("a server session and its handshake", () => {
  test("the listen callback runs, then onkeylog gets the handshake's five lines, then opened resolves", async () => {
    const events: string[] = [];
    const lines: string[] = [];
    const serverOpened = Promise.withResolvers<void>();
    await using server = await listen(
      (session: any) => {
        quiet(session);
        events.push("onsession");
        session.opened.then(() => {
          events.push("opened");
          serverOpened.resolve();
        }, serverOpened.reject);
      },
      {
        sni,
        alpn: [alpn],
        keylog: true,
        transportParams,
        onkeylog(line: string) {
          events.push("keylog");
          lines.push(line);
        },
      } as any,
    );
    await using endpoint = new QuicEndpoint();
    const client = quiet(await connect(server.address!, { ...dial, endpoint }));
    await client.opened;
    await serverOpened.promise;
    client.close();

    assert.deepStrictEqual(
      { events, keyLog: keyLogOf(lines) },
      {
        events: ["onsession", "keylog", "keylog", "keylog", "keylog", "keylog", "opened"],
        keyLog: { labels: tls13Labels, clientRandoms: 1 },
      },
    );
  });

  for (const when of ["in the listen callback", "in a microtask", "in a nextTick"] as const) {
    test(`onkeylog assigned ${when} gets the five lines`, async () => {
      const lines: string[] = [];
      const serverOpened = Promise.withResolvers<void>();
      await using server = await listen(
        (session: any) => {
          quiet(session);
          const assign = () => {
            session.onkeylog = (line: string) => lines.push(line);
          };
          if (when === "in the listen callback") assign();
          else if (when === "in a microtask") Promise.resolve().then(assign);
          else process.nextTick(assign);
          session.opened.then(serverOpened.resolve, serverOpened.reject);
        },
        { sni, alpn: [alpn], keylog: true, transportParams } as any,
      );
      await using endpoint = new QuicEndpoint();
      const client = quiet(await connect(server.address!, { ...dial, endpoint }));
      await client.opened;
      await serverOpened.promise;
      client.close();

      assert.deepStrictEqual(keyLogOf(lines), { labels: tls13Labels, clientRandoms: 1 });
    });
  }

  test("a session keeps its key log when another connection from the same client endpoint closes during its handshake", async () => {
    const logs = new Map<object, string[]>();
    const keptSession = Promise.withResolvers<object>();
    await using server = await listen(
      (session: any) => {
        quiet(session);
        logs.set(session, []);
        session.opened.then(
          () => keptSession.resolve(session),
          () => {},
        );
      },
      {
        sni,
        alpn: [alpn],
        keylog: true,
        transportParams,
        onkeylog(this: object, line: string) {
          logs.get(this)!.push(line);
        },
      } as any,
    );
    // One endpoint, so the server sees both connections from one address.
    await using endpoint = new QuicEndpoint();
    const closing = quiet(await connect(server.address!, { ...dial, endpoint }));
    const kept = quiet(await connect(server.address!, { ...dial, endpoint }));
    // The first connection closes before the server has read its Finished.
    closing.close();
    await kept.opened;
    const lines = logs.get(await keptSession.promise)!;
    kept.close();

    assert.deepStrictEqual(keyLogOf(lines), { labels: tls13Labels, clientRandoms: 1 });
  });

  test("a session gets the key log of a handshake that the client then rejects", async () => {
    const lines: string[] = [];
    const serverClosed = Promise.withResolvers<void>();
    await using server = await listen(
      (session: any) => {
        quiet(session);
        session.closed.then(serverClosed.resolve, serverClosed.resolve);
      },
      { sni, alpn: [alpn], keylog: true, transportParams, onkeylog: (line: string) => lines.push(line) } as any,
    );
    await using endpoint = new QuicEndpoint();
    // The test certificate has no trusted issuer, so a strict client ends the handshake.
    const client = quiet(await connect(server.address!, { ...dial, endpoint, verifyPeer: "strict" }));
    const opened = await outcome(client.opened);
    await serverClosed.promise;

    // BoringSSL makes CLIENT_TRAFFIC_SECRET_0 when it writes the server's Finished.
    // Node's OpenSSL makes it when it reads the client's Finished, which never comes here.
    const labels = isBun ? tls13Labels : tls13Labels.filter(label => label !== "CLIENT_TRAFFIC_SECRET_0");
    assert.notStrictEqual(opened, "fulfilled");
    assert.deepStrictEqual(keyLogOf(lines), { labels, clientRandoms: 1 });
  });

  for (const limit of ["busy", "at maxConnectionsTotal"] as const) {
    test(`an endpoint that is ${limit} refuses a connection before its TLS handshake`, async () => {
      let announced = 0;
      await using serverEndpoint = new QuicEndpoint(limit === "busy" ? {} : ({ maxConnectionsTotal: 1 } as any));
      await using server = await listen(
        (session: any) => {
          announced++;
          quiet(session);
        },
        { endpoint: serverEndpoint, sni, alpn: [alpn], transportParams } as any,
      );
      await using heldEndpoint = new QuicEndpoint();
      const held = quiet(await connect(server.address!, { ...dial, endpoint: heldEndpoint }));
      await held.opened;
      if (limit === "busy") (serverEndpoint as any).busy = true;

      const clientKeyLog: string[] = [];
      await using refusedEndpoint = new QuicEndpoint();
      const refused = quiet(
        await connect(server.address!, {
          ...dial,
          endpoint: refusedEndpoint,
          keylog: true,
          // A client makes its first secret when it reads the server's first TLS flight.
          onkeylog: (line: string) => clientKeyLog.push(line),
        }),
      );
      const [opened, closed] = await Promise.all([outcome(refused.opened), outcome(refused.closed)]);
      held.close();

      assert.deepStrictEqual(
        { opened, closed, announced, clientKeyLog },
        { opened: connectionRefused, closed: connectionRefused, announced: 1, clientKeyLog: [] },
      );
    });
  }

  test("a closing endpoint admits no new connection, and its close completes", async () => {
    let announced = 0;
    await using serverEndpoint = new QuicEndpoint();
    const server = await listen(
      (session: any) => {
        announced++;
        quiet(session);
      },
      { endpoint: serverEndpoint, sni, alpn: [alpn], transportParams } as any,
    );
    const address = server.address!;
    await using heldEndpoint = new QuicEndpoint();
    const held = quiet(await connect(address, { ...dial, endpoint: heldEndpoint }));
    await held.opened;
    // The held session keeps the close pending.
    const serverClosed = server.close();

    const clientKeyLog: string[] = [];
    await using lateEndpoint = new QuicEndpoint();
    const late = quiet(
      await connect(address, {
        ...dial,
        endpoint: lateEndpoint,
        keylog: true,
        onkeylog: (line: string) => clientKeyLog.push(line),
      }),
    );
    // Bun answers CONNECTION_REFUSED. Node.js answers nothing (Endpoint::Receive
    // drops the packet of a closing endpoint), so its client waits until it is destroyed.
    const lateOpened = outcome(late.opened);
    if (isBun) assert.deepStrictEqual(await lateOpened, connectionRefused);
    held.close();
    await serverClosed;
    late.destroy();

    assert.notStrictEqual(await lateOpened, "fulfilled");
    assert.deepStrictEqual({ announced, clientKeyLog }, { announced: 1, clientKeyLog: [] });
  });

  test("a connection opens when the listen callback destroyed the session of another from the same client endpoint", async () => {
    const keptOpened = Promise.withResolvers<void>();
    let announced = 0;
    await using server = await listen(
      (session: any) => {
        quiet(session);
        // The first session is for the connection whose first packet came first.
        if (++announced === 1) session.destroy();
        else session.opened.then(keptOpened.resolve, () => {});
      },
      { sni, alpn: [alpn], transportParams } as any,
    );
    await using endpoint = new QuicEndpoint();
    const first = quiet(await connect(server.address!, { ...dial, endpoint }));
    const second = quiet(await connect(server.address!, { ...dial, endpoint }));
    // Node.js offers the first connection again when its client sends the Initial again.
    // Bun lets its handshake run on with no session and then drops it.
    await second.opened;
    await keptOpened.promise;
    first.destroy();
    second.close();
  });

  test("a handshake that fails closes its own session, not one of another connection from the same client endpoint", async () => {
    const sessions: Promise<unknown>[] = [];
    await using server = await listen(
      (session: any) => {
        quiet(session);
        sessions.push(outcome(session.opened));
      },
      { sni, alpn: [alpn], transportParams } as any,
    );
    await using endpoint = new QuicEndpoint();
    const right = quiet(await connect(server.address!, { ...dial, endpoint }));
    const wrong = quiet(await connect(server.address!, { ...dial, endpoint, alpn: "not-offered" }));
    const client = await Promise.all([outcome(right.opened), outcome(wrong.opened)]);
    const serverSide = await Promise.all(sessions);
    right.close();

    // TLS alert no_application_protocol (120) as a QUIC CRYPTO_ERROR (RFC 9001 section 4.8).
    const noApplicationProtocol = { code: "ERR_QUIC_TRANSPORT_ERROR", errorCode: 0x178n };
    assert.deepStrictEqual(
      { client, server: serverSide },
      { client: ["fulfilled", noApplicationProtocol], server: ["fulfilled", noApplicationProtocol] },
    );
  });

  test("a session has its path in the listen callback", async () => {
    const paths: { local: number; remote: number }[] = [];
    await using server = await listen(
      (session: any) => {
        quiet(session);
        paths.push({ local: session.path.local.port, remote: session.path.remote.port });
      },
      { sni, alpn: [alpn], transportParams } as any,
    );
    await using endpoint = new QuicEndpoint();
    const client = quiet(await connect(server.address!, { ...dial, endpoint }));
    await client.opened;
    const clientPort = client.path.local.port;
    client.close();

    assert.deepStrictEqual(paths, [{ local: server.address!.port, remote: clientPort }]);
  });

  for (const [name, datagram] of [
    ["a 64-byte Initial", undecryptable("initial", { dcid: Buffer.from("stray-01") }, 64)],
    ["a 1200-byte Initial that no key decrypts", undecryptable("initial", { dcid: Buffer.from("stray-02") })],
    ["a 1200-byte 0-RTT packet", undecryptable("0rtt", { dcid: Buffer.from("stray-03") })],
    ["a 1200-byte Handshake packet", undecryptable("handshake", { dcid: Buffer.from("stray-04") })],
  ] as const) {
    test(`${name} of no connection gets no session`, async () => {
      let announced = 0;
      await using server = await listen(
        (session: any) => {
          announced++;
          quiet(session);
        },
        { sni, alpn: [alpn], transportParams } as any,
      );
      await sendTo(server.address!.port, datagram);
      // The server reads a real connection's first packet after that datagram.
      await using endpoint = new QuicEndpoint();
      const client = quiet(await connect(server.address!, { ...dial, endpoint }));
      await client.opened;
      client.close();

      assert.strictEqual(announced, 1);
    });
  }

  for (const type of ["0rtt", "handshake"] as const) {
    test(`a connection opens with one session when a ${type} packet for it arrives before its Initial`, async () => {
      let announced = 0;
      await using server = await listen(
        (session: any) => {
          announced++;
          quiet(session);
        },
        { sni, alpn: [alpn], transportParams } as any,
      );
      await using endpoint = new QuicEndpoint();
      await using relay = await startRelay(server.address!.port, (direction, nth, datagram) =>
        direction === "toServer" && nth === 1 ? { before: [undecryptable(type, connectionIds(datagram))] } : "forward",
      );
      const client = quiet(await connect(relay.address, { ...dial, endpoint }));
      await client.opened;
      client.close();

      assert.strictEqual(announced, 1);
    });
  }

  test("a connection whose source port changes after its first packet gets one session", async () => {
    let announced = 0;
    await using server = await listen(
      (session: any) => {
        announced++;
        quiet(session);
      },
      { sni, alpn: [alpn], transportParams } as any,
    );
    await using endpoint = new QuicEndpoint();
    await using relay = await startRelay(server.address!.port, (direction, nth) =>
      direction === "toServer" && nth === 2 ? "rebind" : "forward",
    );
    const client = quiet(await connect(relay.address, { ...dial, endpoint }));
    const opened = (await outcome(client.opened)) === "fulfilled";
    client.destroy();

    // Node.js validates the client's address with a Retry before it creates a session,
    // and the token does not match the new port. Bun completes the handshake on the new path.
    assert.deepStrictEqual(
      { opened, announced, serverSessions: server.stats.serverSessions },
      isBun ? { opened: true, announced: 1, serverSessions: 1n } : { opened: false, announced: 0, serverSessions: 0n },
    );
  });

  test("a client whose refusal is lost connects once the endpoint is no longer busy", async () => {
    let announced = 0;
    await using serverEndpoint = new QuicEndpoint();
    await using server = await listen(
      (session: any) => {
        announced++;
        quiet(session);
      },
      { endpoint: serverEndpoint, sni, alpn: [alpn], transportParams } as any,
    );
    (serverEndpoint as any).busy = true;
    await using endpoint = new QuicEndpoint();
    await using relay = await startRelay(server.address!.port, direction => {
      if (direction === "toServer" || !(serverEndpoint as any).busy) return "forward";
      // The refusal is lost, and the endpoint has room before the client sends its Initial again.
      (serverEndpoint as any).busy = false;
      return "drop";
    });
    const client = quiet(await connect(relay.address, { ...dial, endpoint }));
    await client.opened;
    client.close();

    assert.strictEqual(announced, 1);
  });

  test("handshakeTimeout ends a handshake whose client gets only the server's first datagram", async () => {
    const sessions: Promise<unknown>[] = [];
    const serverClosed = Promise.withResolvers<void>();
    await using server = await listen(
      (session: any) => {
        quiet(session);
        sessions.push(outcome(session.opened));
        session.closed.then(serverClosed.resolve, serverClosed.resolve);
      },
      { sni, alpn: [alpn], transportParams: { maxIdleTimeout: 30 }, handshakeTimeout: 1000 } as any,
    );
    // The client can read the ServerHello and cannot finish. It probes with Handshake
    // packets, which must not move the server's deadline to the idle timeout.
    await using endpoint = new QuicEndpoint();
    await using relay = await startRelay(server.address!.port, (direction, nth) =>
      direction === "toClient" && nth > 1 ? "drop" : "forward",
    );
    const client = quiet(await connect(relay.address, { ...dial, endpoint, transportParams: { maxIdleTimeout: 30 } }));
    await serverClosed.promise;
    client.destroy();

    assert.deepStrictEqual(
      (await Promise.all(sessions)).map(opened => opened !== "fulfilled"),
      [true],
    );
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (isBun) {
  const { bunEnv, nodeExe } = await import("harness");
  const node = nodeExe();
  // Official Node.js builds have no QUIC: `process.config.variables.node_use_quic` is false.
  const hasQuic =
    node != null &&
    Bun.spawnSync({ cmd: [node, "-p", "process.config.variables.node_use_quic"], env: bunEnv })
      .stdout.toString()
      .trim() === "true";

  describe("Node.js compatibility", () => {
    // Node.js closes each test's server gracefully, which takes about 3 s.
    (hasQuic ? test : test.skip)("all tests pass in a Node.js that has QUIC", { timeout: 180_000 }, async () => {
      await using proc = Bun.spawn({
        cmd: [node!, "--experimental-quic", "--no-warnings", fileURLToPath(import.meta.url)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
