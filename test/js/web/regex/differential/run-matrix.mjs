// Emit one canonical JSON line per matrix case. Same executor and canonical
// form as the generated soak, so results diff across engines identically.
//   node differential/run-matrix.mjs --out results.jsonl
//   jsc  -m differential/run-matrix.mjs        (prints; capture stdout)
import { generateMatrix } from "./matrix.mjs";
import { executeCase, canonicalJson } from "./execute.mjs";
const out = typeof print === "function" ? print : console.log;
const args = typeof process !== "undefined" && process.argv ? process.argv.slice(2) : [];
const outIdx = args.indexOf("--out");
const lines = [];
for (const c of generateMatrix()) lines.push(canonicalJson(executeCase(c)));
if (outIdx >= 0 && typeof process !== "undefined") {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(args[outIdx + 1], lines.join("\n") + "\n");
} else {
  out(lines.join("\n"));
}
