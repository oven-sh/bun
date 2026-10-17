// Host for "a node:vm timeout inside a streams operation" in streams.test.js. Runs one family of rows. Each row spins one web streams
// operation in a loop under node:vm's `timeout`, so the run's termination request lands somewhere
// inside that operation, round after round. The timeout ends the run and nothing else: the process
// keeps going, and the stream the operation was working on is still there.
//
// After each round the row finishes what the loop started and checks the state it finds: the
// process is alive, a lock and the promises of its holder agree, and no promise that the spec marks
// as handled (reader.closed, writer.closed, writer.ready) was reported as an unhandled rejection.
//
// Prints "ok <rows>" or "FAIL" plus one line per failure ("<row>: <what> x<count>"). A family in
// which no timeout landed inside an operation is a failure too: it checked nothing.
import vm from "node:vm";

const ROUNDS = Number(process.env.ROUNDS ?? 25);
// A round counts when the timeout landed inside the operation. On a fast build most rounds land
// outside it, so a row runs up to four times its rounds until this many have counted.
const MIN_CHECKED = 5;

type Last = Record<string, any>;
type Row = {
  // Makes what a round works on, for a row that needs streams in a state that takes a turn of the
  // event loop to reach. It is published in `globalThis.subject`. `size` is how many streams a
  // row that uses one per iteration needs to last until the timeout.
  prepare?: (size: number) => Promise<unknown>;
  // Loops until the timeout ends the run. Publishes the objects of the operation in flight in
  // `globalThis.last`, and clears it once the operation returned.
  spin: () => void;
  // Runs after the timeout with the published objects: finish what the loop started.
  settle?: (last: Last) => void;
  // What is wrong with the state, or null.
  check: (last: Last) => string | null;
};

declare global {
  var last: Last | null;
  var subject: any;
  var iterations: number;
  var spin: () => void;
}

const status = (promise: Promise<unknown>) => Bun.peek.status(promise);
const noop = () => {};
const boom = new Error("boom");
const unhandled = new Set<Promise<unknown>>();
process.on("unhandledRejection", (_reason, promise) => {
  unhandled.add(promise);
});

const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const settled = async <T>(stream: T) => (await turn(), stream);

// A row handles the promises of its own that can reject: every report is the streams code's.
const reported = () => (unhandled.size ? "a promise the spec marks as handled was reported" : null);

