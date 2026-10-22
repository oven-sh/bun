// A CommonJS body is sloppy unless it says otherwise.
console.log(require("./a.cjs").t, globalThis.implicit);
