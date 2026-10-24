// A function takes { a; b }: a literal whose a is a getter and an object out of JSON.parse() both come to it, and each keeps the kind of property that it was made with.
type T = { a: number; b: number };
function sum(v: T): number { return v.a + v.b; }
function made(n: number): T { return { get a() { return n + 7; }, b: 2 }; }
let total = 0;
for (let n = 0; n < 2000; n++) {
  const parsed = JSON.parse('{"a":' + n + ',"b":2}');
  total += sum(parsed) + sum(made(n));
  if (n < 3) console.log(JSON.stringify(parsed), JSON.stringify(made(n)), Object.getOwnPropertyDescriptor(parsed, "a"), typeof Object.getOwnPropertyDescriptor(made(n), "a")!.get);
}
console.log(total);
