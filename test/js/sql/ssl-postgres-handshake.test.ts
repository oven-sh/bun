import { SQL } from "bun";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

// Postgres Wire Protocol Constants
const SSL_REQUEST_CODE = 80877103; // 0x04D2162F
const PROTOCOL_V3_CODE = 196608; // 0x00030000

describe("PostgreSQL SSL Handshake (Mock Server)", () => {
  const HOST = "127.0.0.1";
  let PORT: number;

  let server: import("bun").Server;
  let events: string[] = [];

  // Map to buffer incoming data per connection to handle TCP fragmentation
  const connections = new Map<any, Buffer>();

  // Mock Server Setup
  beforeAll(() => {
    server = Bun.listen({
      hostname: HOST,
      port: 0,
      socket: {
        open(socket) {
          // Initialise buffer for new connection
          connections.set(socket, Buffer.alloc(0));
        },
        close(socket) {
          connections.delete(socket);
        },
        error(socket) {
          connections.delete(socket);
        },
        data(socket, data) {
          // Append new data to the existing buffer for this socket
          let buffer = connections.get(socket) || Buffer.alloc(0);
          buffer = Buffer.concat([buffer, data]);

          // Loop to process all complete messages in the buffer
          while (true) {
            // Need at least 4 bytes to determine message length/type
            // Note: Startup/SSLRequest has length at offset 0.
            // Regular messages have type at 0 and length at 1.
            if (buffer.length < 4) break;

            const firstByte = buffer[0];
            let msgLength = 0;
            let totalNeeded = 0;
            let isStartup = false;

            // Packet Types that start with 0 length (Startup, SSLRequest)
            // Note: Standard Postgres packets start with a Type char (e.g. 'P', 'Q').
            // 0 is not a valid type char, but is the first byte of the length (Int32BE)
            // for Startup/SSLRequest packets (which are < 16MB).
            if (firstByte === 0) {
              isStartup = true;
              msgLength = buffer.readInt32BE(0);
              totalNeeded = msgLength;
            } else {
              // Regular Message: Type (1 byte) + Length (4 bytes) + Body
              // Note: The length field includes the 4 bytes of the length itself.
              if (buffer.length < 5) break;
              msgLength = buffer.readInt32BE(1);
              totalNeeded = 1 + msgLength;
            }

            // If we don't have the full message yet, wait for more data
            if (buffer.length < totalNeeded) break;

            // Extract the complete message frame
            const frame = buffer.subarray(0, totalNeeded);
            buffer = buffer.subarray(totalNeeded);

            // Process the frame
            if (isStartup) {
              if (frame.length >= 8) {
                const code = frame.readInt32BE(4);

                if (code === SSL_REQUEST_CODE) {
                  events.push("SSLRequest");
                  socket.write(new TextEncoder().encode("N"));
                  continue;
                }
                if (code === PROTOCOL_V3_CODE) {
                  events.push("StartupMessage");
                  // 1. AuthenticationOK (R, len 8, status 0)
                  const authOk = new Uint8Array([82, 0, 0, 0, 8, 0, 0, 0, 0]);
                  // 2. ReadyForQuery (Z, len 5, status I)
                  const ready = new Uint8Array([90, 0, 0, 0, 5, 73]);
                  socket.write(authOk);
                  socket.write(ready);
                  continue;
                }
              }
            } else {
              // Regular packets
              const type = frame[0];

              // Handle Extended Query Protocol (Default in Bun)
              // 'P' (80) = Parse. Bun sends Parse/Bind/Describe/Execute/Sync in a pipeline.
              // We detect the start of this pipeline and send a "Success" response chain.
              if (type === 80) {
                events.push("Query");

                // Construct Response Sequence:
                // 1. ParseComplete ('1')
                const parseComplete = new Uint8Array([49, 0, 0, 0, 4]);
                // 2. BindComplete ('2')
                const bindComplete = new Uint8Array([50, 0, 0, 0, 4]);
                // 3. NoData ('n') - Response to Describe (claiming no rows to keep mock simple)
                const noData = new Uint8Array([110, 0, 0, 0, 4]);

                // 4. CommandComplete ('C') - "SELECT 1"
                const tag = new TextEncoder().encode("SELECT 1");
                const len = 4 + tag.length + 1;
                const cmdComplete = new Uint8Array(1 + len);
                cmdComplete[0] = 67; // 'C'
                const view = new DataView(cmdComplete.buffer);
                view.setInt32(1, len, false); // BigEndian
                cmdComplete.set(tag, 5);

                // 5. ReadyForQuery ('Z')
                const ready = new Uint8Array([90, 0, 0, 0, 5, 73]);

                // Write all responses
                socket.write(parseComplete);
                socket.write(bindComplete);
                socket.write(noData);
                socket.write(cmdComplete);
                socket.write(ready);
                continue;
              }

              // Handle Pipeline Messages: Bind(66), Describe(68), Execute(69), Flush(72), Sync(83)
              // The 'P' handler above acts as a simplified mock that responds to the whole pipeline.
              // We silence these subsequent messages so they don't appear as "Unknown".
              if (type === 66 || type === 68 || type === 69 || type === 72 || type === 83) {
                continue;
              }

              // Handle Legacy Simple Query ('Q') - kept for completeness
              if (type === 81) {
                events.push("Query");
                const tag = new TextEncoder().encode("SELECT 1");
                const len = 4 + tag.length + 1;
                const cmdComplete = new Uint8Array(1 + len);
                cmdComplete[0] = 67; // 'C'
                const view = new DataView(cmdComplete.buffer);
                view.setInt32(1, len, false);
                cmdComplete.set(tag, 5);

                const ready = new Uint8Array([90, 0, 0, 0, 5, 73]);
                socket.write(cmdComplete);
                socket.write(ready);
                continue;
              }

              // Terminate ('X') - ignore
              if (type === 88) continue;

              // Log unknown packets
              events.push(`Unknown:${type}`);
            }
          }

          // Update buffer with remaining data
          connections.set(socket, buffer);
        },
      },
    });

    // Capture the port assigned by the OS
    PORT = server.port;
  });

  afterAll(() => {
    server.stop();
  });

  beforeEach(() => {
    events = [];
  });

  // Helper to instantiate SQL and run one query
  async function connect(config: any) {
    let sql: SQL | undefined;
    try {
      sql = new SQL({
        ...config,
        url: `postgres://postgres:postgres@${HOST}:${PORT}/postgres`,
        max: 1,
        idleTimeout: 1,
        connectionTimeout: 1000,
      });

      await sql`SELECT 1`;
      return { success: true, error: null };
    } catch (e: any) {
      return { success: false, error: e };
    } finally {
      if (sql) await sql.close();
    }
  }

  // Tests

  test("Default (No Options) -> Prefer (SSLRequest -> Fallback -> Startup)", async () => {
    const { success, error } = await connect({});
    if (error) console.error(error); // Debug log if it fails
    expect(success).toBe(true);
    expect(events).toEqual(["SSLRequest", "StartupMessage", "Query"]);
  });

  test("SSL: disable -> Only StartupMessage", async () => {
    const { success } = await connect({ ssl: "disable" });
    expect(success).toBe(true);
    expect(events).toEqual(["StartupMessage", "Query"]);
  });

  test("TLS: false -> Only StartupMessage", async () => {
    const { success } = await connect({ tls: false });
    expect(success).toBe(true);
    expect(events).toEqual(["StartupMessage", "Query"]);
  });

  test("SSL: disable, TLS: true -> Only StartupMessage (SSL takes precedence)", async () => {
    const { success } = await connect({ ssl: "disable", tls: true });
    expect(success).toBe(true);
    expect(events).toEqual(["StartupMessage", "Query"]);
  });

  test("SSL: prefer -> SSLRequest -> StartupMessage", async () => {
    const { success } = await connect({ ssl: "prefer" });
    expect(success).toBe(true);
    expect(events).toEqual(["SSLRequest", "StartupMessage", "Query"]);
  });

  test("SSL: require -> Fails on 'N' response", async () => {
    const { success, error } = await connect({ ssl: "require" });
    expect(success).toBe(false);
    expect(events).toEqual(["SSLRequest"]);
    expect(error.message).toContain("The server does not support SSL connections");
  });

  test("TLS: true -> Acts as Prefer (Defaults)", async () => {
    const { success } = await connect({ tls: true });
    expect(success).toBe(true);
    expect(events).toEqual(["SSLRequest", "StartupMessage", "Query"]);
  });

  test("SSL: require, TLS: false -> Fails config validation", async () => {
    const { success, error } = await connect({ ssl: "require", tls: false });
    expect(success).toBe(false);
    expect(events).toEqual([]);
    expect(error.message).toContain("conflicts with currently set ssl mode");
  });

  test("SSL: verify-ca (No CA) -> Fails before handshake", async () => {
    const { success } = await connect({ ssl: "verify-ca" });
    expect(success).toBe(false);
    expect(events).not.toContain("StartupMessage");
  });
});
