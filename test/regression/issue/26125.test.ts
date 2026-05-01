import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import type { AddressInfo } from "node:net";
import { join } from "path";
import tls from "tls";

// Load certificates from existing fixtures
const fixturesDir = join(import.meta.dir, "..", "..", "js", "node", "tls", "fixtures");

// CA certs
const ca1 = readFileSync(join(fixturesDir, "ca1-cert.pem"), "utf8");
const ca2 = readFileSync(join(fixturesDir, "ca2-cert.pem"), "utf8");

// Server cert (agent1, signed by ca1)
const serverKey = readFileSync(join(fixturesDir, "agent1-key.pem"), "utf8");
const serverCert = readFileSync(join(fixturesDir, "agent1-cert.pem"), "utf8");

// Client 1: agent1 (CN=agent1, signed by ca1)
const client1 = {
  name: "agent1",
  key: readFileSync(join(fixturesDir, "agent1-key.pem"), "utf8"),
  cert: readFileSync(join(fixturesDir, "agent1-cert.pem"), "utf8"),
};

// Client 2: agent3 (CN=agent3, signed by ca2)
const client2 = {
  name: "agent3",
  key: readFileSync(join(fixturesDir, "agent3-key.pem"), "utf8"),
  cert: readFileSync(join(fixturesDir, "agent3-cert.pem"), "utf8"),
};

// Combined CA to accept both client certs
const combinedCA = ca1 + "\n" + ca2;

describe("GitHub issue #26125: mTLS client certificate switching", () => {
  test("fetch() uses correct client certificate for each request when switching between certificates", async () => {
    const clientCNs: string[] = [];

    // Create an mTLS server that records the client certificate CN
    const server = tls.createServer(
      {
        key: serverKey,
        cert: serverCert,
        ca: combinedCA,
        requestCert: true,
        rejectUnauthorized: true,
      },
      socket => {
        const peerCert = socket.getPeerCertificate();
        const cn = peerCert?.subject?.CN || "unknown";
        clientCNs.push(cn);

        // Send HTTP response
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK");
        socket.end();
      },
    );

    await new Promise<void>((resolve, reject) => {
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const port = (server.address() as AddressInfo).port;
    const url = `https://127.0.0.1:${port}/`;

    // Custom checkServerIdentity since cert is for agent1, not 127.0.0.1
    const checkServerIdentity = () => undefined;

    try {
      // Test sequence: alternate between client certificates
      // If the bug exists, connection pooling will reuse the first certificate's connection

      // Request 1: client1 (agent1)
      const res1 = await fetch(url, {
        tls: {
          ca: ca1,
          key: client1.key,
          cert: client1.cert,
          checkServerIdentity,
        },
      });
      expect(res1.status).toBe(200);
      await res1.text();

      // Request 2: client2 (agent3) - should use agent3's certificate
      const res2 = await fetch(url, {
        tls: {
          ca: ca1,
          key: client2.key,
          cert: client2.cert,
          checkServerIdentity,
        },
      });
      expect(res2.status).toBe(200);
      await res2.text();

      // Request 3: client1 (agent1) again
      const res3 = await fetch(url, {
        tls: {
          ca: ca1,
          key: client1.key,
          cert: client1.cert,
          checkServerIdentity,
        },
      });
      expect(res3.status).toBe(200);
      await res3.text();

      // Request 4: client2 (agent3) again
      const res4 = await fetch(url, {
        tls: {
          ca: ca1,
          key: client2.key,
          cert: client2.cert,
          checkServerIdentity,
        },
      });
      expect(res4.status).toBe(200);
      await res4.text();

      // Verify the correct certificates were used for each request
      expect(clientCNs).toEqual(["agent1", "agent3", "agent1", "agent3"]);
    } finally {
      server.close();
    }
  });
});
