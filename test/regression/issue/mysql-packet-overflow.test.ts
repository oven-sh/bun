import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir, normalizeBunSnapshot } from "harness";
import net from "net";

test("MySQL client handles malformed packets with max length without integer overflow", async () => {
  // Create a fake MySQL server that sends malformed packets
  const server = net.createServer();
  
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const port = (server.address() as net.AddressInfo).port;

  let connectionClosed = false;
  server.on("connection", (socket) => {
    // Send initial MySQL handshake packet
    const handshake = Buffer.alloc(78);
    handshake[0] = 74; // packet length low
    handshake[1] = 0;  // packet length mid
    handshake[2] = 0;  // packet length high
    handshake[3] = 0;  // sequence id
    handshake[4] = 10; // protocol version
    handshake.write("5.7.0\x00", 5); // server version
    handshake[13] = 0x01; // connection id
    // Fill some auth data
    for (let i = 14; i < 34; i++) {
      handshake[i] = i;
    }
    handshake[34] = 0x00; // filler
    handshake[35] = 0xff; // capability flags
    handshake[36] = 0xff;
    handshake[37] = 33; // character set
    handshake[38] = 0x00; // status flags
    handshake[39] = 0x00;
    
    socket.write(handshake);

    // After handshake, send a malformed packet with max length
    setTimeout(() => {
      if (!connectionClosed) {
        const malformed = Buffer.alloc(4);
        malformed[0] = 0xFF; // packet length low
        malformed[1] = 0xFF; // packet length mid
        malformed[2] = 0xFF; // packet length high (max 24-bit value = 16777215)
        malformed[3] = 1;    // sequence id
        
        socket.write(malformed);
      }
    }, 50);

    socket.on("close", () => {
      connectionClosed = true;
    });

    socket.on("error", () => {
      // Expected if client closes connection
    });
  });

  // Test script that attempts to connect using Bun's SQL
  const testScript = `
    import { SQL } from "bun";
    
    const sql = new SQL({
      url: "mysql://root:test@127.0.0.1:${port}/test",
      max: 1,
      connection_timeout: 1000,
    });
    
    try {
      // Try to execute a query - this should fail due to malformed packet
      await sql\`SELECT 1\`;
      console.log("Query unexpectedly succeeded");
      process.exit(1);
    } catch (err) {
      // We expect an error due to the malformed packet
      console.log("Expected error:", err.code || err.message || "Connection failed");
      process.exit(0);
    }
  `;

  using dir = tempDir("mysql-overflow", {});
  await Bun.write(dir + "/test.js", testScript);
  
  // Run with the debug build
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(), 
    proc.exited,
  ]);

  server.close();

  // The process should NOT panic with integer overflow
  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("integer overflow");
  
  // It should handle the error gracefully
  expect(exitCode).toBe(0);
  expect(stdout).toContain("Expected error:");
}, 10000);