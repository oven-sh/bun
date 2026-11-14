// Bun.JSONC
console.log(
  JSON.stringify(
    Bun.JSONC.parse(`{ // a comment
  "a": 1, /* another */ "b": [true, null,], }`),
  ),
);
try {
  Bun.JSONC.parse("{");
} catch (error) {
  console.log((error as Error).name);
}
