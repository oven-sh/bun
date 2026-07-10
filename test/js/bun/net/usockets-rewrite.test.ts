// Integration smoke test for the Rust uSockets implementation (src/usockets/).
// Exercises the listen/accept/read/write/close hot path, TLS handshake, and
// UDP round-trip through the Rust-provided extern "C" symbols end to end.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as tlsCert } from "harness";
import dgram from "node:dgram";
import { once } from "node:events";

describe("usockets backend", () => {
  test("TCP listen/accept/data/write/close round-trip", async () => {
    let serverGot = "";
    const { promise: done, resolve } = Promise.withResolvers<void>();

    using server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(s) {
          s.write("hello from server");
        },
        data(s, data) {
          serverGot += data.toString();
          if (serverGot.includes("done")) s.end();
        },
        close() {
          resolve();
        },
      },
    });

    let clientGot = "";
    const client = await Bun.connect({
      hostname: "127.0.0.1",
      port: server.port,
      socket: {
        data(s, data) {
          clientGot += data.toString();
          s.write("ack done");
        },
        close() {},
        connectError(_s, err) {
          throw err;
        },
      },
    });

    await done;
    expect(clientGot).toBe("hello from server");
    expect(serverGot).toBe("ack done");
    expect(client.readyState).not.toBe("open");
  });

  test("TLS handshake + plaintext round-trip through ssl/openssl.rs", async () => {
    const body = "tls via rust usockets";
    using server = Bun.serve({
      port: 0,
      tls: tlsCert,
      fetch: () => new Response(body),
    });
    const res = await fetch(server.url, { tls: { rejectUnauthorized: false } });
    expect(await res.text()).toBe(body);
    expect(res.status).toBe(200);
  });

  test("UDP send/receive through udp.rs + bsd_sendmmsg/recvmmsg", async () => {
    const recv = dgram.createSocket("udp4");
    const { promise: gotMsg, resolve } = Promise.withResolvers<Buffer>();
    recv.on("message", msg => resolve(msg));
    recv.bind(0, "127.0.0.1");
    await once(recv, "listening");
    const port = (recv.address() as import("node:net").AddressInfo).port;

    const send = dgram.createSocket("udp4");
    send.send(Buffer.from("udp-roundtrip"), port, "127.0.0.1");
    const msg = await gotMsg;
    expect(msg.toString()).toBe("udp-roundtrip");

    send.close();
    recv.close();
  });

  test("large write exercises the shared recv_buf loop without truncation", async () => {
    // 1 MB > LIBUS_RECV_BUFFER_LENGTH (512 KB), so this forces at least two
    // recv()→dispatch_data cycles through loop_core.rs per connection.
    const chunk = Buffer.alloc(1024 * 1024, "x");
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const server = Bun.listen({
            hostname: "127.0.0.1", port: 0,
            socket: {
              open() {},
              data(s, d) { n += d.byteLength; if (n >= ${chunk.length}) { s.write(String(n)); s.end(); } },
              close() {},
            },
          });
          let n = 0;
          const c = await Bun.connect({
            hostname: "127.0.0.1", port: server.port,
            socket: {
              open(s) { s.write(Buffer.alloc(${chunk.length}, "x")); },
              data(s, d) { console.log(d.toString()); server.stop(); },
              close() {},
            },
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: String(chunk.length),
      stderr: "",
      exitCode: 0,
    });
  });
});
