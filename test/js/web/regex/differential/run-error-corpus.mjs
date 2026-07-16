// Emit the observable result of constructing each error-corpus pattern:
// accepted (normalized source, flags, toString) or the error class. Identical
// output across engines == SyntaxError parity.
//
//   node run-error-corpus.mjs > n.txt; bun run-error-corpus.mjs > b.txt; cmp n.txt b.txt

import { errorCorpus } from "./error-corpus.mjs";

for (const [source, flags] of errorCorpus) {
  let result;
  try {
    const re = new RegExp(source, flags);
    result = { ok: { source: re.source, flags: re.flags, string: String(re) } };
  } catch (e) {
    result = { error: e && e.constructor ? e.constructor.name : String(e) };
  }
  console.log(JSON.stringify({ source, flags, result }));
}
