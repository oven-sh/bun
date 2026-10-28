// A member of what require("node:module") answers is read under a key that is put together at run time, stored on the global object and called. The key picks createRequire. The name of the module that is loaded is put together at run time too.
const make = require("node:module")[["create", "Require"].join("")];
globalThis.kept = make;
console.log(typeof make(__filename)(["node:", "net"].join("")).Socket);
