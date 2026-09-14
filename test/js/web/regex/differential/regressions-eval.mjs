// Shared evaluator for regressions.mjs cases; produces the normalized value
// compared against `expected`. Used by regressions.test.ts (bun) and
// check-regressions-under-node.mjs (node), so expectations can be validated
// against V8 mechanically.

export function evaluateCase(c) {
  const re = new RegExp(c.source, c.flags);
  switch (c.op) {
    case "exec": {
      const m = re.exec(c.input);
      if (m === null) return null;
      const out = { match: [...m].map(v => (v === undefined ? null : v)), index: m.index };
      if (m.groups !== undefined) {
        const groups = {};
        for (const k of Object.keys(m.groups).sort()) groups[k] = m.groups[k] === undefined ? null : m.groups[k];
        out.groups = groups;
      }
      return out;
    }
    case "match": {
      const m = c.input.match(re);
      return m === null ? null : [...m].map(v => (v === undefined ? null : v));
    }
    case "split":
      return c.input.split(re, 30).map(v => (v === undefined ? null : v));
    case "iterate": {
      const results = [];
      let m;
      let guard = 0;
      while ((m = re.exec(c.input)) !== null && guard++ < 30) {
        results.push({ match: [...m].map(v => (v === undefined ? null : v)), index: m.index, lastIndex: re.lastIndex });
        // advanceEmpty models matchAll: step lastIndex past a zero-width match
        // (by one code point under /u,/v) so empty matches can be enumerated.
        if (m[0] === "") {
          if (!c.advanceEmpty) break;
          const unicode = re.unicode || re.unicodeSets;
          const cp = c.input.codePointAt(re.lastIndex);
          re.lastIndex += unicode && cp !== undefined && cp > 0xffff ? 2 : 1;
        }
        if (!re.global) break;
      }
      return results;
    }
    case "construct":
      return { source: re.source, flags: re.flags };
  }
  throw new Error("unknown op " + c.op);
}

export function tryEvaluate(c) {
  try {
    return { value: evaluateCase(c) };
  } catch (e) {
    return { error: e && e.constructor ? e.constructor.name : String(e) };
  }
}
