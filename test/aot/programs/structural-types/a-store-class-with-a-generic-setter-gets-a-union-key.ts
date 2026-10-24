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

interface State {
  count: number;
  ratio: number;
  user: string;
  tags: string[];
}

class Store<T> {
  private state: T;
  writes = 0;
  constructor(state: T) {
    this.state = state;
  }
  set<K extends keyof T>(key: K, value: T[K]): this {
    this.state[key] = value;
    this.writes++;
    return this;
  }
  get<K extends keyof T>(key: K): T[K] {
    return this.state[key];
  }
  update<K extends keyof T>(key: K, change: (old: T[K]) => T[K]): this {
    return this.set(key, change(this.get(key)));
  }
  snapshot(): T {
    return this.state;
  }
}

const yes: boolean = process.argv.length > 0;

function report(title: string, store: Store<State>): void {
  const s = store.snapshot();
  console.log(title + ": " + typeof s.count + " " + show(s.count) + ", " + typeof s.ratio + " " + show(s.ratio) + ", " + typeof s.user + " " + show(s.user) + ", " + show(s.tags) + ", " + JSON.stringify(s) + ", writes " + store.writes);
  attempt("  get count + 1", () => store.get("count") + 1);
  attempt("  get ratio * 2", () => store.get("ratio") * 2);
  attempt("  get user upper", () => store.get("user").toUpperCase());
  attempt("  get tags length", () => store.get("tags").length);
  attempt("  get tags joined", () => store.get("tags").join("+"));
}

const store = new Store<State>({ count: 0, ratio: 0.5, user: "ann", tags: ["a"] });
let total = 0;
for (let i = 0; i < 2000; i++) {
  store.set("count", i).set("ratio", i / 3).set("user", "u" + (i % 5));
  total += store.get("count") + store.get("user").length;
}
console.log("2000 honest rounds: " + total);
report("honest", store);

store.set(yes ? "count" : "user", "many");
report("a string is the count", store);
store.set(yes ? "user" : "count", 12);
report("a number is the user", store);
store.set(yes ? "tags" : "ratio", 0.25);
report("a fraction is the list", store);
store.set(yes ? "ratio" : "tags", ["r"]);
report("a list is the ratio", store);
store.update(yes ? "count" : "user", old => (typeof old === "string" ? old.length : String(old)));
report("an update turns the kind around", store);
store.update(yes ? "count" : "user", old => (typeof old === "string" ? old.length : String(old)));
report("and again", store);
store.set("count", 1).set("ratio", 2).set("user", "bob").set("tags", []);
report("honest again", store);

const other = new Store({ count: "text", ratio: 1 });
console.log("a store of another shape: " + other.get("count").toUpperCase() + " " + (other.get("ratio") + 1));

export {};
