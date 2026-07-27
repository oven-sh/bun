// Run under `ulimit -f 1024` (RLIMIT_FSIZE = 1 MiB). Writes a single 4 MiB
// chunk (1 MiB each of A/B/C/D) through createWriteStream and reports whether
// the on-disk bytes are a byte-exact prefix of the source. A short write that
// retries at offset 0 would stamp the tail block over the head.
const fs = require("fs");
const path = process.argv[2];

const MiB = 1 << 20;
const src = Buffer.concat([
  Buffer.alloc(MiB, "A"),
  Buffer.alloc(MiB, "B"),
  Buffer.alloc(MiB, "C"),
  Buffer.alloc(MiB, "D"),
]);

const events = [];
const stream = fs.createWriteStream(path);
stream.on("error", e => events.push("error:" + (e && e.code)));
stream.on("finish", () => events.push("finish"));
stream.on("close", () => {
  const out = fs.existsSync(path) ? fs.readFileSync(path) : Buffer.alloc(0);
  const head = out.subarray(0, 8).toString();
  const isPrefix = src.subarray(0, out.length).equals(out);
  process.stdout.write(
    JSON.stringify({
      events,
      bytesWritten: stream.bytesWritten,
      fileSize: out.length,
      head,
      isPrefix,
    }) + "\n",
  );
});
stream.write(src);
stream.end();
