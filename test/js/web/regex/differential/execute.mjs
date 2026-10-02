// Executes one differential case and produces a canonical, JSON-serializable
// record of everything observable: construction (or SyntaxError), source/flags
// normalization, exec results (index, groups, named groups, indices), global
// and sticky iteration with lastIndex, and the String methods. Two engines are
// equivalent on a case iff their records are byte-identical JSON.

const MAX_ITER = 20; // bound global iteration for pathological empty-match loops

// Per-case wall-clock budget. A single exec() is atomic and cannot be
// interrupted, so this only stops FURTHER operations once a case has proven
// pathologically slow (catastrophic backtracking); the runner also applies a
// process-level watchdog. Cases that blow the budget are recorded as such --
// the two engines have different backtracking cliffs, so the generator
// avoids the shapes that trigger them (nested unbounded quantifiers over
// alternation), and this budget is only a backstop.
const CASE_BUDGET_MS = 4000;

function normalizeMatch(m) {
  if (m === null) return null;
  const out = {
    match: [...m], // includes capture groups
    index: m.index,
  };
  if (m.groups !== undefined) {
    // named groups: sort keys for canonical output
    const groups = {};
    for (const key of Object.keys(m.groups).sort()) groups[key] = m.groups[key];
    out.groups = groups;
  }
  if (m.indices !== undefined) {
    out.indices = [...m.indices].map(pair => (pair ? [...pair] : null));
    if (m.indices.groups !== undefined) {
      const ig = {};
      for (const key of Object.keys(m.indices.groups).sort()) {
        const pair = m.indices.groups[key];
        ig[key] = pair ? [...pair] : null;
      }
      out.indicesGroups = ig;
    }
  }
  return out;
}

function safe(fn) {
  try {
    return { ok: fn() };
  } catch (e) {
    // Error class + code are the compared surface, not the message text
    // (messages legitimately differ across engines).
    return { error: e && e.constructor ? e.constructor.name : typeof e };
  }
}

export function executeCase({ source, flags, inputs }) {
  const record = { source, flags };

  // 1. Construction. A SyntaxError here is itself the (compared) result:
  //    error parity for invalid patterns is part of the surface.
  let re;
  try {
    re = new RegExp(source, flags);
  } catch (e) {
    record.construct = { error: e && e.constructor ? e.constructor.name : typeof e };
    return record;
  }
  record.construct = {
    source: re.source,
    flags: re.flags,
    global: re.global,
    ignoreCase: re.ignoreCase,
    multiline: re.multiline,
    dotAll: re.dotAll,
    unicode: re.unicode,
    unicodeSets: re.unicodeSets,
    sticky: re.sticky,
    hasIndices: re.hasIndices,
    string: String(re),
  };

  const iterating = re.global || re.sticky;
  record.inputs = [];
  const deadline = Date.now() + CASE_BUDGET_MS;

  for (const input of inputs) {
    if (Date.now() > deadline) {
      // Pathologically slow case: stop, and mark it so both engines' records
      // still differ only if their behaviour genuinely differs.
      record.budgetExceeded = true;
      break;
    }
    const entry = { input };

    // 2. exec: single, or iterate for global/sticky (with lastIndex trace).
    entry.exec = safe(() => {
      const r = new RegExp(source, flags);
      if (!iterating) return normalizeMatch(r.exec(input));
      const matches = [];
      const lastIndices = [];
      for (let i = 0; i < MAX_ITER; i++) {
        const m = r.exec(input);
        if (m === null) break;
        matches.push(normalizeMatch(m));
        lastIndices.push(r.lastIndex);
        if (r.lastIndex === 0 || !re.global) break; // sticky-only: one match per exec chain
      }
      return { matches, lastIndices, finalLastIndex: r.lastIndex };
    });

    // 3. test with lastIndex progression for global/sticky.
    entry.test = safe(() => {
      const r = new RegExp(source, flags);
      const results = [];
      const steps = iterating ? 3 : 1;
      for (let i = 0; i < steps; i++) {
        results.push([r.test(input), r.lastIndex]);
      }
      return results;
    });

    // 4. String methods.
    entry.match = safe(() => {
      const m = input.match(new RegExp(source, flags));
      return m === null ? null : re.global ? [...m] : normalizeMatch(m);
    });
    entry.matchAll = safe(() => {
      // matchAll requires the global flag; the TypeError otherwise is part of the surface.
      const results = [];
      let count = 0;
      for (const m of input.matchAll(new RegExp(source, flags))) {
        results.push(normalizeMatch(m));
        if (++count >= MAX_ITER) break;
      }
      return results;
    });
    entry.search = safe(() => input.search(new RegExp(source, flags)));
    entry.split = safe(() => input.split(new RegExp(source, flags), MAX_ITER));
    entry.replaceString = safe(() => input.replace(new RegExp(source, flags), "<$&|$1|$2|$'|$`|$$>"));
    entry.replaceFunction = safe(() => {
      const calls = [];
      const result = input.replace(new RegExp(source, flags), (...args) => {
        // Record the substring, offset (numeric arg before the whole string), and named-groups presence.
        const stringIndex = args.findIndex(a => a === input);
        const offset = args[stringIndex - 1];
        const named = typeof args[args.length - 1] === "object" && args[args.length - 1] !== null;
        calls.push([args[0], offset, named]);
        return "[" + args[0] + "]";
      });
      return { result, calls };
    });
    if (re.global) {
      entry.replaceAll = safe(() => input.replaceAll(new RegExp(source, flags), "<$&>"));
    }

    record.inputs.push(entry);
  }
  return record;
}

// Stable JSON stringify (object key order canonicalized) for byte-comparison.
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}
