import { RedisClient } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, dockerExe } from "harness";
import * as net from "node:net";
import * as dockerCompose from "../../docker/index.ts";

let REDIS_HOST: string;
let REDIS_PORT: number;

// Synchronous Docker availability check (same pattern as valkey test-utils)
const dockerCLI = dockerExe() as string;
const dockerAvailable =
  !!dockerCLI &&
  (() => {
    try {
      const info = Bun.spawnSync({
        cmd: [dockerCLI, "info"],
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
        timeout: 5_000,
      });
      return info.exitCode === 0 && !info.signalCode;
    } catch {
      return false;
    }
  })();

if (dockerAvailable) {
  const redisInfo = await dockerCompose.ensure("redis_unified");
  REDIS_HOST = redisInfo.host;
  REDIS_PORT = redisInfo.ports[6379];
}

/**
 * A minimal TCP proxy that allows us to forcibly kill the connection between
 * the RedisClient and the real Redis server, simulating a network blip.
 */
class TcpProxy {
  private server: net.Server | null = null;
  private connections: Set<{ client: net.Socket; upstream: net.Socket }> = new Set();
  port: number = 0;
  private targetHost: string;
  private targetPort: number;

  constructor(targetHost: string, targetPort: number) {
    this.targetHost = targetHost;
    this.targetPort = targetPort;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer(clientSocket => {
        const upstream = net.createConnection({
          host: this.targetHost,
          port: this.targetPort,
        });

        const pair = { client: clientSocket, upstream };
        this.connections.add(pair);

        upstream.on("connect", () => {
          clientSocket.pipe(upstream);
          upstream.pipe(clientSocket);
        });

        const cleanup = () => {
          this.connections.delete(pair);
          clientSocket.destroy();
          upstream.destroy();
        };

        upstream.on("error", cleanup);
        upstream.on("close", cleanup);
        clientSocket.on("error", cleanup);
        clientSocket.on("close", cleanup);
      });

      this.server.on("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.port = (this.server!.address() as net.AddressInfo).port;
        resolve();
      });
    });
  }

  /** Kill all active connections to simulate a network drop */
  disconnectAll(): void {
    for (const pair of this.connections) {
      pair.client.destroy();
      pair.upstream.destroy();
    }
    this.connections.clear();
  }

  stop(): void {
    this.disconnectAll();
    this.server?.close();
    this.server = null;
  }
}

describe.skipIf(!dockerAvailable)("RedisClient reconnect", () => {
  test("in-flight commands are rejected on auto-reconnect, not mismatched", async () => {
    const proxy = new TcpProxy(REDIS_HOST, REDIS_PORT);
    await proxy.start();

    const redis = new RedisClient(`redis://127.0.0.1:${proxy.port}`, {
      enableAutoReconnect: true,
      enableAutoPipelining: true,
    });

    try {
      await redis.connect();

      // Verify connection works
      await redis.set("test:27861", "hello");
      expect(await redis.get("test:27861")).toBe("hello");

      // Fire off several pipelined commands that will be in-flight when we kill the
      // connection. These should all reject (not silently resolve with wrong data).
      const promises: Promise<any>[] = [];
      for (let i = 0; i < 10; i++) {
        promises.push(redis.set(`test:27861:${i}`, `value-${i}`));
        promises.push(redis.get(`test:27861:${i}`));
      }

      // Kill the proxy connection immediately — the commands above are pipelined and
      // likely still in-flight.
      proxy.disconnectAll();

      // All in-flight commands should reject with a connection error
      const results = await Promise.allSettled(promises);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      // At least some of the in-flight commands should have been rejected.
      // (Some may have completed before the disconnect.)
      expect(rejected.length).toBeGreaterThan(0);

      // Verify rejections are from our reconnect path, not unrelated errors
      for (const r of rejected) {
        expect(String(r.reason)).toContain("Connection lost; reconnecting");
      }

      // Wait for auto-reconnect to complete (up to 5s)
      let reconnected = false;
      for (let i = 0; i < 50; i++) {
        try {
          const pong = await redis.send("PING", []);
          if (pong === "PONG") {
            reconnected = true;
            break;
          }
        } catch {
          await Bun.sleep(100);
        }
      }
      expect(reconnected).toBe(true);

      // After reconnection, commands should work correctly — no response mismatches.
      for (let i = 0; i < 10; i++) {
        await redis.set(`test:27861:post:${i}`, `post-value-${i}`);
      }
      for (let i = 0; i < 10; i++) {
        const val = await redis.get(`test:27861:post:${i}`);
        expect(val).toBe(`post-value-${i}`);
      }
    } finally {
      redis.close();
      proxy.stop();
    }
  }, 30_000);
});
