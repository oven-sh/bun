// Recursive clone, equality and merge, and lookup by a dotted path, over a nested configuration object with arrays, a Date, null and NaN.
function clone(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(clone);
  if (value instanceof Date) return new Date(value.getTime());
  const out = {};
  for (const key of Object.keys(value)) out[key] = clone(value[key]);
  return out;
}

function equal(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return a !== a && b !== b;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false;
    return true;
  }
  if (a instanceof Date) return b instanceof Date && a.getTime() === b.getTime();
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(b, key) || !equal(a[key], b[key])) return false;
  }
  return true;
}

function merge(target, source) {
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value && typeof value === "object" && !Array.isArray(value) && target[key] && typeof target[key] === "object") merge(target[key], value);
    else target[key] = value;
  }
  return target;
}

function get(object, path, fallback) {
  const parts = path.split(".");
  let current = object;
  for (let i = 0; i < parts.length; i++) {
    if (current == null) return fallback;
    current = current[parts[i]];
  }
  return current === undefined ? fallback : current;
}

function run(rounds) {
  const config = {
    name: "service",
    ports: [80, 443, 8080],
    limits: { memory: 512, cpu: { cores: 2, shares: [1, 2, 3] } },
    started: new Date(86400000),
    flags: { debug: false, verbose: null, ratio: NaN },
  };
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    const copy = clone(config);
    total += equal(copy, config) ? 1 : 0;
    copy.limits.cpu.shares[i % 3] = i;
    total += equal(copy, config) ? 1 : 0;
    const merged = merge(copy, { limits: { cpu: { cores: i & 3 } }, extra: [i] });
    total += get(merged, "limits.cpu.cores", -1) + get(merged, "limits.disk.size", 7) + get(merged, "ports.1", 0);
  }
  return total;
}

console.log(run(150000));
