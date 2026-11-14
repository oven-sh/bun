// usage: once-data-fixture.js <form> [ticks] [stream]
//
// A loop of `await once(stream, "data")`: between two chunks the stream has no 'data' listener.
//   tick       the next once() comes [ticks] nextTicks behind the chunk
//   pause      the same, and the stream is paused for those nextTicks
//   late       as pause, and the next once() comes one more nextTick behind resume()
//   hold       as pause, and the stream is paused for one setImmediate in place of the nextTicks
//   immediate  as hold, and the next once() comes one more nextTick behind resume()
// [stream] is "process.stdin", or "fromWeb" for Readable.fromWeb(Bun.stdin.stream()).
//
// The writer sends byteAt(offset) at each offset. At exit this prints how many bytes came, the first
// offset that held another byte, and how many bytes the loop was done with when 'end' came.
const { once } = require("node:events");
const { Readable } = require("node:stream");

const [form, ticks = "1", source = "process.stdin"] = process.argv.slice(2);
const stream = source === "fromWeb" ? Readable.fromWeb(Bun.stdin.stream()) : process.stdin;
const byteAt = offset => (offset ^ (offset >>> 8) ^ (offset >>> 16)) & 255;
const nextTick = () => new Promise(resolve => process.nextTick(resolve));

let bytes = 0;
let firstWrongByte = -1;
let done = 0;
let doneAtEnd = -1;
stream.on("end", () => {
  doneAtEnd = done;
});
process.on("exit", () => console.log(JSON.stringify({ bytes, firstWrongByte, doneAtEnd })));

(async () => {
  for (;;) {
    const [chunk] = await once(stream, "data");
    for (let i = 0; i < chunk.length && firstWrongByte < 0; i++) {
      if (chunk[i] !== byteAt(bytes + i)) firstWrongByte = bytes + i;
    }
    bytes += chunk.length;
    if (form !== "tick") stream.pause();
    if (form === "hold" || form === "immediate") await new Promise(resolve => setImmediate(resolve));
    else for (let i = 0; i < Number(ticks); i++) await nextTick();
    if (form !== "tick") stream.resume();
    if (form === "late" || form === "immediate") await nextTick();
    done += chunk.length;
  }
})();
