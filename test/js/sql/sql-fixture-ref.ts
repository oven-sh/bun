// This test passes by printing
// 1
// 2
// and exiting with code 0.
import { sql } from "bun";
process.exitCode = 1;

async function first() {
  const result = await sql`select 1 as x`;
  console.log(result[0].x);
}

async function yo() {
  const result2 = await sql`select 2 as x`;
  console.log(result2[0].x);
  process.exitCode = 0;
}
first();
Bun.gc(true);
yo();
Bun.gc(true);
