// node:module comes out of an import() that is awaited. A member of it is read under a key that is put together at run time and called on the spot, if there is one. The key picks createRequire.
const Module = await import("node:module");
console.log(typeof Module[["create", "Require"].join("")]?.(import.meta.url)(["node:", "net"].join("")).Socket);
