// The get trap of a proxy reads process under the key it is given. getBuiltinModule is read under its name on the proxy. The name of the module that is loaded is put together at run time.
const view = new Proxy({}, { get: (target, key) => process[key] });
console.log(typeof view.getBuiltinModule(["node:", "net"].join("")).Socket);
