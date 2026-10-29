const settled = (promise: Promise<unknown>) =>
  promise.then(
    () => "settled",
    () => "settled",
  );
console.log(await settled((Bun.dns as any).resolve("localhost", "A")));
