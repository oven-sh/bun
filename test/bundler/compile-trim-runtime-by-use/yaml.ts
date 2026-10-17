const value = Bun.YAML.parse(`
name: trim
list: [1, 2, 3]
anchor: &a { deep: true }
alias: *a
text: |
  two
  lines
`);
console.log(JSON.stringify(value));
console.log(Bun.YAML.stringify({ a: [1, { b: "two" }], c: null }, null, 2));
