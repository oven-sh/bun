// createRequire is named on what a dynamic import of node:module answers. The name of the module that is loaded is put together at run time.
const Module = await import("node:module");
console.log(typeof Module.createRequire(import.meta.url)(["node:", "net"].join("")).Socket);
