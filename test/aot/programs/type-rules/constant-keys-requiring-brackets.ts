class Vault {
  private secret = "hidden";
  protected guarded = "kept";
  private open(): string {
    return this.secret + "!";
  }
}
const vault = new Vault();
console.log(vault["secret"], vault["guarded"], vault["open"]());

function pick<T extends { size: number }>(from: T): T["size"] {
  return from["size"];
}
console.log(pick({ size: 3, more: true }));

function store<T extends { size: number }>(into: T, size: T["size"]): T {
  into["size"] = size;
  return into;
}
console.log(store({ size: 3 }, 4)["size"]);

const table: Record<string, number> = { one: 1 };
console.log(table["one"], table["two"]);

function nameOf(it: { name: string } | { name: number }): number {
  return typeof it["name"] === "string" ? it["name"].length : it["name"] + 1;
}
console.log(nameOf({ name: "four" }), nameOf({ name: 4 }));

function narrowed(it: { kind: "a"; a: number } | { kind: "b"; b: string }): number | string {
  return it["kind"] === "a" ? it.a : it["b"];
}
console.log(narrowed({ kind: "a", a: 1 }), narrowed({ kind: "b", b: "two" }));

enum Color {
  Red,
  Green,
}
console.log(Color["Green"], Color[Color["Green"]]);

const enum Flag {
  On = 1,
}
console.log(Flag["On"]);

class Late {
  value!: number;
  constructor() {
    console.log(this["value"]);
    this["value"] = 1;
  }
}
console.log(new Late()["value"]);

const loose: any = { deep: { deeper: 5 } };
console.log(loose["deep"]["deeper"], loose["absent"]);

const tuple: [number, string] = [1, "two"];
console.log(tuple["length"], tuple["0"], tuple["1"]);

const byName: Record<string, number> = { one: 1 };
console.log(byName["one"]! < 2, byName["two"]! < 2, byName["two"]! + 1);
console.log(byName.one! < 2, byName.two! < 2, byName.two! + 1);
