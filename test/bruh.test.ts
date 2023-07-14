import { AsyncLocalStorage } from "async_hooks";

const { get, set } = globalThis[Symbol.for("Bun.lazy")]("async_hooks");

test("setTimeout", async () => {
  let resolve: (x: string) => void;
  const promise = new Promise<string>(r => (resolve = r));
  const s = new AsyncLocalStorage<string>();
  s.run("value", () => {
    expect(s.getStore()).toBe("value");
    console.log(3);
    console.log({ x: get() });
    setTimeout(() => {
      console.log(4);
      console.log(s.getStore());
      resolve(s.getStore()!);
    }, 2);
    console.log(5);
  });
  expect(s.getStore()).toBe(undefined);
  expect(await promise).toBe("value");
});
