// Runs unchanged under Node: `node promise-operators-start-in-the-call-fixture.js` prints what the test expects.
//
// toArray(), forEach(), reduce(), some(), every() and find() of Readable start to read inside the call.
// Every row makes its calls in one tick, with no promise job between them.
const { Duplex, Readable } = require("node:stream");
const http = require("node:http");

const operators = {
  toArray: stream => stream.toArray(),
  forEach: stream => stream.forEach(() => {}),
  reduce: stream => stream.reduce((a, b) => a + b, 0),
  some: stream => stream.some(() => false),
  every: stream => stream.every(() => true),
  find: stream => stream.find(() => false),
};

const uncaught = new Set();
process.on("uncaughtException", error => {
  uncaught.add(error.message);
  console.error(`uncaught: ${error.message}`);
  process.exitCode = 1;
});
const whetherUncaught = message => (uncaught.has(message) ? " | uncaught 'error'" : "");
const outcome = promise =>
  promise.then(
    value => `resolved ${JSON.stringify(value)}`,
    reason => `rejected with ${reason.code ?? reason.name}`,
  );

// Part 1: the stream is destroyed with an error in the tick of the call. The operator has its 'error' listener
// on the stream before 'error' is emitted, so the promise rejects and nothing is uncaught.
const destroyed = [];
function destroyInTheTickOfTheCall(place) {
  for (const order of ["call, destroy(err)", "destroy(err), call"]) {
    for (const name of Object.keys(operators)) {
      const error = new Error(`${place} | ${order} | ${name}`);
      let reads = 0;
      const stream = new Readable({
        read() {
          reads++;
        },
      });
      if (order === "destroy(err), call") stream.destroy(error);
      const settled = operators[name](stream).then(
        () => "resolved",
        reason => (reason === error ? "rejected with err" : `rejected with ${reason}`),
      );
      const listeners = ["error", "readable", "end", "close"].map(event => stream.listenerCount(event)).join("/");
      const atReturn = `listeners ${listeners}, readableFlowing ${stream.readableFlowing}, read() calls ${reads}`;
      if (order === "call, destroy(err)") stream.destroy(error);
      destroyed.push({ place, order, name, error, atReturn, settled });
    }
  }
}
async function printDestroyed() {
  // One line for the operators that did the same.
  const lines = new Map();
  for (const { place, order, name, error, atReturn, settled } of destroyed) {
    const line = `${place} | ${order} | ${atReturn} | ${await settled}${whetherUncaught(error.message)}`;
    lines.set(line, [...(lines.get(line) ?? []), name]);
  }
  for (const [line, names] of lines) console.log(`${line} | ${names.join(", ")}`);
}

