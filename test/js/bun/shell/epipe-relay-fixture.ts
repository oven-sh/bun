// Spawned by epipe.test.ts. The test closes the read end of this process's
// stdout, then this process runs one shell command whose output the shell has
// to relay to that stdout. The relay fails (EPIPE), and the command has to
// finish anyway. The command's exit code is reported as the last stderr line.
//
// The command runs this same file in "produce" mode as an external command: a
// child that writes to its stdout for as long as that works and exits 0 once a
// write fails, which is what a real shell's SIGPIPE does to such a child. The
// producer records the failed write in the file named by PRODUCER_REPORT (its
// stderr is not relayed in every mode); the report ends up in the JSON line.
import { $ } from "bun";
import { existsSync, readFileSync, writeFileSync, writeSync } from "node:fs";

const mode = process.argv[2];

if (mode === "produce") {
  const chunk = Buffer.alloc(64, "y\n");
  while (true) {
    try {
      writeSync(1, chunk);
    } catch (e: any) {
      // EPIPE, or ECONNRESET when the shell closed its end of the socket pair
      // while a chunk it had not read yet was still queued in it.
      const report = `stdout write failed: ${e.code}`;
      console.error(`producer: ${report}`);
      writeFileSync(process.env.PRODUCER_REPORT!, report);
      process.exit(0);
    }
    Bun.sleepSync(1);
  }
}

if (mode === "produce-once") {
  writeSync(1, "y\n");
  process.exit(0);
}

const reportPath = process.argv[3];
process.env.PRODUCER_REPORT = reportPath;

// Wait until nothing reads our stdout anymore, so the relay really fails.
// Our stdout is a socket pair too (Bun.spawn), so the failure is EPIPE, or
// ECONNRESET when the test closed its end while a line was still unread.
while (true) {
  try {
    writeSync(1, "still has a reader\n");
  } catch (e: any) {
    if (e.code === "EPIPE" || e.code === "ECONNRESET") break;
    if (e.code !== "EAGAIN") throw e;
  }
  await Bun.sleep(1);
}

const producer = [process.execPath, import.meta.path, "produce"];
let result;
switch (mode) {
  // The relay fails asynchronously (the shell's writer learns about EPIPE from
  // its poll) while the child keeps the pipe open. stderr is still relayed, so
  // the command finishes once the child notices its stdout is gone and exits.
  case "relay":
    result = await $`${producer}`.nothrow();
    break;
  // Same failure, but stdout is the only piped stream. The command still waits
  // for the child to notice and exit instead of killing it.
  case "relay-only-stdout":
    result = await $`${producer} 2> /dev/null`.nothrow();
    break;
  // The child's stderr shares the failed stdout pipe.
  case "relay-stderr-to-stdout":
    result = await $`${producer} 2>&1`.nothrow();
    break;
  // `echo` already broke the shell's writer, so the child's first chunk is
  // rejected synchronously, from inside the read of that chunk.
  case "dead-writer":
    result = await $`echo hello; ${producer}`.nothrow();
    break;
  case "dead-writer-only-stdout":
    result = await $`echo hello; ${producer} 2> /dev/null`.nothrow();
    break;
  // A child that exits 0 by itself: the failed relay still fails the command.
  case "exits-by-itself":
    result = await $`${[process.execPath, import.meta.path, "produce-once"]}`.nothrow();
    break;
  default:
    throw new Error(`unknown mode ${mode}`);
}
const producerReport = existsSync(reportPath) ? readFileSync(reportPath, "utf8") : null;
console.error(JSON.stringify({ settled: true, exitCode: result.exitCode, producer: producerReport }));
