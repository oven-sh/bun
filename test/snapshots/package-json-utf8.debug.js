import pkg from "http://localhost:8080/utf8-package-json.json";
export function test() {
  console.assert(!!pkg.author);
  return testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/package-json-utf8.js.map