// Part 2: what else a caller sees. Each row returns the promise of its line.
const settling = [
  function flowing() {
    // The operator's 'readable' listener stops the flow that resume() asked for, so the chunk waits for it.
    const stream = new Readable({ objectMode: true, read() {} });
    stream.push("a");
    stream.resume();
    const chunks = stream.toArray();
    stream.push(null);
    return outcome(chunks).then(text => `push("a"), resume(), toArray(), push(null) | ${text}`);
  },
  function read() {
    const stream = new Readable({ objectMode: true, read() {} });
    stream.push("a");
    const chunks = stream.toArray();
    const chunk = stream.read();
    stream.push(null);
    return outcome(chunks).then(text => `push("a"), toArray(), read() | read() returned ${chunk} | ${text}`);
  },
  function noRead() {
    // The operator calls read() of the stream, and this stream has none.
    const stream = new Readable({ objectMode: true });
    const chunks = stream.toArray();
    stream.push("a");
    stream.push(null);
    return outcome(chunks).then(text => `new Readable() with no read(), toArray(), push("a") | ${text}`);
  },
  function abortedSignal() {
    const stream = new Readable({ read() {} });
    const reduced = stream.reduce((a, b) => a + b, 0, { signal: AbortSignal.abort() });
    const atReturn = `destroyed at return ${stream.destroyed}`;
    return outcome(reduced).then(text => `reduce() with an aborted signal | ${atReturn} | ${text}`);
  },
  function derived() {
    // The operator is on the stream that map() returns. It reaches the source inside the call.
    const source = new Readable({ read() {} });
    const chunks = source.map(chunk => chunk).toArray();
    source.destroy(new Error("source"));
    return outcome(chunks).then(
      text => `source.map().toArray(), source.destroy(err) | ${text}${whetherUncaught("source")}`,
    );
  },
  function destroyedDuplex() {
    const duplex = Duplex.from(async function* (source) {
      yield* source;
    });
    duplex.write("a");
    const every = duplex.every(() => false);
    duplex.destroy();
    return outcome(every).then(text => `Duplex.from(generator), write("a"), every(() => false), destroy() | ${text}`);
  },
  function replacedThen() {
    const then = Promise.prototype.then;
    let calls = 0;
    Promise.prototype.then = function () {
      calls++;
      return then.apply(this, arguments);
    };
    const stream = new Readable({ read() {} });
    const chunks = stream.toArray();
    Promise.prototype.then = then;
    stream.push(null);
    const isPlain = Object.getPrototypeOf(chunks) === Promise.prototype;
    return outcome(chunks).then(
      text =>
        `toArray() under a replaced Promise.prototype.then | ${calls} calls | a plain Promise ${isPlain} | ${text}`,
    );
  },
  function httpRequest() {
    // The handler ends the response in the tick in which it starts to read the request.
    const { promise, resolve, reject } = Promise.withResolvers();
    const server = http.createServer((request, response) => {
      resolve(outcome(request.toArray().then(chunks => Buffer.concat(chunks).toString())));
      response.end();
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const options = { port: server.address().port, host: "127.0.0.1", method: "POST", agent: false };
      const request = http.request(options, response => response.on("error", reject).resume());
      request.on("error", reject).end("body");
    });
    return promise
      .finally(() => server.close())
      .then(text => `http handler: request.toArray(), response.end() | ${text}`);
  },
];
async function printSettling() {
  for (const row of settling) {
    console.log(await new Promise(resolve => setImmediate(() => resolve(row()))));
  }
}

// Part 3: orders that leave the promise pending, because what the operator reads waits for something that does
// not come. Each row returns that promise. The last lines of the output say what became of it.
const pending = {
  "derived = source.map(), derived.toArray(), derived.destroy(err)"() {
    // destroy() of the derived stream waits for its generator, and the generator waits for the source.
    const source = new Readable({ objectMode: true, read() {} });
    const derived = source.map(chunk => chunk);
    const chunks = derived.toArray();
    derived.destroy(new Error("derived"));
    return chunks;
  },
  "Readable.from(a generator that waits), toArray(), destroy()"() {
    const stream = Readable.from(
      (async function* () {
        yield await new Promise(() => {});
      })(),
    );
    const chunks = stream.toArray();
    stream.destroy();
    return chunks;
  },
  "reduce(fn, 0, { signal }), abort()"() {
    // reduce() looks at the signal when a chunk arrives.
    const controller = new AbortController();
    const stream = new Readable({ read() {} });
    const reduced = stream.reduce((a, b) => a + b, 0, { signal: controller.signal });
    controller.abort();
    return reduced;
  },
  "toArray(), removeAllListeners(), push(null)"() {
    const stream = new Readable({ read() {} });
    const chunks = stream.toArray();
    stream.removeAllListeners();
    stream.push(null);
    return chunks;
  },
  "a read() that gets its source after the call"() {
    // read() ran inside the call and pushed nothing. Nothing calls it again.
    let source;
    const stream = new Readable({
      objectMode: true,
      read() {
        if (source) this.push(source.shift() ?? null);
      },
    });
    const chunks = stream.toArray();
    source = ["a"];
    return chunks;
  },
};
function leavePending() {
  return Object.entries(pending).map(([label, start]) => {
    const row = { label, state: "pending" };
    outcome(start()).then(text => {
      row.state = text;
    });
    return row;
  });
}

destroyInTheTickOfTheCall("top level");
process.nextTick(destroyInTheTickOfTheCall, "nextTick");
setImmediate(async () => {
  destroyInTheTickOfTheCall("setImmediate");
  const left = leavePending();
  await printDestroyed();
  await printSettling();
  for (const { label, state } of left) console.log(`${label} | ${state}`);
});
