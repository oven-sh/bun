import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import dgram from "node:dgram";

async function getUnreachablePort(): Promise<number> {
  const probe = dgram.createSocket("udp4");
  await new Promise<void>(resolve => probe.bind(0, resolve));
  const port = probe.address().port;
  await new Promise<void>(resolve => probe.close(resolve));
  return port;
}

describe("UDP socket stays open after sending to unreachable destination", () => {
  test("Bun.udpSocket connected to unreachable port does not close", async () => {
    const unreachablePort = await getUnreachablePort();

    const s = await Bun.udpSocket({
      connect: { hostname: "127.0.0.1", port: unreachablePort },
      socket: {
        data() {},
      },
    });

    try {
      expect(() => s.send("hey")).not.toThrow();

      // Wait for kernel to deliver ICMP port-unreachable
      await Bun.sleep(200);

      // Socket must remain open — the ICMP error is non-fatal for UDP
      expect(s.closed).toBe(false);
    } finally {
      if (!s.closed) s.close();
    }
  });

  test("Bun.udpSocket unconnected send to unreachable port does not close", async () => {
    const unreachablePort = await getUnreachablePort();
    const s = await Bun.udpSocket({});

    try {
      s.send("hey", unreachablePort, "127.0.0.1");
      await Bun.sleep(200);

      expect(s.closed).toBe(false);
      // Should still be able to send
      s.send("hey2", unreachablePort, "127.0.0.1");
    } finally {
      if (!s.closed) s.close();
    }
  });

  test("dgram socket stays open after sending to unreachable port", async () => {
    const unreachablePort = await getUnreachablePort();
    const { promise, resolve, reject } = Promise.withResolvers<void>();

    const server = dgram.createSocket("udp4");
    server.once("error", reject);
    server.bind(0, () => {
      let count = 0;
      const sendNext = () => {
        server.send("hey", unreachablePort, "127.0.0.1", error => {
          if (error) {
            server.close();
            reject(error);
            return;
          }
          count++;
          if (count < 3) {
            sendNext();
          } else {
            server.close();
            resolve();
          }
        });
      };
      sendNext();
    });

    // Should complete all 3 sends without the socket closing
    await promise;
  });

  test("dgram error message contains error code, not 'undefined'", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const dgram = require("node:dgram");
        const server = dgram.createSocket("udp4");
        server.bind(0, () => {
          const huge = Buffer.alloc(256 * 1024);
          server.send(huge, 0, huge.length, server.address().port, "127.0.0.1", (err) => {
            if (err) {
              console.log(JSON.stringify({ message: err.message, code: err.code }));
            }
            server.close();
          });
        });
        `,
      ],
      env: bunEnv,
    });

    const stdout = await proc.stdout.text();
    const exitCode = await proc.exited;

    // The error message should contain the error code, never "undefined"
    const result = JSON.parse(stdout.trim());
    expect(result.code).toBe("EMSGSIZE");
    expect(result.message).toContain("EMSGSIZE");
    expect(result.message).not.toContain("undefined");
    expect(exitCode).toBe(0);
  });
});
