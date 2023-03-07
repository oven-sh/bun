const Handler = import("./fn");

Handler.then(({ fn }) => {
  console.log(fn(42));
});
