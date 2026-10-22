interface Bag {
  a?: number;
  b?: number;
  c?: number;
  d?: number;
  e?: number;
  f?: number;
}

type Key = keyof Bag;

class Crate {
  declare a?: number;
  declare b?: number;
  declare c?: number;
  declare d?: number;
  declare e?: number;
  declare f?: number;
}

function put(bag: Bag, key: Key, value: number): void {
  switch (key) {
    case "a":
      bag.a = value;
      break;
    case "b":
      bag.b = value;
      break;
    case "c":
      bag.c = value;
      break;
    case "d":
      bag.d = value;
      break;
    case "e":
      bag.e = value;
      break;
    case "f":
      bag.f = value;
      break;
  }
}

function drop(bag: Bag, key: Key): void {
  switch (key) {
    case "a":
      delete bag.a;
      break;
    case "b":
      delete bag.b;
      break;
    case "c":
      delete bag.c;
      break;
    case "d":
      delete bag.d;
      break;
    case "e":
      delete bag.e;
      break;
    case "f":
      delete bag.f;
      break;
  }
}

function permutations(keys: Key[]): Key[][] {
  if (keys.length <= 1) return [keys];
  const all: Key[][] = [];
  for (let i = 0; i < keys.length; i++) {
    const others = [...keys.slice(0, i), ...keys.slice(i + 1)];
    for (const tail of permutations(others)) all.push([keys[i], ...tail]);
  }
  return all;
}

function orders(bag: Bag): string[] {
  let walked = "";
  for (const key in bag) walked += key;
  return [
    Object.keys(bag).join(""),
    walked,
    Object.keys({ ...bag }).join(""),
    Object.entries(bag).map(([key]) => key).join(""),
    JSON.stringify(bag).replaceAll(/[^a-f]/g, ""),
  ];
}

function values(bag: Bag): string {
  return [bag.a, bag.b, bag.c, bag.d, bag.e, bag.f].map(v => v ?? "-").join("");
}

function run(label: string, make: () => Bag): void {
  let wrongOrders = 0;
  let wrongValues = 0;
  let firstWrong = "";
  const all = permutations(["a", "b", "c", "d", "e", "f"]);
  for (const order of all) {
    const bag = make();
    order.forEach((key, index) => put(bag, key, index));
    let expected = order.join("");
    for (const got of orders(bag)) {
      if (got !== expected) {
        wrongOrders++;
        if (firstWrong === "") firstWrong = expected + " came out as " + got;
      }
    }
    drop(bag, order[1]);
    drop(bag, order[4]);
    put(bag, order[4], 7);
    put(bag, order[0], 8);
    put(bag, order[1], 9);
    expected = order[0] + order[2] + order[3] + order[5] + order[4] + order[1];
    for (const got of orders(bag)) {
      if (got !== expected) {
        wrongOrders++;
        if (firstWrong === "") firstWrong = expected + " came out as " + got + " after deletes";
      }
    }
    const wanted: Bag = {};
    order.forEach((key, index) => put(wanted, key, index));
    put(wanted, order[4], 7);
    put(wanted, order[0], 8);
    put(wanted, order[1], 9);
    if (values(bag) !== values(wanted)) wrongValues++;
  }
  console.log(label + ": " + all.length + " orders, " + wrongOrders + " listed wrongly, " + wrongValues + " with wrong values " + firstWrong);
}

run("an empty literal", () => ({}));
run("an instance without fields yet", () => new Crate());
run("an object without a prototype", () => Object.create(null));

const some = permutations(["a", "b", "c"]);
for (const order of some) {
  const started: Bag = { e: 1, c: 2 };
  order.forEach((key, index) => put(started, key, index + 10));
  console.log("begun as e,c then " + order.join("") + ": " + orders(started).join(" ") + " " + values(started));
}

const churned: Bag = {};
let seed = 12345;
const names: Key[] = ["a", "b", "c", "d", "e", "f"];
const shadow: Key[] = [];
for (let step = 0; step < 5000; step++) {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  const key = names[seed % 6];
  const at = shadow.indexOf(key);
  if ((seed >> 8) % 3 === 0) {
    drop(churned, key);
    if (at >= 0) shadow.splice(at, 1);
  } else {
    put(churned, key, step);
    if (at < 0) shadow.push(key);
  }
  if (Object.keys(churned).join("") !== shadow.join("")) {
    console.log("after step " + step + ": " + Object.keys(churned).join("") + " should be " + shadow.join(""));
    break;
  }
}
console.log("5000 stores and deletes on one object: " + orders(churned).join(" ") + " " + shadow.join(""));

export {};
