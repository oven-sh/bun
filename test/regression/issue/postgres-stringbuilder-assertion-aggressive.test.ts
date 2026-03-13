import { SQL } from "bun";
import { expect, test } from "bun:test";
import net from "net";

test("PostgreSQL StringBuilder assertion - aggressive empty error test", async () => {
  const server = net.createServer(socket => {
    // Immediately send an error response with completely empty fields
    // This is more likely to trigger the assertion
    socket.write(createPostgresPacket("E", Buffer.from("\0"))); // Terminator only
    socket.destroy();
  });

  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;

  const sql = new SQL({
    url: `postgres://test@127.0.0.1:${port}/test`,
    max: 10,
    connection_timeout: 0.1,
  });

  const promises = [];
  for (let i = 0; i < 20; i++) {
    promises.push(
      sql`SELECT ${i}`.catch(err => {
        // We expect errors, just checking for crashes
        return null;
      }),
    );
  }

  await Promise.all(promises);
  await sql.close();
  server.close();

  // If we get here without crashing, the test passes
  expect(true).toBe(true);
});

function createPostgresPacket(type: string, data: Buffer): Buffer {
  const len = data.length + 4;
  const header = Buffer.alloc(5);
  header.write(type, 0);
  header.writeInt32BE(len, 1);
  return Buffer.concat([header, data]);
}
