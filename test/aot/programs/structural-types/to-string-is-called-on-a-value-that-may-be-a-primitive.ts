type Printable = { toString(): string };
function byMethod(value: Printable): string {
  return value.toString();
}
const values: Printable[] = [{ toString: () => "literal" }, 7, "text", true, 10n, Symbol("s"), [1, 2]];
for (const value of values) console.log(byMethod(value));
