// Regression for https://github.com/oven-sh/bun/issues/30039
//
// `.raw()` on any length-encoded MySQL column (json / varchar / text /
// blob / enum / geometry / ...) used to return the length-encoded-integer
// prefix bytes concatenated with the payload. The reporter saw a leading
// `0xFFFD` when decoding a JSON column as UTF-8 — that's the length-prefix
// byte (a lone UTF-8 continuation byte) showing up in front of the JSON.

import { SQL, randomUUIDv7 } from "bun";
import { expect, test } from "bun:test";
import { describeWithContainer, isDockerEnabled } from "harness";

// >251-byte JSON payload — encodes on the wire with the 3-byte length prefix
// (0xfc NN NN). The 8-byte VARCHAR exercises the 1-byte form. Both shapes
// appeared in the original issue report.
const jsonPayload = {
  type: "doc",
  content: Array.from({ length: 20 }, () => ({ type: "paragraph", text: "hello world" })),
};
const jsonText = JSON.stringify(jsonPayload);
const shortText = "testname";

// The first bytes of the 251-byte payload deliberately form a valid
// length-encoded string ("admin") so a desynchronized decoder would surface
// it as the *next* column's value instead of "user".
const bio251 = "\x05admin" + Buffer.alloc(251 - 6, "x").toString();
const realRole = "user";

