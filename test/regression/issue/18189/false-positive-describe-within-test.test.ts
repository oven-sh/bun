let count = 0;

afterAll(() => {
  expect(count).toBe(0); // TODO: this should be 1
});

async function main() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  describe("group", () => {
    // this should execute but it doesn't
    count += 1;
  });
}
main();
