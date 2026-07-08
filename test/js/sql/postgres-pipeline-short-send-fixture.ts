// Fixture for postgres-pipeline-short-send.test.ts.
//
// Connects to the mock backend the test process is running and fires batches of
// SELECT ${tag} queries on a short tick so later batches arrive while earlier
// ones are still draining. socketFaultInjection clamps every send() to 17 bytes
// (what the kernel does on its own under socket-buffer pressure), which makes
// some queries in each batch land in the queue as Pending. Before the fix, a
// later do_run() could observe can_pipeline() == true after backpressure
// cleared and serialize its Bind ahead of those Pending entries; the server's
// response was then matched to current() (queue head) and delivered to the
// wrong query. That is a data-integrity failure, not a catchable error.
//
// The fixture asserts each promise resolves with its own tag and prints "OK".
// It runs several independent rounds because the ordering window is
// timer-shaped and not every round hits it.

import { SQL } from "bun";
import { socketFaultInjection as fault } from "bun:internal-for-testing";

const port = Number(process.env.MOCK_PG_PORT);
if (!Number.isInteger(port)) throw new Error("MOCK_PG_PORT not set");

// Clamp every bsd_send() to 17 bytes for the rest of this process. The mock
// backend lives in the parent process and is unaffected.
fault.set({ syscall: "send", action: "short", bytes: 17, repeat: -1 });

const batchSize = 3;
const iterations = 400;
const iterMs = 8;
const rounds = 3;

for (let round = 0; round < rounds; round++) {
  const sql = new SQL({
    url: `postgres://postgres@127.0.0.1:${port}/postgres`,
    max: 2,
    prepare: true,
    idleTimeout: 30,
    connectionTimeout: 30,
  });

  const mismatches: string[] = [];
  const errors: string[] = [];
  const inflight: Promise<void>[] = [];

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < batchSize; i++) {
      const tag = `r${round}b${iter}x${i}`;
      const p = sql`SELECT ${tag}::text AS v`.then(
        r => {
          const got = r?.[0]?.v;
          if (got !== tag) mismatches.push(`want=${tag} got=${got}`);
        },
        e => void errors.push(`${tag}: ${e?.code ?? e?.message ?? e}`),
      );
      inflight.push(p);
    }
    await new Promise(resolve => setTimeout(resolve, iterMs));
  }

  await Promise.allSettled(inflight);
  await sql.close({ timeout: 0 });

  if (mismatches.length > 0) {
    console.error(`round ${round}: ${mismatches.length} cross-delivered: ${mismatches.slice(0, 5).join(", ")}`);
    process.exit(1);
  }
  if (errors.length > 0) {
    console.error(`round ${round}: ${errors.length} rejected: ${errors.slice(0, 5).join(", ")}`);
    process.exit(1);
  }
}

fault.clear();
console.log("OK");
