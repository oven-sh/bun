import what from "http://localhost:8080/_auth.js";
export { default as auth } from "http://localhost:8080/_auth.js";
export { default as login } from "http://localhost:8080/_login.js";
export * from "http://localhost:8080/_bacon.js";
export let yoyoyo = "yoyoyo";
export default function hey() {
  return true;
}
export const foo = () => {
};
export var bar = 100;
export let powerLevel = Symbol("9001");

export { what };
export { what as when, what as whence };
export {  } from "http://localhost:8080/_bacon.js";
import * as where from "http://localhost:8080/_auth.js";

export { where };
export { bar as booop };
export function test() {
  hey();
  foo();
  if (where.default !== "hi")
    throw new Error(`_auth import is incorrect.`);
  console.assert(powerLevel.description === "9001", "Symbol is not exported correctly");
  return testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/export.js.map
