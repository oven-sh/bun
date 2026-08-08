// Evaluate a case from the V8 fix-history corpus in the current engine and
// return a JSON-comparable value shaped like the case's `expected`.
export function evaluateHistoryCase(c) {
  switch (c.op) {
    case "test":
      return new RegExp(c.source, c.flags).test(c.input);
    case "exec": {
      const m = new RegExp(c.source, c.flags).exec(c.input);
      return m === null ? null : { match: [...m].map(v => (v === undefined ? null : v)), index: m.index };
    }
    case "match": {
      const m = c.input.match(new RegExp(c.source, c.flags));
      return m === null ? null : [...m].map(v => (v === undefined ? null : v));
    }
    case "matchAll":
      return [...c.input.matchAll(new RegExp(c.source, c.flags))].map(m => ({
        match: [...m].map(v => (v === undefined ? null : v)),
        index: m.index,
      }));
    case "split":
      return c.input.split(new RegExp(c.source, c.flags)).map(v => (v === undefined ? null : v));
    case "replace":
      return { replacement: c.replacement, result: c.input.replace(new RegExp(c.source, c.flags), c.replacement) };
    case "construct-error":
      try {
        new RegExp(c.source, c.flags);
        return "no-error";
      } catch (e) {
        return e && e.constructor ? e.constructor.name : String(e);
      }
  }
  throw new Error("unknown op " + c.op);
}

export function tryEvaluateHistoryCase(c) {
  try {
    return { value: evaluateHistoryCase(c) };
  } catch (e) {
    return { error: e && e.constructor ? e.constructor.name : String(e) };
  }
}
