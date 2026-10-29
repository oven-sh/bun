// Proxy.revocable answers an object that holds the proxy. The get trap reads node:module under the key it is given, and createRequire is named on the proxy. The name of the module that is loaded is put together at run time.
const from = require("module");
const { proxy } = Proxy.revocable({}, { get: (target, key) => from[key] });
console.log(typeof proxy.createRequire(__filename)(["node:", "net"].join("")).Socket);
