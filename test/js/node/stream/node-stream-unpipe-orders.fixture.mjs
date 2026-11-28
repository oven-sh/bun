// Orders of readable.unpipe() with no argument. One line for each order: what the source and the consumers behind the
// call look like one chunk later. node-stream-unpipe-orders.expected.txt is what `node` v26.12.1 prints for this file.
import { Readable, Writable } from "node:stream";

const turn = () => new Promise(resolve => setImmediate(resolve));

const kinds = {
  // never answers false
  plain: () => new Writable({ write: (chunk, encoding, callback) => callback() }),
  // answers false once and drains
  waitedOnce: () => new Writable({ highWaterMark: 1, write: (chunk, encoding, callback) => process.nextTick(callback) }),
  // in backpressure, needDrain is set
  stuck: () => new Writable({ highWaterMark: 1, write() {} }),
  // fails the write in its own call: write() answers false and needDrain stays clear
  failing: () => {
    const writable = new Writable({ write: (chunk, encoding, callback) => callback(new Error("fail")) });
    writable.on("error", () => {});
    return writable;
  },
  // answers false and leaves needDrain clear for as long as it is piped
  alwaysFalse: () => {
    const writable = new Writable({ write: (chunk, encoding, callback) => callback() });
    const write = writable.write;
    writable.write = function (...args) {
      write.apply(this, args);
      return false;
    };
    return writable;
  },
};

const names = Object.keys(kinds);
const destinations = [...names.map(a => [a]), ...names.flatMap(a => names.map(b => [a, b]))];
// when: unpipe() a turn behind the first chunk, or inside the 'data' event of the first chunk.
// behind: who is there afterwards: nobody, a 'data' listener of the program, or two later pipes of which the second is
// in backpressure at pipe().
const shapes = ["quiet", "tick"].flatMap(when => ["nobody", "listener", "later"].map(behind => [when, behind]));

const lines = [];
for (const combination of destinations) {
  for (const [when, behind] of shapes) {
    const seen = [];
    const source = new Readable({ read() {} });
    const first = new Writable({
      write(chunk, encoding, callback) {
        seen.push(`first:${chunk}`);
        callback();
      },
    });
    let drain;
    const second = new Writable({
      highWaterMark: 1,
      write(chunk, encoding, callback) {
        if (String(chunk) !== "before") seen.push(`second:${chunk}`);
        drain = callback;
      },
    });
    second.write("before");
    const pipeLater = () => {
      source.pipe(first);
      source.pipe(second);
    };
    if (behind === "listener" && when === "quiet") source.on("data", chunk => seen.push(`listener:${chunk}`));
    for (const name of combination) source.pipe(kinds[name]());
    if (when === "tick") {
      source.on("data", function inTheTick(chunk) {
        if (behind === "listener") seen.push(`listener:${chunk}`);
        if (String(chunk) !== "a") return;
        if (behind !== "listener") source.removeListener("data", inTheTick);
        source.unpipe();
        if (behind === "later") pipeLater();
      });
    }
    source.push("a");
    await turn();
    if (when === "quiet") {
      source.unpipe();
      if (behind === "later") pipeLater();
    }
    await turn();
    if (behind === "later") {
      drain();
      await turn();
    }
    source.push("b");
    await turn();
    lines.push(
      `${combination.join("+")} ${when} ${behind} | flowing=${source.readableFlowing} buffered=${source.readableLength} got=${seen.join(",")}`,
    );
  }
}
console.log(lines.join("\n"));
