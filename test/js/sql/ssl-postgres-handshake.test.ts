import { SQL } from "bun";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

// Postgres Wire Protocol Constants
const SSL_REQUEST_CODE = 80877103; // 0x04D2162F
const PROTOCOL_V3_CODE = 196608;   // 0x00030000

describe("PostgreSQL SSL Handshake (Mock Server)", () => {
  const HOST = "127.0.0.1";
  const PORT = 40000 + Math.floor(Math.random() * 10000);
  
  let server: import("bun").Server;
  let events: string[] = [];

  // Mock Server Setup
  beforeAll(() => {
    server = Bun.listen({
      hostname: HOST,
      port: PORT,
      socket: {
        data(socket, data) {
          const firstByte = data[0];
          
          // Packet Types that start with 0 length (Startup, SSLRequest)
          if (firstByte === 0 && data.length >= 8) {
             const code = data.readInt32BE(4);
             
             if (code === SSL_REQUEST_CODE) {
                events.push("SSLRequest");
                socket.write(new TextEncoder().encode("N"));
                return;
             }
             if (code === PROTOCOL_V3_CODE) {
                events.push("StartupMessage");
                // 1. AuthenticationOK (R, len 8, status 0)
                const authOk = new Uint8Array([82, 0, 0, 0, 8, 0, 0, 0, 0]); 
                // 2. ReadyForQuery (Z, len 5, status I)
                const ready = new Uint8Array([90, 0, 0, 0, 5, 73]); 
                socket.write(authOk);
                socket.write(ready);
                return;
             }
          }
          
          // Handle Extended Query Protocol (Default in Bun)
          // 'P' (80) = Parse. Bun sends Parse/Bind/Describe/Execute/Sync in a pipeline.
          // We detect the start of this pipeline and send a "Success" response chain.
          if (firstByte === 80) { 
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
            return;
          }

          // Handle Legacy Simple Query ('Q') - kept for completeness
          if (firstByte === 81) { 
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
            return;
          }

          // Terminate ('X') - ignore
          if (firstByte === 88) return;

          // Log unknown packets to help debug if something else appears
          events.push(`Unknown:${firstByte}`);
        },
        error() {
          // Ignore connection resets during teardown
        },
      },
    });
  });

  afterAll(() => {
    server.stop();
  });

  beforeEach(() => {
    events = [];
  });

  // Helper to instantiate SQL and run one query
  async function connect(config: any) {
    const sql = new SQL({
      ...config,
      url: `postgres://postgres:postgres@${HOST}:${PORT}/postgres`,
      max: 1, 
      idleTimeout: 1,
      connectionTimeout: 1000, 
    });

    try {
      await sql`SELECT 1`;
      return { success: true, error: null };
    } catch (e: any) {
      return { success: false, error: e };
    } finally {
      await sql.close();
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
    const { success } = await connect({ ssl: 'disable' });
    expect(success).toBe(true);
    expect(events).toEqual(["StartupMessage", "Query"]);
  });

  test("TLS: false -> Only StartupMessage", async () => {
    const { success } = await connect({ tls: false });
    expect(success).toBe(true);
    expect(events).toEqual(["StartupMessage", "Query"]);
  });

  test("SSL: disable, TLS: true -> Only StartupMessage (SSL takes precedence)", async () => {
    const { success } = await connect({ ssl: 'disable', tls: true });
    expect(success).toBe(true);
    expect(events).toEqual(["StartupMessage", "Query"]);
  });

  test("SSL: prefer -> SSLRequest -> StartupMessage", async () => {
    const { success } = await connect({ ssl: 'prefer' });
    expect(success).toBe(true);
    expect(events).toEqual(["SSLRequest", "StartupMessage", "Query"]);
  });

  test("SSL: require -> Fails on 'N' response", async () => {
    const { success, error } = await connect({ ssl: 'require' });
    expect(success).toBe(false);
    expect(events).toEqual(["SSLRequest"]);
    expect(error.message).toContain("The server does not support SSL connections");
  });

  test("TLS: true -> Acts as Prefer (Defaults)", async () => {
    const { success } = await connect({ tls: true });
    expect(success).toBe(true);
    expect(events).toEqual(["SSLRequest", "StartupMessage", "Query"]);
  });

  test("SSL: require, TLS: false -> Fails config validation or handshake", async () => {
    const { success, error } = await connect({ ssl: 'require', tls: false });
    expect(success).toBe(false);
    expect(events).toEqual(["SSLRequest"]);
    expect(error.message).toContain("The server does not support SSL connections");
  });

  test("SSL: verify-ca (No CA) -> Fails before handshake", async () => {
     const { success } = await connect({ ssl: 'verify-ca' });
     expect(success).toBe(false);
     expect(events).not.toContain("StartupMessage");
  });
});