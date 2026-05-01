import pkg from "./utf8-package-json.json";

export function test() {
  console.assert(!!pkg.author);
  return testDone(import.meta.url);
}
