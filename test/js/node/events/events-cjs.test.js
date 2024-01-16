test("in cjs, events is callable", () => {
  const EventEmitter = require("events");
  new EventEmitter();
});

test("events.on", async () => {
  const { on, EventEmitter } = require("node:events");
  const process = require("node:process");

  const ee = new EventEmitter();
  const output = [];

  // Emit later on
  process.nextTick(() => {
    ee.emit("foo", "bar");
    ee.emit("foo", 42);
  });

  setTimeout(() => {
    ee.emit("error", "DONE");
  }, 1_000);

  try {
    for await (const event of on(ee, "foo")) {
      output.push([1, event]);
    }
  } catch (error) {
    output.push([2, error]);
  }

  expect(output).toEqual([
    [1, ["bar"]],
    [1, [42]],
    [2, "DONE"],
  ]);
});

test("events.on with AbortController", () => {
  const { on, EventEmitter } = require("node:events");

  const ac = new AbortController();
  const ee = new EventEmitter();
  const output = [];

  process.nextTick(() => {
    ee.emit("foo", "bar");
    ee.emit("foo", 42);
  });
  (async () => {
    try {
      for await (const event of on(ee, "foo", { signal: ac.signal })) {
        output.push([1, event]);
      }
      console.log("unreachable");
    } catch (error) {
      const { code, message } = error;
      output.push([2, { code, message }]);

      expect(output).toEqual([
        [1, ["bar"]],
        [1, [42]],
        [
          2,
          {
            code: "ABORT_ERR",
            message: "The operation was aborted",
          },
        ],
      ]);
    }
  })();

  process.nextTick(() => ac.abort());
});

test("readline.createInterface", async () => {
  const { createInterface } = require("node:readline");
  const { createReadStream } = require("node:fs");
  const path = require("node:path");

  const fpath = path.join(__filename, "..", "..", "child_process", "fixtures", "child-process-echo-options.js");
  console.log(fpath);
  const interfaced = createInterface(createReadStream(fpath));
  const output = [];

  try {
    for await (const line of interfaced) {
      output.push(line);
    }
  } catch (e) {
    expect(output).toBe(["// TODO - bun has no `send` method in the process", "process?.send({ env: process.env });"]);
  }
});
