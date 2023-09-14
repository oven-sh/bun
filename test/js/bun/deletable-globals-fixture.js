const { ok, strictEqual: eql } = require("assert");

const globals = ["Blob", "fetch", "Headers", "Request", "Response", "setTimeout", "clearTimeout", "setInterval"];
for (let name of globals) {
  ok(delete globalThis[name]);
  eql(globalThis[name], undefined);
  globalThis[name] = 123;
  eql(globalThis[name], 123);
}
console.log("--pass--");
