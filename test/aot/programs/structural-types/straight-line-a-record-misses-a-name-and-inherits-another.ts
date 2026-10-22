const ages: Record<string, number> = { ann: 30 };
const missing: number = ages.bob;
console.log(typeof missing);
console.log(missing + 1);
console.log(missing | 0);
console.log(missing === 0);
console.log(missing > 0);
console.log(missing ?? -1);
console.log(JSON.stringify({ missing }));
const word: string = "constructor";
const inherited: number = ages[word];
console.log(typeof inherited);
console.log(inherited * 2);
console.log(inherited === inherited);
console.log(typeof (inherited + 1));
const parent: number = ages["__proto__"];
console.log(typeof parent);
console.log(parent * 2);
let total = 0;
for (const name of ["ann", "bob"]) total += ages[name];
console.log(total);
ages.bob++;
console.log(ages.bob);
console.log(Object.keys(ages).join());
try {
  console.log(missing.toFixed(1));
} catch (error) {
  console.log(error instanceof TypeError);
}

const names: Record<string, string> = { a: "ann" };
const none: string = names.b;
console.log(typeof none);
console.log(none + "!");
console.log(none === "");
try {
  console.log(none.length);
} catch (error) {
  console.log(error instanceof TypeError);
}

const tasks: Record<string, () => number> = { one: () => 1 };
console.log(typeof tasks.two);
try {
  console.log(tasks.two());
} catch (error) {
  console.log(error instanceof TypeError);
}

export {};
