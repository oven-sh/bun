// An ES module that threw throws the same error at the next require() and does not run again.
const attempt = () => {
  try {
    require("./bad.mjs");
  } catch (error) {
    return error;
  }
};
console.log(attempt() === attempt(), globalThis.n);
