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
  name = "ann";
  greet(): string {
    return "hello " + this.name;
  }
}

interface Card {
  title: string;
  owner: Owner;
  tags: string[];
  open: () => number;
  active: boolean;
}

function report(label: string, c: Card): void {
  console.log(label + ": " + typeof c.title + ", " + typeof c.owner + ", " + typeof c.tags + ", " + typeof c.open + ", " + typeof c.active + ", keys " + Object.keys(c).join() + ", " + JSON.stringify(c));
  attempt("  title.length", () => c.title.length);
  attempt("  title + '!'", () => c.title + "!");
  attempt("  owner.greet()", () => c.owner.greet());
  attempt("  owner.name", () => c.owner.name);
  attempt("  tags.length", () => c.tags.length);
  attempt("  tags[0]", () => c.tags[0]);
  attempt("  open()", () => c.open());
  attempt("  active ? 1 : 2", () => (c.active ? 1 : 2));
  attempt("  active === false", () => c.active === false);
}

const full: Card = { title: "card", owner: new Owner(), tags: ["t"], open: () => 1, active: true };
report("the full one", full);

const noTitle: Partial<Card> = { title: undefined };
const a: Card = { ...full, ...noTitle };
report("title: undefined", a);

const noOwner: Partial<Card> = { owner: undefined };
const b: Card = { ...full, ...noOwner };
report("owner: undefined", b);

const noTags: Partial<Card> = { tags: undefined };
const c: Card = { ...full, ...noTags };
report("tags: undefined", c);

const noOpen: Partial<Card> = { open: undefined };
const d: Card = { ...full, ...noOpen };
report("open: undefined", d);

const noFlag: Partial<Card> = { active: undefined };
const e: Card = { ...full, ...noFlag };
report("active: undefined", e);

export {};
