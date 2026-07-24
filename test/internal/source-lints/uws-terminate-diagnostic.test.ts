import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// #35256 banned <iostream> from Bun's release build and stripped the
// `std::cerr << "Error: ..."` lines ahead of each std::terminate() in bun-uws.
// Bun routes std::terminate through its own crash handler (JSCInitialize calls
// std::set_terminate), so without these writes every guard dies with the same
// generic "panic: A C++ exception occurred" and nothing names which uWS
// invariant fired. Keep every std::terminate() in bun-uws paired with a
// preceding fputs/fprintf to stderr, the replacement the shim prescribes.
test("bun-uws std::terminate() sites write a diagnostic to stderr first", async () => {
  const uwsSrc = path.resolve(import.meta.dir, "..", "..", "..", "packages", "bun-uws", "src");

  let terminates = 0;
  const violations: string[] = [];
  const glob = new Glob("**/*.{h,hpp,cpp}");
  for await (const rel of glob.scan({ cwd: uwsSrc })) {
    const source = readFileSync(path.join(uwsSrc, rel), "utf8");
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!/\bstd::terminate\s*\(\s*\)/.test(lines[i])) continue;
      terminates++;
      // Look back over the immediately preceding non-empty lines inside the
      // same block for a stderr write.
      let j = i - 1;
      let ok = false;
      while (j >= 0) {
        const prev = lines[j].trim();
        if (prev === "" || prev.startsWith("//") || prev.startsWith("/*") || prev.startsWith("*")) {
          j--;
          continue;
        }
        if (prev.endsWith("{")) break;
        if (/\b(fputs|fprintf)\b.*\bstderr\b/.test(prev)) ok = true;
        break;
      }
      if (!ok) {
        violations.push(`packages/bun-uws/src/${rel}:${i + 1}`);
      }
    }
  }

  expect(terminates).toBeGreaterThan(0);
  violations.sort();
  expect(violations).toEqual([]);
});
