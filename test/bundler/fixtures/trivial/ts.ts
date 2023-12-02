const hi = import("./fn.js");

hi.then(({ fn }) => {
  console.log(fn(42));
});
