import { SQL } from "bun";
import { expect, test } from "bun:test";
import net from "net";

// Test for GitHub issue #25749
// Set and Map should throw clear error messages when used in SQL queries

// Helper to create PostgreSQL wire protocol packets
function createPostgresPacket(type: string, data: Buffer): Buffer {
  const len = data.length + 4;
  const header = Buffer.alloc(5);
  header.write(type, 0);
  header.writeInt32BE(len, 1);
  return Buffer.concat([header, data]);
}

// Create Authentication OK packet (type 'R', method 0 = OK)
function createAuthOkPacket(): Buffer {
  const data = Buffer.alloc(4);
  data.writeInt32BE(0, 0); // method = 0 (OK)
  return createPostgresPacket("R", data);
}

// Create ReadyForQuery packet (type 'Z', status 'I' = idle)
function createReadyForQueryPacket(): Buffer {
  return createPostgresPacket("Z", Buffer.from("I"));
}

// Create a minimal mock PostgreSQL server that completes authentication
function createMockPostgresServer(): net.Server {
  return net.createServer(socket => {
    socket.once("data", () => {
      // After receiving startup message, send AuthOK and ReadyForQuery
      socket.write(createAuthOkPacket());
      socket.write(createReadyForQueryPacket());
    });
  });
}

test("Set throws descriptive error instead of 'Unknown object is not a valid PostgreSQL type'", async () => {
  const server = createMockPostgresServer();

  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;

  const sql = new SQL({
    url: `postgres://test@127.0.0.1:${port}/test`,
    max: 1,
    connection_timeout: 5,
  });

  const mySet = new Set(["a", "b", "c"]);

  try {
    await sql`SELECT ${mySet}`;
    expect.unreachable("Should have thrown an error");
  } catch (err: any) {
    // Verify the error message mentions Set and provides guidance
    expect(err.message).toContain("Set is not a valid PostgreSQL type");
    expect(err.message).toContain("Array.from");
    // Make sure it's not the old generic error
    expect(err.message).not.toContain("Unknown object is not a valid PostgreSQL type");
  }

  await sql.close();
  server.close();
});

test("Map throws descriptive error instead of 'Unknown object is not a valid PostgreSQL type'", async () => {
  const server = createMockPostgresServer();

  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;

  const sql = new SQL({
    url: `postgres://test@127.0.0.1:${port}/test`,
    max: 1,
    connection_timeout: 5,
  });

  const myMap = new Map([
    ["key1", "value1"],
    ["key2", "value2"],
  ]);

  try {
    await sql`SELECT ${myMap}`;
    expect.unreachable("Should have thrown an error");
  } catch (err: any) {
    // Verify the error message mentions Map and provides guidance
    expect(err.message).toContain("Map is not a valid PostgreSQL type");
    expect(err.message).toContain("Object.fromEntries");
    // Make sure it's not the old generic error
    expect(err.message).not.toContain("Unknown object is not a valid PostgreSQL type");
  }

  await sql.close();
  server.close();
});

test("WeakSet throws descriptive error", async () => {
  const server = createMockPostgresServer();

  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;

  const sql = new SQL({
    url: `postgres://test@127.0.0.1:${port}/test`,
    max: 1,
    connection_timeout: 5,
  });

  const obj = { key: "value" };
  const myWeakSet = new WeakSet([obj]);

  try {
    await sql`SELECT ${myWeakSet}`;
    expect.unreachable("Should have thrown an error");
  } catch (err: any) {
    // WeakSet uses the same check as Set
    expect(err.message).toContain("Set is not a valid PostgreSQL type");
  }

  await sql.close();
  server.close();
});

test("WeakMap throws descriptive error", async () => {
  const server = createMockPostgresServer();

  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;

  const sql = new SQL({
    url: `postgres://test@127.0.0.1:${port}/test`,
    max: 1,
    connection_timeout: 5,
  });

  const obj = { key: "value" };
  const myWeakMap = new WeakMap([[obj, "value"]]);

  try {
    await sql`SELECT ${myWeakMap}`;
    expect.unreachable("Should have thrown an error");
  } catch (err: any) {
    // WeakMap uses the same check as Map
    expect(err.message).toContain("Map is not a valid PostgreSQL type");
  }

  await sql.close();
  server.close();
});
