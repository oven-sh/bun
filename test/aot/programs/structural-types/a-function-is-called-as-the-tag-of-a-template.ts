function tag(strings: TemplateStringsArray, value: number): string {
  return strings[0] + value;
}
console.log("gives " + tag`-${5}`);
