function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (
    (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}"
  );
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class A34 {
  name = "a34";
}
class D34 extends A34 {
  legs = 4;
  bark(): string {
    return "woof " + this.legs;
  }
}
class C34 extends A34 {
  lives = "nine";
}
class S34 {
  street = "main";
  pet: D34 = new D34();
  number = 12;
  legs(): number {
    return this.pet.legs + 1;
  }
}
type T34 = { pet: A34 };
function adopt34(t: T34): void {
  t.pet = new C34();
}
function legs34(home: S34): number {
  return home.pet.legs + 1;
}
function widen34<X extends T34>(x: X): T34 {
  return x;
}
function via34(s: S34): T34 {
  return widen34(s);
}

{
  const home = new S34();
  const t = await via34(home);
  attempt("a constrained type parameter: the same object", () => t === home);
  adopt34(t);
  attempt("a constrained type parameter: legs + 1", () => legs34(home));
  attempt("a constrained type parameter: its own method", () => home.legs());
  attempt("a constrained type parameter: bark", () => home.pet.bark());
  attempt("a constrained type parameter: the other fields", () => [
    home.street,
    home.number,
    home.pet.name,
    Object.keys(home),
  ]);
}
export {};
