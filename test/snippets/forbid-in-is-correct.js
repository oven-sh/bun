var foo = () => {
  // prettier-ignore
  var D = (i, r) => () => (r || i((r = { exports: {} }).exports, r), r.exports);
  return D;
};

export function test() {
  foo();
  testDone(import.meta.url);
}
