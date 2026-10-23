// A script that declares `let process` or `let setTimeout` at its top level shadows the global for the program's own code, not for Bun's built-in modules. Where compiled code takes the global for a constant the declaration is refused (closed-world/script-declarations-over-constant-globals) and nobody sees a binding.
const vm = require("node:vm");
const print = console.log;
const cancel = clearTimeout;

function tell(name, f) {
  try {
    print(name + ": " + f());
  } catch (e) {
    print(name + ": " + e.name + ": " + e.message);
  }
}

const typesTheProgramSees = {
  process: () => typeof process, Buffer: () => typeof Buffer, setTimeout: () => typeof setTimeout, queueMicrotask: () => typeof queueMicrotask, URL: () => typeof URL, TextDecoder: () => typeof TextDecoder,
  AbortController: () => typeof AbortController, performance: () => typeof performance, setImmediate: () => typeof setImmediate, clearTimeout: () => typeof clearTimeout, console: () => typeof console,
};
for (const name in typesTheProgramSees) {
  tell("let " + name, () => {
    let declared = "undefined";
    try {
      vm.runInThisContext("let " + name);
    } catch (error) {
      if (error.name !== "SyntaxError") throw error;
      declared = typeof globalThis[name];
    }
    const seen = typesTheProgramSees[name]();
    return seen === declared ? "the program sees what was declared" : "the program sees " + seen;
  });
}

tell("globalThis is as it was", () => [typeof globalThis.process, typeof globalThis.setTimeout, typeof globalThis.URL].join());
tell("fs", () => typeof require("node:fs").readFileSync(__filename, "utf8"));
tell("stream", () => {
  const readable = require("node:stream").Readable.from(["x"]);
  readable.on("data", () => {});
  return "made";
});
tell("events", () => {
  const emitter = new (require("node:events").EventEmitter)();
  emitter.on("x", () => {});
  return emitter.emit("x");
});
tell("os", () => typeof require("node:os").hostname());
tell("path", () => require("node:path").resolve("x").length > 1);
const echo = require("node:os").platform() === "win32" ? ["cmd.exe", ["/c", "echo hi"]] : ["/bin/echo", ["hi"]];
tell("child_process", () => require("node:child_process").spawnSync(echo[0], echo[1]).stdout.toString().trim());
tell("timers", () => {
  cancel(require("node:timers").setTimeout(() => {}, 1));
  return "set";
});
tell("url", () => require("node:url").pathToFileURL("/x").href.replace("/C:", ""));
tell("string_decoder", () => new (require("node:string_decoder").StringDecoder)("utf8").write(new Uint8Array([104, 105])));
tell("zlib", () => require("node:zlib").gunzipSync(require("node:zlib").gzipSync("hi")).toString());
tell("crypto", () => require("node:crypto").createHash("sha1").update("x").digest("hex").length);
tell("util", () => require("node:util").format("%s %o", "a", { b: 1 }));
tell("assert", () => {
  require("node:assert").strictEqual(1, 1);
  return "ok";
});
tell("http", () => typeof require("node:http").createServer().listen);
tell("a stream that ends", () => {
  new (require("node:stream").PassThrough)().end("x");
  return "ended";
});
