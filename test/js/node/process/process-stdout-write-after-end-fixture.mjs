const code = e => (e == null ? null : String(e.code || e.name || e));

// Which stream to end() and write to after. The JSON report is written to the
// other stream so the "ended" stream's pipe only ever carries its data writes.
const which = process.argv[2] === "stderr" ? "stderr" : "stdout";
const so = process[which];
const reportStream = which === "stderr" ? process.stdout : process.stderr;

const ev = [];
so.on("error", e => ev.push("err:" + code(e)));

so.write("A");
so.end("B");

// A distinctive post-end marker (not a common letter) so the reader-side
// assertion can't collide with benign ASAN/debug noise on the same fd.
const { promise, resolve } = Promise.withResolvers();
let cbErr = "no-callback";
const ret = so.write("POST_END_MARKER", e => {
  cbErr = code(e);
  resolve();
});
await promise;
// The write callback and the 'error' event both land on process.nextTick;
// draining one more tick lets the error event fire before we read `ev`.
await new Promise(r => process.nextTick(r));

reportStream.write(
  JSON.stringify({
    writableEnded: so.writableEnded,
    writable: so.writable,
    ret,
    cbErr,
    ev,
  }) + "\n",
);
