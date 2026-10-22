function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  const parent = Object.getPrototypeOf(value);
  const mark = parent === Object.prototype ? "" : parent === null ? "without a prototype " : "with another prototype ";
  return mark + "{" + Object.entries(value).map(([key, held]) => JSON.stringify(key) + ": " + show(held)).join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label, "->", show(run()));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error);
  }
}

interface Tree {
  value: number;
  children: Tree[];
}
interface Chain {
  next: Chain | null;
}
type Nest = Nest[];

function depthOf(tree: Tree): number {
  let depth = 1;
  let at = tree;
  while (at.children.length > 0) {
    at = at.children[0];
    depth++;
  }
  return depth;
}
function sumOf(tree: Tree): number {
  let sum = tree.value;
  for (const child of tree.children) sum += sumOf(child);
  return sum;
}
function lengthOf(chain: Chain): number {
  let length = 0;
  for (let at: Chain | null = chain; at !== null; at = at.next) length++;
  return length;
}
function levels(nest: Nest): number {
  let count = 1;
  let at = nest;
  while (at.length > 0) {
    at = at[0];
    count++;
  }
  return count;
}

for (const depth of [1, 2, 10, 100, 400]) {
  attempt("a tree of depth " + depth, () => {
    const tree = JSON.parse<Tree>('{"value":1,"children":['.repeat(depth).slice(0, -1) + "[]" + "}]".repeat(depth).slice(0, -1));
    return [depthOf(tree), sumOf(tree)];
  });
  attempt("a chain of length " + depth, () => lengthOf(JSON.parse<Chain>('{"next":'.repeat(depth) + "null" + "}".repeat(depth))));
  attempt("lists in lists, " + depth + " levels", () => levels(JSON.parse<Nest>("[".repeat(depth) + "]".repeat(depth))));
}
attempt("a wide tree", () => {
  const leaf = '{"value":1,"children":[]}';
  const branch = '{"value":10,"children":[' + Array.from({ length: 20 }, () => leaf).join(",") + "]}";
  const tree = JSON.parse<Tree>('{"value":100,"children":[' + Array.from({ length: 20 }, () => branch).join(",") + "]}");
  return [depthOf(tree), sumOf(tree), tree.children[19].children[19]];
});
