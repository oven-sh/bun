import { promisify } from "util";

test("abc", () => {
  const setTimeout = promisify(globalThis.setTimeout);
  setTimeout(1, "ok").then(console.log);
});
