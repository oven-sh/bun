// Reproducer for https://github.com/oven-sh/bun/issues/30039
//
// `.raw()` on length-encoded column types (json / varchar / text / blob / ...)
// returned the MySQL length-encoded-integer prefix bytes concatenated with the
// payload instead of just the payload. For an 8-byte VARCHAR the Buffer was
// [0x08, ...bytes]; for a ~167-byte JSON column it was [0xa7, '{', ...] which
// decodes as "\uFFFD{..." under UTF-8.
//
// This fixture runs against the MySQL at MYSQL_URL, exercises both the binary
// protocol (default) and the text protocol (`.simple()`), and prints one JSON
// line per case so the test harness can assert on exact payload round-trips.

import { SQL } from "bun";

const url = process.env.MYSQL_URL;
if (!url) throw new Error("MYSQL_URL is required");

const tls = process.env.CA_PATH ? { ca: Bun.file(process.env.CA_PATH) } : undefined;
const sql = new SQL({ url, tls, max: 1 });

try {
  // Priming round-trip — lets the test distinguish "couldn't connect" from
  // "connected then behaved wrong".
  await sql`SELECT 1 AS x`;
  console.log("CONNECTED");

  // Unique table name so concurrent runs don't collide on the same server.
  const table = "bun_raw_len_" + Math.random().toString(36).slice(2, 10);

  // 167 bytes is past the 0xfb threshold that switches length encoding from a
  // 1-byte prefix to a 3-byte prefix. The short VARCHAR exercises the 1-byte
  // case. The explicit padding makes the JSON long enough that the corrupted
  // first byte used to be 0xa7 — a leading UTF-8 continuation byte.
  const jsonPayload = {
    type: "doc",
    content: Array.from({ length: 20 }, () => ({ type: "paragraph", text: "hello world" })),
  };
  const jsonText = JSON.stringify(jsonPayload);
  const shortText = "testname";

  await sql.unsafe(`DROP TABLE IF EXISTS ${table}`);
  await sql.unsafe(`CREATE TABLE ${table} (post json NOT NULL, name varchar(32) NOT NULL)`);

  try {
    await sql.unsafe(`INSERT INTO ${table} (post, name) VALUES (?, ?)`, [jsonText, shortText]);

    // Binary protocol (default) — decoded by DecodeBinaryValue.zig.
    const rawBinary = await sql`SELECT post, name FROM ${sql(table)}`.raw();
    // Text protocol (.simple()) — decoded by ResultSet.decodeText in ResultSet.zig.
    const rawText = await sql`SELECT post, name FROM ${sql(table)}`.simple().raw();

    const describe = (row: unknown[]) => ({
      postIsUint8Array: row[0] instanceof Uint8Array,
      postLength: (row[0] as Uint8Array).length,
      postFirstByte: (row[0] as Uint8Array)[0],
      postText: Buffer.from(row[0] as Uint8Array).toString("utf-8"),
      nameLength: (row[1] as Uint8Array).length,
      nameFirstByte: (row[1] as Uint8Array)[0],
      nameText: Buffer.from(row[1] as Uint8Array).toString("utf-8"),
    });

    console.log(
      JSON.stringify({
        expected: {
          jsonText,
          jsonTextLength: jsonText.length,
          jsonFirstByte: jsonText.charCodeAt(0),
          shortText,
          shortTextLength: shortText.length,
          shortFirstByte: shortText.charCodeAt(0),
        },
        binary: describe(rawBinary[0]),
        text: describe(rawText[0]),
      }),
    );
  } finally {
    await sql.unsafe(`DROP TABLE IF EXISTS ${table}`);
  }
} finally {
  await sql.close();
}
