// process is handed to a function that reads a member of it with Reflect.get, and node:util is loaded. node:async_hooks, which nothing else names, is found through process.getBuiltinModule, called with call by the handler of a promise, under a name put together at run time.
const read = (holder, key) => typeof Reflect.get(holder, key);
console.log(read(process, "loadEnvFile"));
require("node:util");
const name = ["node:", "async_hooks"].join("");
const show = whole => console.log(typeof whole, typeof whole.AsyncLocalStorage);
Promise.resolve({ load: process.getBuiltinModule }).then(holder => show(holder.load.call(process, name)));
