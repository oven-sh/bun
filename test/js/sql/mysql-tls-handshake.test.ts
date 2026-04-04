import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

/**
 * Tests that the MySQL client properly handles the TLS upgrade during
 * the handshake phase. After upgrading to TLS, the client must not
 * process any remaining data from the pre-upgrade plaintext buffer.
 *
 * This hardens the handshake against scenarios where extra data arrives
 * in the same TCP segment as the server's initial handshake packet.
 */

describe("MySQL TLS handshake hardening", () => {
  test("client must not process trailing data from pre-TLS buffer", async () => {
    // This test creates a mock MySQL server that sends a HandshakeV10 with
    // TLS capability followed by a fake OK packet in the same TCP write
    // (same TCP segment). The client must discard the trailing data after
    // initiating the TLS upgrade, not process it as a valid auth response.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const net = require('net');

function buildHandshakeV10WithTLS() {
  const parts = [];
  parts.push(Buffer.from([0x0a]));
  parts.push(Buffer.from('8.0.0\\0', 'ascii'));
  const connId = Buffer.alloc(4);
  connId.writeUInt32LE(1, 0);
  parts.push(connId);
  parts.push(Buffer.from([0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48]));
  parts.push(Buffer.from([0x00]));
  const capLower = Buffer.alloc(2);
  capLower.writeUInt16LE(0xaa01, 0);
  parts.push(capLower);
  parts.push(Buffer.from([0x2d]));
  const sf = Buffer.alloc(2);
  sf.writeUInt16LE(0x0002, 0);
  parts.push(sf);
  const capUpper = Buffer.alloc(2);
  capUpper.writeUInt16LE(0x010b, 0);
  parts.push(capUpper);
  parts.push(Buffer.from([0x15]));
  parts.push(Buffer.alloc(10));
  parts.push(Buffer.from([0x49,0x4a,0x4b,0x4c,0x4d,0x4e,0x4f,0x50,0x51,0x52,0x53,0x54,0x00]));
  parts.push(Buffer.from('mysql_native_password\\0', 'ascii'));
  const payload = Buffer.concat(parts);
  const header = Buffer.alloc(4);
  header.writeUIntLE(payload.length, 0, 3);
  header[3] = 0;
  return Buffer.concat([header, payload]);
}

function buildFakeOKPacket(seqId) {
  // Minimal OK packet: header(0x00) + affected_rows(0) + last_insert_id(0)
  // + status_flags(AUTOCOMMIT) + warnings(0)
  const payload = Buffer.from([0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]);
  const header = Buffer.alloc(4);
  header.writeUIntLE(payload.length, 0, 3);
  header[3] = seqId;
  return Buffer.concat([header, payload]);
}

const server = net.createServer(socket => {
  // Send handshake + fake OK in a single write (same TCP segment).
  // The fake OK (sequence_id=2) would be the next expected packet after
  // the handshake (seq=0) and client SSLRequest (seq=1).
  const handshake = buildHandshakeV10WithTLS();
  const fakeOK = buildFakeOKPacket(2);
  socket.write(Buffer.concat([handshake, fakeOK]));
});

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  try {
    const sql = new Bun.SQL({
      adapter: 'mysql',
      host: '127.0.0.1',
      port,
      username: 'root',
      password: 'test',
      max: 1,
      tls: true,
      connect_timeout: 2,
    });
    await sql` +
          "`select 1`" +
          `;
    // If we get here, the client incorrectly accepted the fake OK packet
    // from the plaintext buffer after initiating TLS upgrade.
    console.log('FAIL: client accepted connection with trailing plaintext data');
    process.exit(1);
  } catch(e) {
    // The client should reject the connection - the fake OK must NOT be processed.
    // Expected: timeout waiting for TLS handshake, or auth failure.
    console.log('PASS: ' + e.code);
    process.exit(0);
  } finally {
    server.close();
  }
});
`,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("PASS:");
    expect(stdout).not.toContain("FAIL:");
    expect(exitCode).toBe(0);
  }, 15_000);
});
