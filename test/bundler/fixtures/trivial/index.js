const NS = import("./fn.js");

NS.then(({ fn }) => {
  console.log(fn(42));
});
