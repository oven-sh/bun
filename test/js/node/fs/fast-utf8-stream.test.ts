import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { once } from "node:events";
import { openSync, readFileSync, Utf8Stream } from "node:fs";
import { join } from "node:path";

// Regression: after a multi-byte UTF-8 chunk is fully written, the stream must
// keep flushing the remaining buffered chunks. releaseWritingBuf() tracks the
// pending length in characters but, on a full write, decremented it by the byte
// count returned by fs.write without converting to characters first. For
// multi-byte data this drove #len to 0 while #bufs still held queued chunks, so
// end() closed without writing them and the stream stalled instead of draining.
// See also test/js/node/test/parallel/test-fastutf8stream-full-write-utf8.js
// (vendored from Node, nodejs/node#63964) for the fs-override async drain case.
describe("fs.Utf8Stream releaseWritingBuf after a full multi-byte write", () => {
  // "€" is one UTF-16 code unit but three UTF-8 bytes, so byte count and char
  // count diverge on every write.
  const CHAR = "€";

  test("async: end() flushes every queued multi-byte chunk", async () => {
    using dir = tempDir("utf8stream-fullwrite-async", {});
    const dest = join(String(dir), "out.log");
    const fd = openSync(dest, "w");
    // maxWrite: 1 forces each write() into its own buffer entry, so while the
    // first async fs.write is in flight the later chunks sit in #bufs.
    const stream = new Utf8Stream({ fd, sync: false, maxWrite: 1 });
    await once(stream, "ready");
    stream.write(CHAR);
    stream.write(CHAR);
    stream.write(CHAR);
    stream.end();
    await once(stream, "finish");
    expect(readFileSync(dest, "utf8")).toBe(CHAR.repeat(3));
  });

  test("sync: end() flushes every queued multi-byte chunk", async () => {
    using dir = tempDir("utf8stream-fullwrite-sync", {});
    const dest = join(String(dir), "out.log");
    const fd = openSync(dest, "w");
    // minLength: 4 holds the first chunk back so the second write finds a
    // non-empty #bufs and (with maxWrite: 5) starts a second entry; that second
    // entry is what the pre-fix code stranded once #len hit 0.
    const stream = new Utf8Stream({ fd, sync: true, minLength: 4, maxWrite: 5 });
    await once(stream, "ready");
    stream.write(CHAR.repeat(3));
    stream.write(CHAR.repeat(3));
    stream.write(CHAR.repeat(3));
    stream.end();
    await once(stream, "finish");
    expect(readFileSync(dest, "utf8")).toBe(CHAR.repeat(9));
  });

  test("async: ASCII chunk queued after a multi-byte chunk is not dropped", async () => {
    using dir = tempDir("utf8stream-fullwrite-mixed", {});
    const dest = join(String(dir), "out.log");
    const fd = openSync(dest, "w");
    const stream = new Utf8Stream({ fd, sync: false });
    await once(stream, "ready");
    stream.write("ééé");
    stream.write("a");
    stream.end();
    await once(stream, "finish");
    expect(readFileSync(dest, "utf8")).toBe("éééa");
  });
});
