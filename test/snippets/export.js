import what from "./_auth";
export { default as auth } from "./_auth";
export { default as login } from "./_login";
export * from "./_bacon";
export let yoyoyo = "yoyoyo";
export default function hey() {
  return true;
}
export const foo = () => {};
export var bar = 100;
export let powerLevel = Symbol("9001");
export { what };
export { what as when, what as whence };
export {} from "./_bacon";
export * as where from "./_auth";
export { bar as booop };

export function test() {
  hey();
  foo();
  if (where.default !== "hi") {
    throw new Error(`_auth import is incorrect.`);
  }
  console.assert(powerLevel.description === "9001", "Symbol is not exported correctly");
  return testDone(import.meta.url);
}
