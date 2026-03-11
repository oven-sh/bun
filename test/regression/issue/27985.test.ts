import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import tls from "tls";

const fixturesDir = join(import.meta.dir, "..", "..", "js", "node", "tls", "fixtures");

const ca = readFileSync(join(fixturesDir, "ca1-cert.pem"), "utf8");
const serverKey = readFileSync(join(fixturesDir, "agent1-key.pem"), "utf8");
const serverCert = readFileSync(join(fixturesDir, "agent1-cert.pem"), "utf8");
const validClientKey = readFileSync(join(fixturesDir, "agent1-key.pem"), "utf8");
const validClientCert = readFileSync(join(fixturesDir, "agent1-cert.pem"), "utf8");
const rogueClientKey = readFileSync(join(fixturesDir, "agent3-key.pem"), "utf8");
const rogueClientCert = readFileSync(join(fixturesDir, "agent3-cert.pem"), "utf8");

type TLSResult =
  | { type: "accepted"; status: string }
  | { type: "rejected"; error: string; secureConnected: boolean };

/**
 * Connect to a TLS server and send an HTTP request.
 * Returns "accepted" with the HTTP status if we get a response,
 * or "rejected" if the connection is closed/errored before responding.
 * The secureConnected flag indicates whether the TLS handshake completed.
 */
function connectAndRequest(port: number, clientCert?: { key: string; cert: string }, servername?: string): Promise<TLSResult> {
  const { promise, resolve } = Promise.withResolvers<TLSResult>();
  let resolved = false;
  let data = "";
  let secureConnected = false;

  const done = (result: TLSResult) => {
    if (resolved) return;
    resolved = true;
    socket.destroy();
    resolve(result);
  };

  const socket = tls.connect({ host: "localhost", port, servername, ca, key: clientCert?.key, cert: clientCert?.cert, checkServerIdentity: () => undefined }, () => {
    secureConnected = true;
    socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
  });

  socket.on("data", (chunk: Buffer) => { data += chunk.toString(); });

  socket.on("end", () => {
    const status = data.match(/HTTP\/1\.1 (\d+)/)?.[1];
    done(status ? { type: "accepted", status } : { type: "rejected", error: "closed without response", secureConnected });
  });

  socket.on("error", (err: any) => {
    done({ type: "rejected", error: err.code ?? err.message, secureConnected });
  });

  socket.on("close", () => {
    const status = data.match(/HTTP\/1\.1 (\d+)/)?.[1];
    done(status ? { type: "accepted", status } : { type: "rejected", error: "closed", secureConnected });
  });

  return promise;
}

function createMTLSServer(rejectUnauthorized: boolean) {
  return Bun.serve({
    port: 0,
    tls: { key: serverKey, cert: serverCert, ca, requestCert: true, rejectUnauthorized },
    fetch: () => new Response("OK"),
  });
}

// -- Tests --

describe("GitHub issue #27985: mTLS rejectUnauthorized enforcement", () => {
  describe("rejectUnauthorized: true", () => {
    test("accepts valid client cert signed by trusted CA", async () => {
      await using server = createMTLSServer(true);
      const result = await connectAndRequest(server.port, { key: validClientKey, cert: validClientCert });
      console.log("  >>", JSON.stringify(result));
      expect(result.type).toBe("accepted");
    });

    test("rejects rogue client cert signed by untrusted CA", async () => {
      await using server = createMTLSServer(true);
      const result = await connectAndRequest(server.port, { key: rogueClientKey, cert: rogueClientCert });
      console.log("  >>", JSON.stringify(result));
      expect(result.type).toBe("rejected");
    });

    test("rejects connection with no client cert", async () => {
      await using server = createMTLSServer(true);
      const result = await connectAndRequest(server.port);
      console.log("  >>", JSON.stringify(result));
      expect(result.type).toBe("rejected");
    });

    test("deterministically rejects 30 rogue requests", async () => {
      await using server = createMTLSServer(true);
      for (let i = 0; i < 30; i++) {
        const result = await connectAndRequest(server.port, { key: rogueClientKey, cert: rogueClientCert });
        console.log(`  >> attempt ${i + 1}/30:`, JSON.stringify(result));
        expect(result.type).toBe("rejected");
        }
    });
  });

  describe("tls array with rejectUnauthorized: true", () => {
    test("rejects rogue client cert with tls array config", async () => {
      await using server = Bun.serve({
        port: 0,
        tls: [
          { key: serverKey, cert: serverCert, ca, requestCert: true, rejectUnauthorized: true },
        ],
        fetch: () => new Response("OK"),
      });
      const result = await connectAndRequest(server.port, { key: rogueClientKey, cert: rogueClientCert });
      console.log("  >>", JSON.stringify(result));
      expect(result.type).toBe("rejected");
    });

    test("accepts valid client cert with tls array config", async () => {
      await using server = Bun.serve({
        port: 0,
        tls: [
          { key: serverKey, cert: serverCert, ca, requestCert: true, rejectUnauthorized: true },
        ],
        fetch: () => new Response("OK"),
      });
      const result = await connectAndRequest(server.port, { key: validClientKey, cert: validClientCert });
      console.log("  >>", JSON.stringify(result));
      expect(result.type).toBe("accepted");
    });
  });

  describe("client-side fetch() mTLS unaffected", () => {
    test("fetch() with valid client cert succeeds against mTLS server", async () => {
      await using server = createMTLSServer(true);
      const resp = await fetch(`https://localhost:${server.port}/`, {
        tls: { key: validClientKey, cert: validClientCert, ca, rejectUnauthorized: false },
      });
      expect(resp.status).toBe(200);
      expect(await resp.text()).toBe("OK");
    });

    test("fetch() with rogue client cert is rejected by mTLS server", async () => {
      await using server = createMTLSServer(true);
      try {
        await fetch(`https://localhost:${server.port}/`, {
          tls: { key: rogueClientKey, cert: rogueClientCert, ca, rejectUnauthorized: false },
        });
        expect.unreachable();
      } catch (err: any) {
        // Connection should fail because server rejects the rogue cert
        expect(err.code).toMatch(/CERT|SSL|TLS|ECONNRESET/i);
      }
    });
  });

  describe("rejectUnauthorized: false", () => {
    test("accepts valid client cert", async () => {
      await using server = createMTLSServer(false);
      const result = await connectAndRequest(server.port, { key: validClientKey, cert: validClientCert });
      console.log("  >>", JSON.stringify(result));
      expect(result.type).toBe("accepted");
    });

    test("accepts rogue client cert", async () => {
      await using server = createMTLSServer(false);
      const result = await connectAndRequest(server.port, { key: rogueClientKey, cert: rogueClientCert });
      console.log("  >>", JSON.stringify(result));
      expect(result.type).toBe("accepted");
    });

    test("accepts connection with no client cert", async () => {
      await using server = createMTLSServer(false);
      const result = await connectAndRequest(server.port);
      console.log("  >>", JSON.stringify(result));
      expect(result.type).toBe("accepted");
    });
  });
});
