enum Color {
  Red,
  Green,
}

const missing: string = Color[999];
console.log(typeof missing);
console.log(missing + "!");
console.log(missing === "");
console.log(missing === undefined);
console.log(`${missing}`);
console.log([missing].length);
console.log(JSON.stringify({ missing }));
console.log(JSON.stringify([missing]));
const index: number = 7;
const byVariable: string = Color[index];
console.log(typeof byVariable);
console.log(byVariable ?? "nothing");
console.log(byVariable || "nothing");
console.log(byVariable ? "truthy" : "falsy");
const there: string = Color[1];
console.log(there.length);
try {
  console.log(missing.length);
} catch (error) {
  console.log(error instanceof TypeError);
}
try {
  console.log(byVariable.toUpperCase());
} catch (error) {
  console.log(error instanceof TypeError);
}

export {};
