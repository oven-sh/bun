import { SQL } from "bun";
import { expect, test } from "bun:test";
import net from "net";

test("postgres connection rejects null bytes in username", async () => {
  let serverReceivedData = false;

  const server = net.createServer(socket => {
    serverReceivedData = true;
    socket.destroy();
  });

  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;

  try {
    const sql = new SQL({
      hostname: "127.0.0.1",
      port,
      username: "alice\x00search_path\x00evil_schema,public",
      database: "testdb",
      max: 1,
      idleTimeout: 1,
      connectionTimeout: 2,
    });

    await sql`SELECT 1`;
    expect.unreachable();
  } catch (e: any) {
    expect(e.message).toContain("null bytes");
  }

  server.close();

  // The server should never have received any data because the null byte
  // should be rejected before the connection is established.
  expect(serverReceivedData).toBe(false);
});

test("postgres connection rejects null bytes in database", async () => {
  let serverReceivedData = false;

  const server = net.createServer(socket => {
    serverReceivedData = true;
    socket.destroy();
  });

  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;

  try {
    const sql = new SQL({
      hostname: "127.0.0.1",
      port,
      username: "alice",
      database: "testdb\x00search_path\x00evil_schema,public",
      max: 1,
      idleTimeout: 1,
      connectionTimeout: 2,
    });

    await sql`SELECT 1`;
    expect.unreachable();
  } catch (e: any) {
    expect(e.message).toContain("null bytes");
  }

  server.close();
  expect(serverReceivedData).toBe(false);
});

test("postgres connection rejects null bytes in password", async () => {
  let serverReceivedData = false;

  const server = net.createServer(socket => {
    serverReceivedData = true;
    socket.destroy();
  });

  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;

  try {
    const sql = new SQL({
      hostname: "127.0.0.1",
      port,
      username: "alice",
      password: "pass\x00search_path\x00evil_schema",
      database: "testdb",
      max: 1,
      idleTimeout: 1,
      connectionTimeout: 2,
    });

    await sql`SELECT 1`;
    expect.unreachable();
  } catch (e: any) {
    expect(e.message).toContain("null bytes");
  }

  server.close();
  expect(serverReceivedData).toBe(false);
});

test("postgres connection works with normal parameters (no null bytes)", async () => {
  // Verify that normal connections without null bytes still work.
  // Use a mock server that sends an auth error so we can verify the
  // startup message is sent correctly.
  let receivedData = false;

  const server = net.createServer(socket => {
    socket.once("data", () => {
      receivedData = true;
      const errMsg = Buffer.from("SFATAL\0VFATAL\0C28000\0Mauthentication failed\0\0");
      const len = errMsg.length + 4;
      const header = Buffer.alloc(5);
      header.write("E", 0);
      header.writeInt32BE(len, 1);
      socket.write(Buffer.concat([header, errMsg]));
      socket.destroy();
    });
  });

  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;

  try {
    const sql = new SQL({
      hostname: "127.0.0.1",
      port,
      username: "alice",
      database: "testdb",
      max: 1,
      idleTimeout: 1,
      connectionTimeout: 2,
    });

    await sql`SELECT 1`;
  } catch {
    // Expected - mock server sends auth error
  }

  server.close();

  // Normal parameters should connect fine - the server should receive data
  expect(receivedData).toBe(true);
});
