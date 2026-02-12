import { SQL } from "bun";
import { expect, test } from "bun:test";
import net from "net";

/**
 * Test for SCRAM-SHA-256 server nonce prefix verification.
 *
 * Per RFC 5802 Section 5.1, the client MUST verify that the server's
 * combined nonce starts with the client's original nonce. Without this
 * check, a MITM attacker can substitute their own nonce and impersonate
 * the server.
 */

function createPostgresPacket(type: string, data: Buffer): Buffer {
  const len = data.length + 4;
  const header = Buffer.alloc(5);
  header.write(type, 0);
  header.writeInt32BE(len, 1);
  return Buffer.concat([header, data]);
}

function createAuthPacket(authType: number, extraData?: Buffer): Buffer {
  const authTypeBuf = Buffer.alloc(4);
  authTypeBuf.writeInt32BE(authType, 0);
  const payload = extraData ? Buffer.concat([authTypeBuf, extraData]) : authTypeBuf;
  // 'R' = Authentication message type
  return createPostgresPacket("R", payload);
}

test("SCRAM-SHA-256 rejects server nonce that doesn't start with client nonce", async () => {
  let clientNonce: string | null = null;
  let connectionError: Error | null = null;
  let serverSawSASLResponse = false;

  const server = net.createServer(socket => {
    let buffer = Buffer.alloc(0);

    socket.on("data", data => {
      buffer = Buffer.concat([buffer, data]);

      // First message from client is the StartupMessage (no type byte)
      // It starts with 4-byte length + 4-byte protocol version (196608 = 0x00030000)
      if (clientNonce === null && buffer.length >= 8) {
        const msgLen = buffer.readInt32BE(0);
        if (buffer.length >= msgLen) {
          // We got the full startup message, send AuthenticationSASL (type 10)
          // with SCRAM-SHA-256 mechanism
          const mechanism = Buffer.from("SCRAM-SHA-256\0\0");
          const saslAuth = createAuthPacket(10, mechanism);
          socket.write(saslAuth);
          buffer = buffer.subarray(msgLen);
        }
      }

      // Look for SASLInitialResponse (message type 'p')
      if (clientNonce === null && buffer.length > 0 && buffer[0] === 0x70) {
        const msgLen = buffer.readInt32BE(1);
        if (buffer.length >= msgLen + 1) {
          // Parse the SASLInitialResponse to extract client nonce
          // Format: 'p' + 4-byte length + mechanism\0 + 4-byte response length + response data
          const fullMsg = buffer.subarray(0, msgLen + 1);
          // Find the null-terminated mechanism name
          let offset = 5; // skip 'p' + 4-byte length
          while (offset < fullMsg.length && fullMsg[offset] !== 0) offset++;
          offset++; // skip null terminator
          // Read the 4-byte response data length
          const responseLen = fullMsg.readInt32BE(offset);
          offset += 4;
          // The response data contains something like "n,,n=*,r=<client_nonce>"
          const responseData = fullMsg.subarray(offset, offset + responseLen).toString();

          const nonceMatch = responseData.match(/r=([A-Za-z0-9+/=]+)/);
          if (nonceMatch) {
            clientNonce = nonceMatch[1];

            // Send SASLContinue (auth type 11) with a FABRICATED nonce
            // that does NOT start with the client nonce.
            // This simulates a MITM attack.
            const fakeNonce = "AAAAAAAAAAAAAAAAAAAAAA==attackerNonce";
            const salt = Buffer.from("serversalt1234567890").toString("base64");
            const iterations = "4096";
            const serverFirstMsg = `r=${fakeNonce},s=${salt},i=${iterations}`;

            const saslContinue = createAuthPacket(11, Buffer.from(serverFirstMsg));
            socket.write(saslContinue);
          }

          buffer = buffer.subarray(msgLen + 1);
        }
      }

      // Check if we receive a SASLResponse (another 'p' message after the initial one)
      if (clientNonce !== null && buffer.length > 0 && buffer[0] === 0x70) {
        // The client sent a SASLResponse, meaning it accepted the fake nonce!
        serverSawSASLResponse = true;
        // Send an error to close the connection
        const errorMsg = Buffer.from("SFATAL\0VFATAL\0C28P01\0Mauthentication failed\0\0");
        socket.write(createPostgresPacket("E", errorMsg));
        socket.end();
      }
    });

    socket.on("error", () => {
      // Ignore socket errors
    });
  });

  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;

  try {
    const sql = new SQL({
      url: `postgres://testuser:testpass@127.0.0.1:${port}/testdb`,
      max: 1,
      idle_timeout: 1,
      connect_timeout: 2,
    });

    // Try to execute a query - this should fail during authentication
    await sql`SELECT 1`.catch((err: Error) => {
      connectionError = err;
    });

    await sql.close();
  } catch (err: any) {
    connectionError = err;
  }

  server.close();

  // The client MUST reject the fabricated nonce.
  // If serverSawSASLResponse is true, the client accepted the fake nonce (vulnerability exists).
  // After the fix, the client should reject it before sending SASLResponse.
  expect(serverSawSASLResponse).toBe(false);

  // The client should have errored out
  expect(connectionError).not.toBeNull();
});
