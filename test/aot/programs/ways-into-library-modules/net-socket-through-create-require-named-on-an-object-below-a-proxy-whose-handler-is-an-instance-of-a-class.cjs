// The handler of a proxy is an instance of a class whose get method reads node:module, which it loads at the first read, under the key it is given. createRequire is read under its name on an object whose prototype is the proxy. The name of the module that is loaded is put together at run time.
class Handler {
  #loaded;
  get(target, key) {
    return (this.#loaded ??= require("node:module"))[key];
  }
}
const heir = Object.create(new Proxy({}, new Handler()));
console.log(typeof heir.createRequire(__filename)(["node:", "net"].join("")).Socket);
