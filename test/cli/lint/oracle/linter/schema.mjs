// How ESLint validates the options of rules (Ajv 6, `meta.schema`, `meta.defaultOptions`) against
// `src/lint/linter/schema`: for every rule of ESLint and typescript-eslint, options that are generated
// from its schema and then damaged.
//
//   TYPESCRIPT_ESLINT_DIR=<built checkout> node schema.mjs

import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { random, report, requireFromEslint, runBunLint } from "./shared.mjs";

const { FlatConfigArray } = requireFromEslint("./lib/config/flat-config-array");
const requireTs = createRequire(join(resolve(process.env.TYPESCRIPT_ESLINT_DIR), "packages/eslint-plugin/package.json"));
const typescriptRules = requireTs("./dist/rules/index.js");
const rules = [
  ...[...requireFromEslint("./lib/rules")].map(([name, rule]) => [name, rule]),
  ...Object.entries(typescriptRules).map(([name, rule]) => [`@typescript-eslint/${name}`, rule]),
];

const rng = random(7);
const junk = () => rng.pick([null, true, false, 0, 1, -1, 2.5, 100, "", "a", "always", "never", "x y", [], [1], ["a", "a"], {}, { a: 1 }, { max: -1 }, "é😀", 1e21]);

function instance(schema, root, depth = 0) {
  if (depth > 8 || !schema || typeof schema !== "object") return junk();
  if (schema.$ref) {
    let at = root;
    for (const part of schema.$ref.split("/").slice(1)) at = at?.[part];
    return instance(at, root, depth + 1);
  }
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return rng.pick(schema.enum);
  for (const key of ["anyOf", "oneOf"]) if (schema[key]) return instance({ ...rng.pick(schema[key]), ...(schema.type ? { type: schema.type } : {}) }, root, depth + 1);
  const type = Array.isArray(schema.type) ? rng.pick(schema.type) : schema.type
    ?? (schema.properties ? "object" : schema.items ? "array" : rng.pick(["string", "boolean", "integer"]));
  switch (type) {
    case "null": return null;
    case "boolean": return rng.int(2) === 0;
    case "integer": return (schema.minimum ?? 0) + rng.int(4);
    case "number": return (schema.minimum ?? 0) + rng.int(4) + rng.pick([0, 0.5]);
    case "string": return rng.pick(["a", "b", "foo", "Foo", "^x", "1n", "a:exit", "", " "]);
    case "array": {
      if (Array.isArray(schema.items)) {
        const n = rng.int(schema.items.length + 1);
        return schema.items.slice(0, n).map(it => instance(it, root, depth + 1));
      }
      return Array.from({ length: (schema.minItems ?? 0) + rng.int(3) }, () => instance(schema.items, root, depth + 1));
    }
    default: {
      const out = {};
      for (const [key, value] of Object.entries(schema.properties ?? {})) {
        if (schema.required?.includes(key) || rng.int(3) === 0) out[key] = instance(value, root, depth + 1);
      }
      if (schema.additionalProperties && typeof schema.additionalProperties === "object" && rng.int(2) === 0) out.extra = instance(schema.additionalProperties, root, depth + 1);
      return out;
    }
  }
}

function damage(value, depth = 0) {
  if (rng.int(depth === 0 ? 8 : 5) === 0) return junk();
  if (Array.isArray(value)) {
    const out = value.map(it => (rng.int(3) === 0 ? damage(it, depth + 1) : it));
    switch (rng.int(6)) {
      case 0: out.push(junk()); break;
      case 1: out.pop(); break;
      case 2: if (out.length) out.push(structuredClone(rng.pick(out))); break;
    }
    return out;
  }
  if (value && typeof value === "object") {
    const out = Object.fromEntries(Object.entries(value).map(([key, it]) => [key, rng.int(3) === 0 ? damage(it, depth + 1) : it]));
    switch (rng.int(6)) {
      case 0: out[rng.pick(["unknown", "max", "a"])] = junk(); break;
      case 1: delete out[rng.pick(Object.keys(out))]; break;
    }
    return out;
  }
  return rng.int(2) === 0 ? junk() : value;
}

const plugins = { "@typescript-eslint": { rules: typescriptRules } };
const cases = [], expected = [];
for (const [rule, { meta }] of rules) {
  const schema = Array.isArray(meta.schema) ? { type: "array", items: meta.schema } : meta.schema ?? { type: "array", items: [] };
  for (let i = 0; i < 150; i++) {
    let options = instance(schema, schema);
    if (!Array.isArray(options)) options = [options];
    if (i % 3 !== 0) options = damage(options);
    if (!Array.isArray(options)) options = [options];
    options = JSON.parse(JSON.stringify(options));
    cases.push({ rule, options });
    try {
      const configs = new FlatConfigArray([{ plugins, rules: { [rule]: [2, ...structuredClone(options)] } }], { basePath: "/" });
      configs.normalizeSync();
      configs.getConfig("/a.js");
      expected.push(null);
    } catch (error) {
      expected.push(error.message);
    }
  }
}
console.log(`schema: ${expected.filter(it => it === null).length} of the cases are valid`);
report("schema", cases, expected, runBunLint("validate", cases), 25);
