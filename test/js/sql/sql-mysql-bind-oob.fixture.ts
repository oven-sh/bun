// Reproducer for an out-of-bounds write in MySQLQuery.bind().
//
// Signature.generate() and bind() each create a fresh iterator over the
// user-supplied params array. If an index getter mutates the array so that
// the second iteration is longer than the first, bind() would index past the
// `params` / `param_types` buffers it sized based on the first iteration.
//
// Without the bounds check this panics in debug builds (index out of bounds)
// and is a silent heap overflow in release builds.

import { SQL } from "bun";

const url = process.env.MYSQL_URL;
if (!url) throw new Error("MYSQL_URL is required");

const tls = process.env.CA_PATH ? { ca: Bun.file(process.env.CA_PATH) } : undefined;
const sql = new SQL({ url, tls, max: 1 });

try {
  // Prime the prepared-statement cache so the next call with the same
  // signature goes straight to bindAndExecute without re-preparing.
  await sql.unsafe("select ? as x", [1]);

  const values: number[] = [1];
  let fired = 0;
  Object.defineProperty(values, "0", {
    enumerable: true,
    configurable: true,
    get() {
      if (fired++ === 0) {
        for (let i = 0; i < 100; i++) values.push(1);
      }
      return 1;
    },
  });

  const result = await sql.unsafe("select ? as x", values).then(
    rows => ({ ok: true, rows }),
    err => ({ ok: false, code: err?.code, message: String(err?.message ?? err) }),
  );
  console.log(JSON.stringify(result));
} finally {
  await sql.close();
}
