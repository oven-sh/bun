// Reproducer: a result column whose name is all digits with an interior
// underscore (e.g. `2024_01`) must stay a NAMED key. The shared
// ColumnIdentifier classifier used to route the name through an integer parse
// that skips `_` digit separators, so `2024_01` parsed to 202401 and was
// misclassified as a positional array index. That corrupted the result object
// (the `2024_01` key vanished, its value landing at index 202401) and, when
// mixed with a normal named column, tripped a debug-build assertion
// (`cell.index < count`) in the object-building slow path.
//
// Runs against a real MySQL/MariaDB server (the classifier is shared with
// Postgres, so this also covers that decoder). Prints "CONNECTED" after the
// first successful round-trip so the harness can tell "no DB here" apart from
// "connected then produced the wrong shape".

import { SQL, randomUUIDv7 } from "bun";

const url = process.env.MYSQL_URL;
if (!url) throw new Error("MYSQL_URL is required");

const tls = process.env.CA_PATH ? { ca: Bun.file(process.env.CA_PATH) } : undefined;
await using sql = new SQL({ url, tls, max: 1 });

// Priming query doubles as a connectivity check.
await sql`SELECT 1 AS x`;
console.log("CONNECTED");

const t = "col_digits_" + randomUUIDv7("hex").replaceAll("-", "");

// `2024_01`/`2024_02` are digits+underscore; `8` is a pure digit whose value
// (8) exceeds the column count — the combination that used to trip the
// `cell.index < count` assertion in the mixed named+indexed slow path. A
// leading `product` keeps the result on that slow path.
await sql`CREATE TEMPORARY TABLE ${sql(t)} (product VARCHAR(64), \`2024_01\` INT, \`2024_02\` INT, \`8\` INT)`;
await sql`INSERT INTO ${sql(t)} ${sql({ product: "widget", "2024_01": 10, "2024_02": 20, "8": 42 })}`;

const [row] = await sql`SELECT product, \`2024_01\`, \`2024_02\`, \`8\` FROM ${sql(t)}`;

console.log(JSON.stringify({ row, keys: Object.keys(row).sort() }));