const FAMILIES: Record<string, Record<string, Row>> = {
  writer: {
    // The writer of a getWriter() that was cut short is out of the script's reach, and the stream
    // still settles its promises later: when the start algorithm settles, or when the sink errors.
    "getWriter() on an erroring stream": {
      spin() {
        for (;;) {
          globalThis.iterations++;
          let controller!: WritableStreamDefaultController;
          const stream = new WritableStream({ start: c => void (controller = c) });
          controller.error(boom);
          globalThis.last = { stream };
          stream.getWriter();
          globalThis.last = null;
        }
      },
      check: reported,
    },
    "getWriter(), then the sink errors": {
      spin() {
        for (;;) {
          globalThis.iterations++;
          let controller!: WritableStreamDefaultController;
          const stream = new WritableStream({ start: c => void (controller = c) });
          globalThis.last = { controller };
          stream.getWriter();
          globalThis.last = null;
        }
      },
      settle: l => l.controller.error(boom),
      check: reported,
    },
    "writer.releaseLock()": {
      spin() {
        for (;;) {
          globalThis.iterations++;
          const stream = new WritableStream({});
          const writer = stream.getWriter();
          globalThis.last = { stream, writer };
          writer.releaseLock();
          globalThis.last = null;
        }
      },
      check(l) {
        const ready = status(l.writer.ready);
        const closed = status(l.writer.closed);
        const released = ready === "rejected" && closed === "rejected";
        const untouched = ready === "fulfilled" && closed === "pending";
        if (l.stream.locked ? !untouched : !released)
          return `locked=${l.stream.locked} ready=${ready} closed=${closed}`;
        return reported();
      },
    },
    // On a stream that is closed or errored the writer's promises are made settled, and
    // releaseLock() replaces them instead of rejecting them.
    "getWriter() and releaseLock() on an errored stream": {
      prepare: () => settled(new WritableStream({ start: c => c.error(boom) })),
      spin() {
        for (;;) {
          globalThis.iterations++;
          globalThis.last = {};
          globalThis.subject.getWriter().releaseLock();
          globalThis.last = null;
        }
      },
      check: reported,
    },
    "getWriter() and releaseLock() on a closed stream": {
      prepare: async () => {
        const stream = new WritableStream({});
        await stream.close();
        return stream;
      },
      spin() {
        for (;;) {
          globalThis.iterations++;
          globalThis.last = {};
          globalThis.subject.getWriter().releaseLock();
          globalThis.last = null;
        }
      },
      check: reported,
    },
    // close() under backpressure resolves writer.ready, then queues the close.
    "writer.close() under backpressure": {
      spin() {
        for (;;) {
          globalThis.iterations++;
          const stream = new WritableStream({}, { highWaterMark: 0 });
          const writer = stream.getWriter();
          globalThis.last = { writer };
          writer.close().catch(noop);
          globalThis.last = null;
        }
      },
      settle: l => void l.writer.close().catch(noop),
      check(l) {
        const ready = status(l.writer.ready);
        const closed = status(l.writer.closed);
        if (ready !== "fulfilled" || closed !== "fulfilled") return `ready=${ready} closed=${closed}`;
        return reported();
      },
    },
    "controller.error() with a writer": {
      spin() {
        for (;;) {
          globalThis.iterations++;
          let controller!: WritableStreamDefaultController;
          const stream = new WritableStream({ start: c => void (controller = c) });
          const writer = stream.getWriter();
          globalThis.last = { controller, writer };
          controller.error(boom);
          globalThis.last = null;
        }
      },
      settle: l => l.controller.error(boom),
      check(l) {
        const ready = status(l.writer.ready);
        const closed = status(l.writer.closed);
        if (ready !== "rejected" || closed !== "rejected") return `ready=${ready} closed=${closed}`;
        return reported();
      },
    },
    // A started stream finishes erroring inside controller.error(), not in the start reaction.
    "controller.error() with a writer on a started stream": {
      prepare: async size => {
        const pool = Array.from({ length: size }, () => {
          let controller!: WritableStreamDefaultController;
          const stream = new WritableStream({ start: c => void (controller = c) });
          return { controller, writer: stream.getWriter() };
        });
        await turn();
        return pool;
      },
      spin() {
        for (const item of globalThis.subject) {
          globalThis.iterations++;
          globalThis.last = item;
          item.controller.error(boom);
          globalThis.last = null;
        }
        // The pool is used up: wait for the timeout.
        for (;;);
      },
      settle: l => l.controller.error(boom),
      check(l) {
        const ready = status(l.writer.ready);
        const closed = status(l.writer.closed);
        if (ready !== "rejected" || closed !== "rejected") return `ready=${ready} closed=${closed}`;
        return reported();
      },
    },
  },

  reader: {
    "getReader() on an errored stream": {
      spin() {
        for (;;) {
          globalThis.iterations++;
          const stream = new ReadableStream({ start: c => c.error(boom) });
          globalThis.last = { stream };
          stream.getReader();
          globalThis.last = null;
        }
      },
      check: reported,
    },
    "reader.releaseLock()": {
      spin() {
        for (;;) {
          globalThis.iterations++;
          const stream = new ReadableStream({});
          const reader = stream.getReader();
          globalThis.last = { stream, closed: reader.closed };
          reader.releaseLock();
          globalThis.last = null;
        }
      },
      check(l) {
        const closed = status(l.closed);
        if (l.stream.locked ? closed !== "pending" : closed !== "rejected")
          return `locked=${l.stream.locked} closed=${closed}`;
        return reported();
      },
    },
    // A native source is told of the release by a call into its handle.
    "reader.releaseLock() on a Blob stream": {
      spin() {
        for (;;) {
          globalThis.iterations++;
          const stream = new Blob(["hello"]).stream();
          const reader = stream.getReader();
          globalThis.last = { stream, closed: reader.closed };
          reader.releaseLock();
          globalThis.last = null;
        }
      },
      check(l) {
        const closed = status(l.closed);
        if (l.stream.locked ? closed !== "pending" : closed !== "rejected")
          return `locked=${l.stream.locked} closed=${closed}`;
        return reported();
      },
    },
    // A direct stream keeps its pending read on the controller, and the release rejects it.
    "reader.releaseLock() on a direct stream with a pending read": {
      spin() {
        for (;;) {
          globalThis.iterations++;
          const stream = new ReadableStream({ type: "direct", pull() {} } as any);
          const reader = stream.getReader();
          const read = reader.read();
          read.catch(noop);
          globalThis.last = { stream, closed: reader.closed, read };
          reader.releaseLock();
          globalThis.last = null;
        }
      },
      check(l) {
        const closed = status(l.closed);
        const read = status(l.read);
        const released = closed === "rejected" && read === "rejected";
        const untouched = closed === "pending" && read === "pending";
        if (l.stream.locked ? !untouched : !released) return `locked=${l.stream.locked} closed=${closed} read=${read}`;
        return reported();
      },
    },
    "getReader() and releaseLock() on an errored stream": {
      prepare: () => settled(new ReadableStream({ start: c => c.error(boom) })),
      spin() {
        for (;;) {
          globalThis.iterations++;
          globalThis.last = {};
          globalThis.subject.getReader().releaseLock();
          globalThis.last = null;
        }
      },
      check: reported,
    },
    "getReader() and releaseLock() on a closed stream": {
      prepare: () => settled(new ReadableStream({ start: c => c.close() })),
      spin() {
        for (;;) {
          globalThis.iterations++;
          globalThis.last = {};
          globalThis.subject.getReader().releaseLock();
          globalThis.last = null;
        }
      },
      check: reported,
    },
    "controller.error() with a reader": {
      spin() {
        for (;;) {
          globalThis.iterations++;
          let controller!: ReadableStreamDefaultController;
          const stream = new ReadableStream({ start: c => void (controller = c) });
          const reader = stream.getReader();
          globalThis.last = { controller, closed: reader.closed };
          controller.error(boom);
          globalThis.last = null;
        }
      },
      settle: l => l.controller.error(boom),
      check(l) {
        const closed = status(l.closed);
        if (closed !== "rejected") return `closed=${closed}`;
        return reported();
      },
    },
  },
};

