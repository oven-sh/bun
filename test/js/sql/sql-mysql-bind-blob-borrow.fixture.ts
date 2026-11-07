// In its own process: a client that keeps a pointer to the buffer across toJSON() segfaults in the resize cases.
import { SQL } from "bun";

const url = process.env.MYSQL_URL;
if (!url) throw new Error("MYSQL_URL is required");

const SIZE = 1024 * 1024;
const sql = new SQL({ url, max: 1 });

/** Binds `[id, blob, { toJSON: hurt }]` and reports what the server stored for `blob`. */
async function stored(id: number, blob: () => ArrayBuffer | ArrayBufferView, hurt: (values: unknown[]) => void) {
  const values: unknown[] = [
    id,
    blob(),
    {
      toJSON() {
        hurt(values);
        return "hurt";
      },
    },
  ];
  await sql.unsafe("INSERT INTO blob_borrow (id, data, name) VALUES (?, ?, ?)", values);
  const [row] = await sql.unsafe(
    "SELECT LENGTH(data) AS length, HEX(LEFT(data, 2)) AS head, HEX(RIGHT(data, 2)) AS tail, name FROM blob_borrow WHERE id = ?",
    [id],
  );
  return `${row.length} ${row.head}..${row.tail} ${row.name}`;
}

const filled = (buffer: ArrayBuffer) => (new Uint8Array(buffer).fill(0xab), buffer);
function dropAndCollect(values: unknown[]) {
  values[1] = null;
  Bun.gc(true);
}

try {
  await sql.unsafe("CREATE TEMPORARY TABLE blob_borrow (id INT, data MEDIUMBLOB, name VARCHAR(255))").simple();
  // Prepare the statement, so that the next executions bind and write in one go.
  await sql.unsafe("INSERT INTO blob_borrow (id, data, name) VALUES (?, ?, ?)", [0, new Uint8Array(4), "prime"]);

  const results: Record<string, string> = {};
  {
    const buffer = filled(new ArrayBuffer(SIZE));
    results["view of a transferred ArrayBuffer"] = await stored(
      1,
      () => new Uint8Array(buffer),
      // Zero-copy: the new buffer owns the same memory.
      () => void new Uint8Array(buffer.transfer()).fill(0xff),
    );
  }
  {
    const buffer = filled(new ArrayBuffer(SIZE, { maxByteLength: 2 * SIZE }));
    results["view of a resizable ArrayBuffer, resized to 0"] = await stored(
      2,
      () => new Uint8Array(buffer),
      () => buffer.resize(0),
    );
  }
  {
    const buffer = filled(new ArrayBuffer(SIZE, { maxByteLength: 2 * SIZE }));
    results["resizable ArrayBuffer, resized to 0"] = await stored(
      3,
      () => buffer,
      () => buffer.resize(0),
    );
  }
  {
    const buffer = filled(new ArrayBuffer(SIZE, { maxByteLength: 2 * SIZE }));
    results["length-tracking view, buffer halved"] = await stored(
      4,
      () => new Uint8Array(buffer),
      () => buffer.resize(SIZE / 2),
    );
  }
  {
    const buffer = filled(new ArrayBuffer(SIZE, { maxByteLength: 2 * SIZE }));
    results["fixed-length view that falls out of bounds"] = await stored(
      5,
      () => new Uint8Array(buffer, 0, SIZE),
      () => buffer.resize(SIZE / 2),
    );
  }
  results["buffer nothing else refers to, with a GC"] = await stored(
    6,
    () => new Uint8Array(filled(new ArrayBuffer(SIZE))),
    dropAndCollect,
  );
  results["small typed array nothing else refers to, with a GC"] = await stored(
    7,
    () => new Uint8Array(16).fill(0xab),
    dropAndCollect,
  );
  results["connection afterwards"] = String((await sql.unsafe("SELECT ? AS x", ["usable"]))[0].x);
  console.log(JSON.stringify(results));
} finally {
  await sql.close();
}
