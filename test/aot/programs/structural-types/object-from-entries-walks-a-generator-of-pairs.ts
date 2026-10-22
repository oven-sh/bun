function* pairs(): Generator<[string, number], void, void> {
  yield ["first", 1];
  yield ["second", 2];
}

console.log(JSON.stringify(Object.fromEntries(pairs())));
