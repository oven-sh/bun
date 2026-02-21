import { SQL } from "bun";
import { expect, test } from "bun:test";
import net from "net";

function createPostgresPacket(type: string, data: Buffer): Buffer {
  const len = data.length + 4;
  const header = Buffer.alloc(5);
  header.write(type, 0);
  header.writeInt32BE(len, 1);
  return Buffer.concat([header, data]);
}

function createAuthSASL(): Buffer {
  // Authentication message subtype 10 (SASL) with mechanism "SCRAM-SHA-256"
  const mechanism = "SCRAM-SHA-256";
  const subtype = Buffer.alloc(4);
  subtype.writeInt32BE(10, 0);
  const mechanismBuf = Buffer.from(mechanism + "\0\0", "ascii");
  return createPostgresPacket("R", Buffer.concat([subtype, mechanismBuf]));
}

function createAuthSASLContinue(data: string): Buffer {
  // Authentication message subtype 11 (SASLContinue) with challenge data
  const subtype = Buffer.alloc(4);
  subtype.writeInt32BE(11, 0);
  return createPostgresPacket("R", Buffer.concat([subtype, Buffer.from(data, "ascii")]));
}

function parseStartupMessage(buf: Buffer): Record<string, string> {
  // Startup message: [4 bytes length][4 bytes protocol version][key\0value\0...]\0
  const params: Record<string, string> = {};
  let offset = 8; // skip length + protocol version
  while (offset < buf.length) {
    const keyEnd = buf.indexOf(0, offset);
    if (keyEnd <= offset) break;
    const key = buf.subarray(offset, keyEnd).toString("ascii");
    offset = keyEnd + 1;
    const valEnd = buf.indexOf(0, offset);
    if (valEnd < offset) break;
    const val = buf.subarray(offset, valEnd).toString("ascii");
    offset = valEnd + 1;
    params[key] = val;
  }
  return params;
}

function parseSASLInitialResponse(buf: Buffer): { mechanism: string; data: string } | null {
  // Message type 'p', then [4 bytes length][mechanism\0][4 bytes data length][data]
  if (buf[0] !== 0x70) return null;
  const len = buf.readInt32BE(1);
  let offset = 5;
  const mechEnd = buf.indexOf(0, offset);
  const mechanism = buf.subarray(offset, mechEnd).toString("ascii");
  offset = mechEnd + 1;
  const dataLen = buf.readInt32BE(offset);
  offset += 4;
  const data = buf.subarray(offset, offset + dataLen).toString("ascii");
  return { mechanism, data };
}

function extractClientNonce(saslData: string): string | null {
  // SASL initial data: "n,,n=*,r={nonce}"
  const match = saslData.match(/r=([A-Za-z0-9+/=]+)$/);
  return match ? match[1] : null;
}

