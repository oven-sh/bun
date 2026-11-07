const code = e => (e == null ? null : String(e.code || e.name || e));

// Which stream to exercise. The JSON report goes to the other stream.
const which = process.argv[2] === "stderr" ? "stderr" : "stdout";
const so = process[which];
const reportStream = which === "stderr" ? process.stdout : process.stderr;

const ev = [];
so.on("error", e => ev.push("err:" + code(e)));

const finished = new Promise(resolve => so.once("finish", resolve));
so.write("A");
so.end("B");

// Let end() run to completion before the post-end write. This is the
// pipeline(src, process.stdout) shape: pipeline resolves after the destination
// finishes, then the program keeps logging. 'finish' always fires; one
// setImmediate then lets any finish -> destroy -> _undestroy nextTicks drain.
await finished;
await new Promise(resolve => setImmediate(resolve));

const { promise, resolve } = Promise.withResolvers();
let cbErr = "no-callback";
const ret = so.write("C", e => {
  cbErr = code(e);
  resolve();
});
// console goes to the same fd; its bytes must land alongside the write().
console[which === "stderr" ? "error" : "log"]("D");
await promise;
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
