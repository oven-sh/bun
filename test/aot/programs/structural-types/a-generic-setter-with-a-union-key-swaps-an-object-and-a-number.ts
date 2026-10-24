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

class Owner {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  greet(): string {
    return "hello " + this.name;
  }
}

interface Pet {
  id: number;
  owner: Owner;
  tags: string[];
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

function describe(p: Pet): string {
  return typeof p.id + " " + show(p.id) + ", " + typeof p.owner + " " + show(p.owner) + ", " + typeof p.tags + " " + show(p.tags) + ", keys " + Object.keys(p).join() + ", " + JSON.stringify(p);
}

const yes: boolean = process.argv.length > 0;

const pet: Pet = { id: 1, owner: new Owner("ann"), tags: ["a", "b"] };
console.log("before: " + describe(pet));

set(pet, yes ? "owner" : "id", 5);
console.log("a number is the owner: " + describe(pet));
attempt("owner.name", () => pet.owner.name);
attempt("owner.name.length", () => pet.owner.name.length);
attempt("owner.greet()", () => pet.owner.greet());
attempt("owner instanceof Owner", () => pet.owner instanceof Owner);
attempt("owner.name = 'x'", () => {
  pet.owner.name = "x";
  return pet.owner.name;
});
attempt("'name' in owner", () => "name" in pet.owner);
attempt("keys of the owner", () => Object.keys(pet.owner));
attempt("destructured", () => {
  const { name } = pet.owner;
  return name;
});

set(pet, yes ? "id" : "owner", new Owner("bob"));
console.log("an owner is the id: " + describe(pet));
attempt("id + 1", () => typeof (pet.id + 1));
attempt("id * 2", () => pet.id * 2);
attempt("id | 0", () => pet.id | 0);
attempt("id === id", () => pet.id === pet.id);
attempt("id.toFixed(0)", () => pet.id.toFixed(0));
attempt("id < 3", () => pet.id < 3);

set(pet, yes ? "tags" : "id", 3);
console.log("a number is the list: " + describe(pet));
attempt("tags.length", () => pet.tags.length);
attempt("tags[0]", () => pet.tags[0]);
attempt("tags.push", () => pet.tags.push("c"));
attempt("tags.join", () => pet.tags.join());
attempt("for of", () => {
  let text = "";
  for (const tag of pet.tags) text += tag;
  return text;
});
attempt("Array.isArray", () => Array.isArray(pet.tags));

set(pet, yes ? "id" : "tags", ["z"]);
console.log("a list is the id: " + describe(pet));
attempt("id + 1", () => pet.id + 1);
attempt("id * 2", () => pet.id * 2);

set(pet, "id", 2);
set(pet, "owner", new Owner("cy"));
set(pet, "tags", []);
console.log("honest again: " + describe(pet) + " " + pet.owner.greet() + " " + (pet.id + 1) + " " + pet.tags.length);

export {};
