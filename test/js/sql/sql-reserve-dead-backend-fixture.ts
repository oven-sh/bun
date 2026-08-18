// Fixture for sql-reserve-dead-backend.test.ts (issue #39562): reserve a
// connection, let the server terminate its backend, then release() and end().
// Prints "released" then "done" and exits 0 on success. A floating rejection
// from release() prints an "unhandledRejection:" line, and a hanging end()
// trips the watchdog (exit 7).
import { SQL } from "bun";

process.on("unhandledRejection", reason => {
  console.log("unhandledRejection: " + String(reason));
});

const url = process.env.DATABASE_URL!;
const sql = new SQL(url, { max: 2 });
const other = new SQL(url, { max: 1 });

const reserved = await sql.reserve();
const [{ pid }] = await reserved`select pg_backend_pid() as pid`;
await other`select pg_terminate_backend(${pid})`;

// wait until the reserved connection observes the server-side close
while (true) {
  try {
    await reserved.connect();
  } catch {
    break;
  }
  await Bun.sleep(10);
}

reserved.release();
reserved.release(); // the second call must also be a silent no-op
console.log("released");

// give a floating rejection from release() a chance to surface
await Bun.sleep(50);

const watchdog = setTimeout(() => {
  console.log("end() timed out");
  process.exit(7);
}, 5_000);
await sql.end();
clearTimeout(watchdog);
await other.end();
console.log("done");
