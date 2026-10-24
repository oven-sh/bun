// A module that throws the first time and would not the second, read by names. Under `bun run` the second require() runs the body again. In an executable it throws the first error again. The expected output is written down.
const attempt = () => {
  try {
    const bad = require("./bad.cjs");
    return [bad.early, bad.late].join();
  } catch (error) {
    return error.message;
  }
};
console.log(attempt());
globalThis.ok = true;
console.log(attempt());
