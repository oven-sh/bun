const found = [];
const seen = new Map();

function typeOf(value) {
  return value === null ? "null" : typeof value;
}

function walk(root, path, value, depth) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return;
  if (seen.has(value) && seen.get(value) <= depth) return;
  seen.set(value, depth);
  let names;
  try {
    names = Object.getOwnPropertyNames(value);
  } catch {
    return;
  }
  if (names.length > 400 && Array.isArray(value)) return;
  for (const name of names) {
    if (/^\d+$/.test(name)) continue;
    let member;
    let type;
    try {
      if (path.at(-1) === "prototype" && Object.getOwnPropertyDescriptor(value, name).get) type = "accessor";
      else type = typeOf((member = value[name]));
    } catch {
      type = "throws";
    }
    found.push([root, [...path, name], type]);
    if (depth < 3) walk(root, [...path, name], member, depth + 1);
  }
}

const modules = [...new Set([...require("node:module").builtinModules, "bun", "bun:ffi", "bun:jsc", "bun:sqlite", "bun:wrap"])].sort();
const loaded = [];
for (const name of modules) {
  if (/^(bun:test|bun:internal-for-testing|node:test|test|repl|node:repl)$/.test(name)) continue;
  try {
    loaded.push([name, require(name)]);
  } catch {}
}

walk("globalThis", [], globalThis, 0);
for (const [name, exports] of loaded) walk(name, [], exports, 1);

console.log(JSON.stringify(found));
process.exit(0);
