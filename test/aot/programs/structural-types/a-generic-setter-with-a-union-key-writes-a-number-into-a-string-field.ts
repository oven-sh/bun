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

interface Person {
  name: string;
  city: string;
  age: number;
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

function describe(p: Person): string {
  return typeof p.name + " " + show(p.name) + ", " + typeof p.city + " " + show(p.city) + ", " + typeof p.age + " " + show(p.age) + ", keys " + Object.keys(p).join() + ", " + JSON.stringify(p);
}

const yes: boolean = process.argv.length > 0;

const p: Person = { name: "ann", city: "oslo", age: 30 };
console.log("before: " + describe(p));
set(p, yes ? "name" : "age", 7);
console.log("an integer in the name: " + describe(p));
attempt("name.length", () => p.name.length);
attempt("name.toUpperCase()", () => p.name.toUpperCase());
attempt("name.charCodeAt(0)", () => p.name.charCodeAt(0));
attempt("name[0]", () => p.name[0]);
attempt("name + city", () => p.name + p.city);
attempt("name + name", () => p.name + p.name);
attempt("name === 'ann'", () => p.name === "ann");
attempt("name < city", () => p.name < p.city);
attempt("a template", () => `<${p.name}>`);
attempt("name.toString()", () => p.name.toString());
attempt("name.concat", () => p.name.concat("!"));
attempt("spread", () => [...p.name]);
attempt("for of", () => {
  let count = 0;
  for (const letter of p.name) count += letter.length;
  return count;
});
attempt("a key", () => ({ ann: 1, "7": 2 })[p.name === "ann" ? "ann" : "7"]);
attempt("name += '!'", () => (p.name += "!"));
console.log("after +=: " + describe(p));

set(p, yes ? "city" : "age", 2.5);
console.log("a fraction in the city: " + describe(p));
attempt("city.length", () => p.city.length);
attempt("city.slice(1)", () => p.city.slice(1));
attempt("city + 1", () => p.city + 1);
attempt("city.toString()", () => p.city.toString());

set(p, yes ? "city" : "age", -0);
console.log("minus zero in the city: " + describe(p));
attempt("city is falsy", () => !p.city);
attempt("city || 'none'", () => p.city || "none");
attempt("city ?? 'none'", () => p.city ?? "none");

set(p, yes ? "city" : "age", NaN);
console.log("not a number in the city: " + describe(p));
attempt("city === city", () => p.city === p.city);
attempt("city.length", () => p.city.length);

set(p, "name", "bob");
set(p, "city", "rome");
console.log("honest again: " + describe(p) + " " + p.name.toUpperCase() + p.city.length);

export {};