const family = FAMILIES[process.argv[2]];
if (!family) throw new Error(`unknown family ${process.argv[2]}; one of ${Object.keys(FAMILIES).join(", ")}`);

const failures: string[] = [];
let landed = 0;
for (const [name, row] of Object.entries(family)) {
  globalThis.spin = row.spin;
  const kinds = new Map<string, number>();
  // A slow machine can spend the whole deadline entering the run. Then the loop never starts and the
  // round proves nothing: give the next rounds more time.
  let timeout = 2;
  let size = 64;
  for (let round = 0, checked = 0; round < ROUNDS || (checked < MIN_CHECKED && round < ROUNDS * 4); round++) {
    globalThis.subject = await row.prepare?.(size);
    globalThis.last = null;
    globalThis.iterations = 0;
    unhandled.clear();
    try {
      vm.runInThisContext("spin()", { timeout });
    } catch (e: any) {
      if (e?.code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") throw e;
    }
    if (globalThis.iterations === 0 && timeout < 16) timeout *= 2;
    size = Math.min(32768, Math.max(64, globalThis.iterations * 2));
    const last = globalThis.last;
    // Reactions the run queued (a start algorithm settling, for example) run now, with no deadline.
    await turn();
    await turn();
    if (!last) continue;
    checked++;
    landed++;
    row.settle?.(last);
    await turn();
    await turn();
    const what = row.check(last);
    if (what) kinds.set(what, (kinds.get(what) ?? 0) + 1);
  }
  for (const [what, count] of kinds) failures.push(`${name}: ${what} x${count}`);
}

if (!landed) failures.push("no timeout landed inside an operation");
if (failures.length) {
  console.log(["FAIL", ...failures].join("\n"));
  process.exitCode = 1;
} else {
  console.log(`ok ${Object.keys(family).length}`);
}
