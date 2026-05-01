var foo = true;

globalThis.TRUE_BUT_WE_CANT_TREESHAKE_IT = true;
if (globalThis.TRUE_BUT_WE_CANT_TREESHAKE_IT) {
  var { foo } = { foo: false };
}

export function test() {
  console.assert(foo === false, "foo should be false");
  return testDone(import.meta.url);
}
