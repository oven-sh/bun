interface Address {
  street: string;
  city: string;
  zip: number;
}

function state(a: Partial<Address>): string {
  const walked: string[] = [];
  for (const key in a) walked.push(key);
  return Object.keys(a).join() + " | " + walked.join() + " | " + JSON.stringify(a) + " | " + JSON.stringify({ ...a });
}

function line(a: Partial<Address>): string {
  return (a.street ?? "?") + ", " + (a.city ?? "?") + " " + (a.zip ?? -1);
}

function count(a: Partial<Address>): number {
  let n = 0;
  if (a.street !== undefined) n++;
  if (a.city !== undefined) n++;
  if (a.zip !== undefined) n++;
  return n;
}

function present(a: Partial<Address>): string {
  return ("street" in a) + " " + ("city" in a) + " " + ("zip" in a);
}

function complete(a: Partial<Address>): Address {
  return { street: a.street ?? "none", city: a.city ?? "none", zip: a.zip ?? 0 };
}

const orders: (keyof Address)[][] = [
  ["street", "city", "zip"],
  ["zip", "city", "street"],
  ["city", "zip", "street"],
  ["zip"],
  [],
];

const source: Address = { street: "main", city: "town", zip: 12345 };

function put<K extends keyof Address>(target: Partial<Address>, key: K): void {
  target[key] = source[key];
}

for (const order of orders) {
  const a: Partial<Address> = {};
  for (const key of order) put(a, key);
  const name = order.join("+") || "nothing";
  console.log(name + ": " + state(a));
  console.log(name + ": " + line(a) + " / " + count(a) + " / " + present(a));
  console.log(name + ", completed: " + JSON.stringify(complete(a)));
}

const whole: Partial<Address> = source;
console.log("a whole address: " + state(whole) + " / " + line(whole));
const extra = { country: "x", zip: 1 };
const withExtra: Partial<Address> = extra;
console.log("with an extra: " + state(withExtra) + " / " + line(withExtra));
const undefinedOnes: Partial<Address> = { city: undefined, street: undefined };
console.log("undefined ones: " + state(undefinedOnes) + " / " + count(undefinedOnes) + " / " + present(undefinedOnes));

class Form {
  draft: Partial<Address> = {};
  history: Partial<Address>[] = [];
  set<K extends keyof Address>(key: K, value: Address[K]): this {
    this.history.push({ ...this.draft });
    this.draft[key] = value;
    return this;
  }
  clear(key: keyof Address): this {
    this.history.push({ ...this.draft });
    delete this.draft[key];
    return this;
  }
}

const form = new Form().set("zip", 1).set("street", "s").clear("zip").set("city", "c").set("zip", 2);
console.log("a form: " + state(form.draft));
console.log("its history: " + JSON.stringify(form.history));

let total = 0;
for (let i = 0; i < 2000; i++) total += count(source) + line(source).length;
console.log("2000 whole ones: " + total);
console.log("then: " + count({}) + " " + line({}) + " | " + count({ zip: 0 }) + " " + line({ zip: 0 }) + " | " + count(withExtra) + " " + line(withExtra));

const merged = [{ street: "a" }, { zip: 2 }, { city: "c", street: "b" }].reduce<Partial<Address>>((all, part) => ({ ...all, ...part }), {});
console.log("merged parts: " + state(merged));

export {};
