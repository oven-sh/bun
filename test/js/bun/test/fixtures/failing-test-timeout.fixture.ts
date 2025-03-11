jest.setTimeout(5);
test.failing("timeouts still count as failures", async () => {
  await Bun.sleep(1000);
});
