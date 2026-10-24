// The error of a CommonJS body that threw is kept: a later require() throws the same object, as require() of an ES module that threw does. Under `bun run` the body runs again and makes a new error. The expected output is written down.
const attempt = () => {
  try {
    require("./bad.cjs");
  } catch (error) {
    return error;
  }
};
console.log(attempt() === attempt(), globalThis.n);
