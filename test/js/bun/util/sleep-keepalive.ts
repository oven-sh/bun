(async () => {
  await Bun.sleep(10);
  console.log("event loop was not killed");
})();