test("SCRAM-SHA-256 should reject server nonce that doesn't start with client nonce (MITM protection)", async () => {
  let clientNonce: string | null = null;
  let clientSentProof = false;

  const server = net.createServer(socket => {
    let phase = 0;
    let buffer = Buffer.alloc(0);

    socket.on("data", data => {
      buffer = Buffer.concat([buffer, data]);

      if (phase === 0) {
        // Phase 0: Receive startup message, send AuthenticationSASL
        // The startup message has no type byte, just length + protocol version + params
        if (buffer.length < 4) return;
        const msgLen = buffer.readInt32BE(0);
        if (buffer.length < msgLen) return;

        phase = 1;
        buffer = Buffer.alloc(0);

        // Send AuthenticationSASL requesting SCRAM-SHA-256
        socket.write(createAuthSASL());
      } else if (phase === 1) {
        // Phase 1: Receive SASLInitialResponse, send SASLContinue with FORGED nonce
        if (buffer.length < 5) return;
        const msgLen = buffer.readInt32BE(1);
        if (buffer.length < msgLen + 1) return;

        const saslInit = parseSASLInitialResponse(buffer);
        if (saslInit) {
          clientNonce = extractClientNonce(saslInit.data);
        }

        phase = 2;
        buffer = Buffer.alloc(0);

        // ATTACK: Send SASLContinue with a nonce that does NOT start with client nonce
        // A legitimate server would send: r={clientNonce}{serverNonce}
        // We send a completely different nonce to simulate MITM
        const forgedNonce = "AAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // Completely forged, not prefixed with client nonce
        const salt = Buffer.from("serversalt1234567890").toString("base64");
        const iterationCount = 1; // Low iteration count for fast brute-forcing

        const challenge = `r=${forgedNonce},s=${salt},i=${iterationCount}`;
        socket.write(createAuthSASLContinue(challenge));
      } else if (phase === 2) {
        // Phase 2: If we receive a SASLResponse, the client didn't validate the nonce
        if (buffer.length > 0 && buffer[0] === 0x70) {
          clientSentProof = true;
        }
        socket.destroy();
      }
    });

    socket.on("error", () => {
      // Expected - client should disconnect
    });
  });

  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;

  try {
    const sql = new SQL({
      url: `postgres://testuser:testpassword@127.0.0.1:${port}/testdb`,
      max: 1,
      idle_timeout: 1,
      connection_timeout: 2,
    });

    // Try to execute a query, which should fail during authentication
    try {
      await sql`SELECT 1`;
    } catch {
      // Expected to fail - either timeout or authentication error
    }

    await sql.close();
  } catch {
    // Connection failure expected
  }

  server.close();

  // The critical assertion: the client should NOT have sent a proof
  // when the server nonce doesn't start with the client nonce.
  // This is required by RFC 5802 Section 5.
  expect(clientNonce).not.toBeNull();
  expect(clientSentProof).toBe(false);
});

test("SCRAM-SHA-256 should accept server nonce that properly starts with client nonce", async () => {
  let clientNonce: string | null = null;
  let clientSentProof = false;

  const server = net.createServer(socket => {
    let phase = 0;
    let buffer = Buffer.alloc(0);

    socket.on("data", data => {
      buffer = Buffer.concat([buffer, data]);

      if (phase === 0) {
        if (buffer.length < 4) return;
        const msgLen = buffer.readInt32BE(0);
        if (buffer.length < msgLen) return;

        phase = 1;
        buffer = Buffer.alloc(0);
        socket.write(createAuthSASL());
      } else if (phase === 1) {
        if (buffer.length < 5) return;
        const msgLen = buffer.readInt32BE(1);
        if (buffer.length < msgLen + 1) return;

        const saslInit = parseSASLInitialResponse(buffer);
        if (saslInit) {
          clientNonce = extractClientNonce(saslInit.data);
        }

        phase = 2;
        buffer = Buffer.alloc(0);

        // LEGITIMATE: Send SASLContinue with nonce properly prefixed with client nonce
        const serverNonceSuffix = "ServerNonceSuffix123456";
        const combinedNonce = `${clientNonce}${serverNonceSuffix}`;
        const salt = Buffer.from("serversalt1234567890").toString("base64");
        const iterationCount = 4096;

        const challenge = `r=${combinedNonce},s=${salt},i=${iterationCount}`;
        socket.write(createAuthSASLContinue(challenge));
      } else if (phase === 2) {
        if (buffer.length > 0 && buffer[0] === 0x70) {
          clientSentProof = true;
        }
        // After receiving proof, just close (we're not verifying the full handshake)
        socket.destroy();
      }
    });

    socket.on("error", () => {
      // Expected
    });
  });

  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;

  try {
    const sql = new SQL({
      url: `postgres://testuser:testpassword@127.0.0.1:${port}/testdb`,
      max: 1,
      idle_timeout: 1,
      connection_timeout: 2,
    });

    try {
      await sql`SELECT 1`;
    } catch {
      // Will fail eventually because we're not completing the handshake
    }

    await sql.close();
  } catch {
    // Connection failure expected
  }

  server.close();

  // The client SHOULD send a proof when the nonce is properly prefixed
  expect(clientNonce).not.toBeNull();
  expect(clientSentProof).toBe(true);
});
