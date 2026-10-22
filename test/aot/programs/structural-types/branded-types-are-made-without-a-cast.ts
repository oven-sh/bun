function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return "{" + Object.entries(value).map(([key, held]) => key + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

type UserId = string & { readonly __brand: "UserId" };
type Meters = number & { readonly unit: "m" };
type Checked = { value: number } & { readonly checked: true };

function isUserId(text: string): text is UserId {
  return text.startsWith("u");
}
function isMeters(n: number): n is Meters {
  return n >= 0;
}
function assertChecked(box: { value: number }): asserts box is Checked {
  if (box.value < 0) throw new RangeError("negative");
}
function brand(text: string): UserId;
function brand(text: unknown): unknown {
  return text;
}
function measure(n: number): Meters;
function measure(n: unknown): unknown {
  return n;
}
function same<T>(value: T): T {
  return value;
}

function brandOf(id: UserId): "UserId" {
  return id.__brand;
}
function unitOf(length: Meters): "m" {
  return length.unit;
}
function checkedOf(box: Checked): true {
  return box.checked;
}
function greet(id: UserId): string {
  return "hello " + id + " " + id.length + " " + id.toUpperCase();
}
function twice(length: Meters): number {
  return length * 2;
}

attempt("a text by a guard", () => {
  const text: string = ["u", "7"].join("");
  if (!isUserId(text)) return "refused";
  return [text, typeof text, greet(text), brandOf(text), typeof brandOf(text), brandOf(text) === "UserId"];
});
attempt("a text by an overload", () => {
  const id = brand("u8");
  return [id, greet(id), brandOf(id), id.__brand === "UserId", "" + id.__brand];
});
attempt("the length of the brand", () => brandOf(brand("u9")).length);
attempt("a number by a guard", () => {
  const n: number = 2.5;
  if (!isMeters(n)) return "refused";
  return [n, twice(n), unitOf(n), typeof unitOf(n), unitOf(n) === "m"];
});
attempt("a number by an overload", () => {
  const length = measure(-0);
  return [length, twice(length), unitOf(length), 1 / length];
});
attempt("an object by an assertion", () => {
  const box = { value: 3 };
  assertChecked(box);
  return [box.value, checkedOf(box), box.checked ? "checked" : "unchecked", Object.keys(box), "checked" in box];
});
attempt("through a generic function", () => {
  const id = same(brand("u1"));
  const ids: UserId[] = [id, same<UserId>(brand("u2"))];
  return [ids, ids.map(brandOf), ids.map(greet)];
});
attempt("as keys", () => {
  const table: Record<UserId, number> = {};
  table[brand("u1")] = 1;
  const plain: Record<string, number> = table;
  return [plain["u1"], table[brand("u" + 1)], table[brand("u2")], Object.keys(table)];
});
let warm = 0;
for (let i = 0; i < 2000; i++) warm += greet(brand("u" + (i % 10))).length + twice(measure(i));
console.log("2000 rounds", warm);
