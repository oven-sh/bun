type Either = { a: number; b?: never } | { b: string; a?: never };

function which(value: Either): string {
  if (value.a !== undefined) return "a " + value.a + ", b is undefined: " + (value.b === undefined);
  return "b " + value.b + ", a is undefined: " + (value.a === undefined);
}

const first: Either = { a: 1 };
const second: Either = { b: "two" };
console.log(which(first));
console.log(which(second));
const wide: { a: number; b?: unknown } = { a: 3 };
const narrow: { a: number; b?: never } = { a: 4 };
const alias: { a: number; b?: unknown } = narrow;
alias.b = "both";
wide.b = "unused";
console.log(which(narrow));
console.log(Object.keys(narrow).join(), String(narrow.b), typeof narrow.b);
