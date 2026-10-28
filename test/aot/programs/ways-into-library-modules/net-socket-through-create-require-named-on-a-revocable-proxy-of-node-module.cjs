// Proxy.revocable answers an object that holds a proxy of node:module and the function that revokes it. createRequire is named on the proxy. The name of the module that is loaded is put together at run time.
const pair = Proxy.revocable(require("module"), {});
console.log(Object.keys(pair).join(), typeof pair.proxy.createRequire(__filename)(["node:", "net"].join("")).Socket);
pair.revoke();
try {
  pair.proxy.createRequire;
} catch (error) {
  console.log(error.constructor.name);
}
