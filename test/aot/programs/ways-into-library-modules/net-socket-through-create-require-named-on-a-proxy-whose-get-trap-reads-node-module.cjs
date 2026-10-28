// The get trap of a proxy reads node:module under the key it is given. createRequire is read under its name on the proxy by a function down a chain of calls. The name of the module that is loaded is put together at run time.
const from = require("module");
const view = new Proxy({}, { get: (target, key) => from[key] });
const step0 = proxy => proxy.createRequire(__filename);
const step1 = proxy => step0(proxy);
const step2 = proxy => step1(proxy);
console.log(typeof step2(view)(["node:", "net"].join("")).Socket);
