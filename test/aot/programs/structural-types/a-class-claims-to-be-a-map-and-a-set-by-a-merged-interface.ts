function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Index extends Map<string, number> {}
class Index {
  id: number = 1;
}

interface Group extends Set<number> {}
class Group {
  id: number = 2;
}

function sizeOf(map: Map<string, number>): number {
  return map.size;
}

function lookUp(map: Map<string, number>, key: string): number | undefined {
  return map.get(key);
}

function put(map: Map<string, number>, key: string, value: number): number {
  map.set(key, value);
  return map.size;
}

function holds(set: Set<number>, n: number): boolean {
  return set.has(n);
}

function count(set: Set<number>): number {
  let seen = 0;
  for (const _ of set) seen++;
  return seen;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const real = new Map([["k", i]]);
  warm += sizeOf(real) + (lookUp(real, "k") ?? 0) + put(real, "l", 1) + (holds(new Set([i]), i) ? 1 : 0) + count(new Set([i, 1]));
}
show("2000 honest rounds", () => warm);

const index = new Index();
show("size", () => sizeOf(index));
show("size plus one", () => sizeOf(index) + 1);
show("get", () => lookUp(index, "k"));
show("set", () => put(index, "k", 1));
show("typeof get", () => typeof index.get);
show("instanceof Map", () => index instanceof Map);
show("the real get on it", () => Map.prototype.get.call(index, "k"));
show("for of", () => {
  const keys: string[] = [];
  for (const [key] of index) keys.push(key);
  return keys;
});
show("new Map from it", () => new Map(index).size);
show("keys", () => Object.keys(index));

const group = new Group();
show("has", () => holds(group, 1));
show("count", () => count(group));
show("size", () => group.size);
show("spread", () => [...group]);
show("a real set asks it", () => new Set([1]).isSubsetOf(group));
show("honest again", () => [sizeOf(new Map()), lookUp(new Map([["k", 5]]), "k"), holds(new Set([1]), 1), count(new Set([1, 2]))]);
