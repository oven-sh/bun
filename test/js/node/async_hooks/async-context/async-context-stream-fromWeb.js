process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { Readable } = require("stream");

const asyncLocalStorage = new AsyncLocalStorage();
let failed = false;
let open = 2;

function check(event) {
  if (asyncLocalStorage.getStore()?.test !== "stream.Readable.fromWeb") {
    console.error(`FAIL: Readable.fromWeb ${event} event lost context`);
    failed = true;
  }
}

function closed(event) {
  check(event);
  if (--open === 0) process.exit(failed ? 1 : 0);
}

asyncLocalStorage.run({ test: "stream.Readable.fromWeb" }, () => {
  // More than one read.
  const readable = Readable.fromWeb(new Blob([Buffer.alloc(200000, 120)]).stream());
  readable.on("data", () => check("data"));
  readable.on("end", () => check("end"));
  readable.on("close", () => closed("close"));

  const destroyed = Readable.fromWeb(new Blob([Buffer.alloc(200000, 120)]).stream());
  destroyed.once("data", () => destroyed.destroy(new Error("destroyed")));
  destroyed.on("error", () => check("error after destroy()"));
  destroyed.on("close", () => closed("close after destroy()"));
});
