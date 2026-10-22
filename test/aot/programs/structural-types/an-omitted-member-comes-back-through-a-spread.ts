function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
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

interface User {
  id: number;
  name: string;
  secret: string;
}

function publicPart(u: User): Omit<User, "secret"> {
  return u;
}

function withoutId(u: User): Omit<User, "id"> {
  return u;
}

const user: User = { id: 7, name: "ann", secret: "hidden" };

const shown = publicPart(user);
console.log("what is left after Omit: keys " + Object.keys(shown).join() + ", " + JSON.stringify(shown) + ", 'secret' in it: " + ("secret" in shown));

const relabeled: { id: string; name: string; secret: string } = { id: "seven", ...withoutId(user) };
console.log("id: a string by type: " + typeof relabeled.id + " " + show(relabeled.id) + ", keys " + Object.keys(relabeled).join() + ", " + JSON.stringify(relabeled));
attempt("id.toUpperCase()", () => relabeled.id.toUpperCase());
attempt("id.length", () => relabeled.id.length);
attempt("id + '!'", () => relabeled.id + "!");
attempt("id === 'seven'", () => relabeled.id === "seven");

const counted: { secret: number; id: number; name: string } = { secret: 1, ...publicPart(user) };
console.log("secret: a number by type: " + typeof counted.secret + " " + show(counted.secret) + ", keys " + Object.keys(counted).join() + ", " + JSON.stringify(counted));
attempt("secret + 1", () => counted.secret + 1);
attempt("secret * 2", () => counted.secret * 2);
attempt("secret.toFixed(0)", () => counted.secret.toFixed(0));
attempt("secret | 0", () => counted.secret | 0);

function relabel(part: Omit<User, "id">, id: () => number): { id: () => number; name: string } {
  return { id, ...part };
}
const called = relabel(user, () => 1);
console.log("id: a function by type: " + typeof called.id + ", keys " + Object.keys(called).join());
attempt("id()", () => called.id());

const after: { id: string; name: string; secret: string } = { ...withoutId(user), id: "last wins" };
console.log("the honest order: " + typeof after.id + " " + show(after.id) + ", keys " + Object.keys(after).join());
attempt("id.toUpperCase()", () => after.id.toUpperCase());

let total = 0;
for (let i = 0; i < 2000; i++) {
  const honest: Omit<User, "id"> = { name: "n" + i, secret: "s" };
  const built: { id: string; name: string; secret: string } = { id: "i" + i, ...honest };
  total += built.id.length + built.name.length;
}
console.log("2000 honest rounds: " + total);
const late: { id: string; name: string; secret: string } = { id: "late", ...withoutId(user) };
attempt("after them: id.length", () => late.id.length);
attempt("after them: id.toUpperCase()", () => late.id.toUpperCase());

export {};
