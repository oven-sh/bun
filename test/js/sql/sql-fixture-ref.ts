// This test passes by printing
// 1
// 2
// and exiting with code 0.
//
// Due to pipelining and the way the network stuff works, sometimes the second
// function can finish before the first function. The main purpose of this test
// is that both first() and yo():
//   1. Keep the event loop alive
//   2. Don't get GC'd too early.
//
// Therefore, we must not keep any references to the promises returned by
// first() or yo(). We must not top-level await the results.
import { sql } from "bun";
process.exitCode = 1;

let values = [];

async function first() {
  const result = await sql`select 1 as x`;
  values.push(result[0].x);
  maybeDone();
}

async function yo() {
  const result2 = await sql`select 2 as x`;
  values.push(result2[0].x);
  maybeDone();
}

first();
Bun.gc(true);
yo();
Bun.gc(true);

function maybeDone() {
  if (values.length === 2) {
    // Determinism.
    values.sort();

    console.log(values[0]);
    console.log(values[1]);
    process.exitCode = 0;
  }
}
