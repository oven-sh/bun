// Feature probing. Engines differ in which regex syntax they support (e.g.
// node 22's V8 predates regexp modifiers and duplicate named groups). For a
// differential run to be meaningful both sides must generate the SAME cases,
// so the generator is parameterized by an explicit capability set: probed
// once from the oracle engine and pinned in the oracle snapshot, then handed
// to the engine under test so it regenerates the identical stream.

function accepts(source, flags = "") {
  try {
    new RegExp(source, flags);
    return true;
  } catch {
    return false;
  }
}

export function probeCapabilities() {
  return {
    unicodeSets: accepts("[[a]--[b]]", "v"),
    modifiers: accepts("(?i:a)(?-i:b)"),
    duplicateNamedGroups: accepts("(?<n>a)|(?<n>b)"),
    hasIndices: accepts("a", "d"),
    lookbehind: accepts("(?<=a)b"),
    namedGroups: accepts("(?<x>a)\\k<x>"),
    unicodeProperties: accepts("\\p{L}", "u"),
    scriptProperties: accepts("\\p{Script=Greek}", "u"),
  };
}

// The intersection of two capability sets (used when pinning an oracle so it
// stays runnable under an older engine too).
export function intersectCapabilities(a, b) {
  const out = {};
  for (const key of Object.keys(a)) out[key] = Boolean(a[key] && b[key]);
  return out;
}
