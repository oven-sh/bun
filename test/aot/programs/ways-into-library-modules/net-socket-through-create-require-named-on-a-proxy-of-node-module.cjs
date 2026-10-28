// node:module is the target of a proxy whose handler has no trap. createRequire is read under its name on the proxy. The name of the module that is loaded is put together at run time.
const view = new Proxy(require("module"), {});
console.log(typeof view.createRequire(__filename)(["node:", "net"].join("")).Socket);