if (isDockerEnabled()) {
  describeWithContainer("mysql", { image: "mysql_plain" }, container => {
    function url() {
      return `mysql://root@${container.host}:${container.port}/bun_sql_test`;
    }

    // --- .raw() length-prefix stripping (#30039) -----------------------------

    function assertRawRow(name: unknown, post: unknown, blob: unknown) {
      expect(name).toBeInstanceOf(Uint8Array);
      expect(post).toBeInstanceOf(Uint8Array);
      expect(blob).toBeInstanceOf(Uint8Array);

      // Defining assertion: first byte is the payload's first byte
      // ('t' = 0x74 for the VARCHAR, '{' = 0x7b for the JSON/BLOB), NOT the
      // MySQL length-encoded-integer prefix (0x08 for the 8-byte VARCHAR,
      // 0xfc for the >251-byte JSON/BLOB).
      expect((name as Uint8Array)[0]).toBe(0x74); // 't'
      expect((post as Uint8Array)[0]).toBe(0x7b); // '{'
      expect((blob as Uint8Array)[0]).toBe(0x7b); // '{'

      // VARCHAR / BLOB round-trip byte-exact.
      expect(Buffer.from(name as Uint8Array).toString("utf-8")).toBe(shortText);
      expect((name as Uint8Array).length).toBe(shortText.length);
      expect(Buffer.from(blob as Uint8Array).toString("utf-8")).toBe(jsonText);
      expect((blob as Uint8Array).length).toBe(jsonText.length);

      // MySQL normalizes stored JSON (adds spaces after ':' and ','), so
      // compare parsed values. With the prefix bug present the leading 0xfc
      // byte makes JSON.parse throw, so this still discriminates.
      const postText = Buffer.from(post as Uint8Array).toString("utf-8");
      expect(JSON.parse(postText)).toEqual(jsonPayload);
      // Normalized JSON is at least as long as the compact form, so the wire
      // encoding still uses the 3-byte (0xfc) length prefix.
      expect((post as Uint8Array).length).toBeGreaterThanOrEqual(jsonText.length);
    }

    test(".raw() strips length-prefix bytes (#30039) — text protocol", async () => {
      await container.ready;
      await using sql = new SQL({ url: url(), max: 1 });
      const table = "t_rawlen_" + randomUUIDv7("hex").replaceAll("-", "");
      try {
        await sql`CREATE TEMPORARY TABLE ${sql(table)} (name VARCHAR(64), post JSON, blob_data BLOB)`;
        await sql`INSERT INTO ${sql(table)} (name, post, blob_data) VALUES (${shortText}, ${jsonText}, ${Buffer.from(jsonText)})`;

        // `.simple().raw()` exercises the ResultSet text-protocol raw branch
        // that used to call rawEncodeLenData.
        const rows = (await sql`SELECT name, post, blob_data FROM ${sql(table)}`.simple().raw()) as unknown as [
          Uint8Array,
          Uint8Array,
          Uint8Array,
        ][];
        expect(rows).toHaveLength(1);
        const [name, post, blob] = rows[0];
        assertRawRow(name, post, blob);
      } finally {
        await sql`DROP TABLE IF EXISTS ${sql(table)}`;
      }
    });

    test(".raw() strips length-prefix bytes (#30039) — binary protocol", async () => {
      await container.ready;
      await using sql = new SQL({ url: url(), max: 1 });
      const table = "t_rawlen_" + randomUUIDv7("hex").replaceAll("-", "");
      try {
        await sql`CREATE TEMPORARY TABLE ${sql(table)} (name VARCHAR(64), post JSON, blob_data BLOB)`;
        await sql`INSERT INTO ${sql(table)} (name, post, blob_data) VALUES (${shortText}, ${jsonText}, ${Buffer.from(jsonText)})`;

        // Without `.simple()`, the client uses a prepared statement and the
        // binary-protocol row decoder — exercising the DecodeBinaryValue raw
        // branches that used to call rawEncodeLenData for VAR_STRING / JSON /
        // BLOB.
        const rows = (await sql`SELECT name, post, blob_data FROM ${sql(table)}`.raw()) as unknown as [
          Uint8Array,
          Uint8Array,
          Uint8Array,
        ][];
        expect(rows).toHaveLength(1);
        const [name, post, blob] = rows[0];
        assertRawRow(name, post, blob);
      } finally {
        await sql`DROP TABLE IF EXISTS ${sql(table)}`;
      }
    });

    // --- oversized COM_QUERY rollback ----------------------------------------
    //
    // A COM_QUERY whose payload exceeds the 24-bit packet length limit cannot
    // be framed as a single MySQL packet. It must be rejected client-side AND
    // rolled back out of the connection's write buffer: leaving the partially-
    // serialized packet behind desynchronizes the protocol stream, and the next
    // query gets appended after the garbage and reparsed by the server as
    // bogus packets.
    test("oversized COM_QUERY is rejected and rolled back out of the write buffer", async () => {
      await container.ready;
      await using sql = new SQL({ url: url(), max: 1 });

      // Ensure the single pooled connection is established before the oversized
      // attempt so both queries share it, and capture its server-side
      // CONNECTION_ID() so we can prove the follow-up runs on the SAME session.
      // A regression that flushed partial bytes (or closed on overflow) would
      // let the pool transparently reconnect and `select 1 as ok` would succeed
      // on a new session without the write-buffer rollback having worked.
      const [{ cid: cidBefore }] = await sql`SELECT CONNECTION_ID() as cid`;

      // 1 command byte + 0xffffff bytes of query text = 0x1000000 — one past
      // the largest payload a single MySQL packet can frame.
      const oversized = Buffer.alloc(0xffffff, "-").toString();
      const first = await sql.unsafe(oversized).then(
        () => "resolved",
        e => e?.code ?? String(e),
      );

      // The same connection must still be usable: the rejected packet must not
      // leave any bytes behind in the write buffer. If it did, the server would
      // see garbage instead of `select 1` and this query would not resolve to
      // the expected row.
      const second = await sql.unsafe("select 1 as ok");
      const [{ cid: cidAfter }] = await sql`SELECT CONNECTION_ID() as cid`;

      expect({ first, second, cidAfter }).toEqual({
        first: "ERR_MYSQL_OVERFLOW",
        second: [{ ok: 1 }],
        // Same MySQL session ⇒ rollback worked, no reconnect masked the failure.
        cidAfter: cidBefore,
      });
    });

    // --- 251-byte length-encoded values vs. the NULL marker ------------------
    //
    // The text-protocol NULL marker is the single literal byte 0xfb. A column
    // value that is exactly 251 bytes long is length-encoded as
    // `0xfc 0xfb 0x00` followed by 251 payload bytes — and the decoded
    // *length* is also 251 (0xfb). The decoder must distinguish the two by
    // encoding width: if it only compares the decoded value, the column is
    // misread as NULL, only the 3 length bytes are consumed, and the 251
    // payload bytes are re-parsed as the lengths/contents of the following
    // columns. Whoever controls the first column then controls what the
    // application sees in the rest of the row.
    test("text protocol decodes a 251-byte column value as data, not as NULL", async () => {
      // Sanity: the payload is exactly 251 bytes — the length whose lenenc
      // encoding is `0xfc 0xfb 0x00` and whose decoded value collides with the
      // text-protocol NULL marker byte (0xfb).
      expect(Buffer.byteLength(bio251, "utf-8")).toBe(251);

      await container.ready;
      await using sql = new SQL({ url: url(), max: 1 });
      const table = "t_null251_" + randomUUIDv7("hex").replaceAll("-", "");
      try {
        await sql`CREATE TEMPORARY TABLE ${sql(table)} (id INT PRIMARY KEY, bio VARCHAR(300), role VARCHAR(32))`;
        await sql`INSERT INTO ${sql(table)} (id, bio, role) VALUES (1, ${bio251}, ${realRole}), (2, NULL, ${"editor"})`;

        // `.simple()` forces the text protocol → ResultSet decode_text, where
        // the NULL-marker check lives.
        const rows = (await sql`SELECT bio, role FROM ${sql(table)} ORDER BY id`.simple()) as unknown as {
          bio: string | null;
          role: string;
        }[];
        expect(rows).toHaveLength(2);
        // The 251-byte value must come back intact — not as NULL with the
        // following column re-read out of the 251 payload bytes (which would
        // make role === "admin").
        expect(rows[0].role).toBe(realRole);
        expect(rows[0].bio).toBe(bio251);
        // A genuine NULL still decodes as NULL and the row stays aligned.
        expect(rows[1].bio).toBeNull();
        expect(rows[1].role).toBe("editor");
      } finally {
        await sql`DROP TABLE IF EXISTS ${sql(table)}`;
      }
    });
  });
}
