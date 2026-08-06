// Fixture for postgres-failed-connection-resurrection.test.ts. Run as a
// subprocess so that an AddressSanitizer abort is observable as a non-zero
// exit code from the test.
//
// Mock backend that answers the StartupMessage with ONE write carrying TWO
// backend messages: an Authentication request with an unrecognized type (99),
// immediately followed by ReadyForQuery. The unrecognized type fails the
// connection mid-read; the trailing ReadyForQuery from the same read must not
// be dispatched against the now-dead connection.
import { SQL } from "bun";
import { listeningServer, pgInt32, pgRaw, pgReadyForQuery } from "./wire-frames";

const { port, server } = await listeningServer(socket => {
  socket.once("data", () => {
    socket.write(Buffer.concat([pgRaw("R", pgInt32(99)), pgReadyForQuery()]));
  });
  socket.on("error", () => {});
});

const sql = new SQL({
  url: `postgres://postgres@127.0.0.1:${port}/postgres`,
  max: 1,
  idleTimeout: 1,
  connectionTimeout: 5,
});

try {
  await sql`select 1`;
  console.log("RESOLVED");
} catch (err: any) {
  console.log(err?.code ?? String(err));
}

// Before the fix, the ReadyForQuery flipped the failed connection back to
// Connected and re-armed its 1s idle timer on a socket uSockets had already
// scheduled to free; the timer callback then dereferenced the freed socket.
// Keep the process alive past that window. There is no event to await: a
// correct build simply never fires that timer again.
await Bun.sleep(1600);
console.log("SURVIVED");

await sql.close({ timeout: 0 });
await new Promise<void>(resolve => server.close(() => resolve()));
