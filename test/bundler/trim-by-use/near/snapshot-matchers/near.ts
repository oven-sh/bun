const { expect } = (Bun as any).jest(import.meta.path);
try {
  expect(1).toBe(1);
  console.log("toBe ran");
  expect({ a: 1 }).toMatchSnapshot();
  console.log("snapshot ran");
} catch (error) {
  console.log("threw", (error as Error).message.slice(0, 60));
}
