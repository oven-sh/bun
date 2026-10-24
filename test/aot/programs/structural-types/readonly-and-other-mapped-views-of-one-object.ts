function attempt(label: string, body: () => unknown): void {
  try {
    console.log(label + ": " + String(body()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Cart {
  items: number;
  price: number;
  note: string;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Nullable<T> = { [K in keyof T]: T[K] | null };
type Boxed<T> = { [K in keyof T]: { value: T[K] } };
type Getters<T> = { [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K] };

function cost(c: Readonly<Cart>): number {
  return c.items * c.price;
}

function costAround(c: Readonly<Cart>, act: () => void): string {
  const before = c.items * c.price;
  act();
  return before + " -> " + c.items * c.price;
}

function restock(c: Mutable<Readonly<Cart>>, items: number): number {
  c.items = items;
  return c.items;
}

const cart: Cart = { items: 2, price: 5, note: "open" };
const view: Readonly<Cart> = cart;
console.log("a view of an open object: " + cost(view));
cart.items = 3;
console.log("the object changed under the view: " + cost(view) + " " + view.items);
console.log("around a call: " + costAround(view, () => { cart.price = 7; }));
attempt("the view made mutable again", () => restock(view, 4) + " " + cart.items);

const frozen = Object.freeze({ items: 2, price: 5, note: "frozen" });
console.log("a frozen object: " + cost(frozen));
attempt("made mutable by its type only", () => restock(frozen, 4));
console.log("it holds: " + JSON.stringify(frozen));

let sum = 0;
for (let i = 0; i < 2000; i++) {
  sum += cost(view);
  if (i === 999) cart.items = 1;
}
console.log("changed in the middle of 2000 reads: " + sum);

const nullable: Nullable<Cart> = cart;
nullable.note = null;
nullable.items = null;
console.log("null stored through a wider view: " + cart.note + " " + cart.items + " " + typeof cart.note + " " + cost(cart) + " " + (cart.items + 1));
attempt("a method of the string that is null now", () => cart.note.length);
cart.items = 2;
cart.note = "back";

const boxed: Boxed<Cart> = { price: { value: 1 }, note: { value: "n" }, items: { value: 2 } };
console.log("a mapped type keeps the literal's order: " + Object.keys(boxed).join() + " " + JSON.stringify(boxed));

class Shop {
  constructor(private cart: Cart) {}
  getItems(): number {
    return this.cart.items;
  }
  getPrice(): number {
    return this.cart.price;
  }
  getNote(): string {
    return this.cart.note;
  }
}

function describe(g: Getters<Cart>): string {
  return g.getItems() + " " + g.getPrice() + " " + g.getNote() + " / " + Object.keys(g).join();
}

const literalGetters: Getters<Cart> = { getNote: () => "literal", getPrice: () => 1, getItems: () => 0 };
console.log("renamed keys, a class: " + describe(new Shop(cart)));
console.log("renamed keys, a literal: " + describe(literalGetters));

const scores: Record<string, number> = { a: 1 };
const fixedScores: Readonly<Record<string, number>> = scores;
scores.b = 2;
delete scores.a;
console.log("a readonly record changes too: " + JSON.stringify(fixedScores) + " " + fixedScores.a + " " + fixedScores.b);

const map = new Map<string, number>([["a", 1]]);
const fixedMap: ReadonlyMap<string, number> = map;
const sizeOf = (m: ReadonlyMap<string, number>) => m.size;
console.log("a readonly map, before: " + sizeOf(fixedMap) + " " + fixedMap.get("b"));
map.set("b", 2);
console.log("a readonly map, after: " + sizeOf(fixedMap) + " " + fixedMap.get("b"));

const deep: Readonly<{ inner: Cart }> = { inner: cart };
deep.inner.items = 9;
console.log("readonly is one level deep: " + cart.items);

const views: Readonly<Cart>[] = [cart, frozen, { note: "third", price: 1, items: 1 }];
console.log("elements: " + views.map(cost).join() + " " + views.map(v => Object.keys(v).join("")).join());
attempt("all restocked", () => views.map(v => restock(v, 1)).join());
console.log("afterwards: " + views.map(cost).join());

export {};
