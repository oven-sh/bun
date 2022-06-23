var foo = () => {
  var D = (i, r) => () => (r || i((r = { exports: {} }).exports, r), r.exports);
  return D;
};
export function test() {
  foo();
  testDone(import.meta.url);
}

//# sourceMappingURL=http://localhost:8080/forbid-in-is-correct.js.map
