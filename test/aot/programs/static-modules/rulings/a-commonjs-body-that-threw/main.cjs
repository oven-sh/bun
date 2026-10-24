// A CommonJS body that throws under a `try`, required three times. Under `bun run` the next require() runs the body again. In an executable the body runs at most once, and every later require() throws the same error. The expected output is written down.
const attempt = () => {
  try {
    return JSON.stringify(require("./bad.cjs"));
  } catch (error) {
    return error.message;
  }
};
console.log(attempt(), attempt(), attempt(), globalThis.n);
