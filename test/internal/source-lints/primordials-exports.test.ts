import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// src/js/internal/primordials.js exports a small subset of Node's primordials
// object. Builtin modules ported from Node's lib/ copy upstream
// `const { X } = primordials` blocks, which assume Node's full set, and a name
// the module does not export destructures to `undefined` without any error:
// nothing throws until a cold path calls it at runtime. tsc cannot catch this
// ($require is untyped in src/js/builtins.d.ts), so the webstream adapters
// shipped calls to three undefined TypedArrayPrototypeGet* getters for over a
// year. This lint closes that gap: every name pulled out of
// require("internal/primordials") must be a key of its export default object.
test("every primordial destructured in src/js is exported by internal/primordials", () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const srcJs = path.join(repoRoot, "src", "js");

  const exported = parseExportKeys(readFileSync(path.join(srcJs, "internal", "primordials.js"), "utf8"));
  expect(exported.size).toBeGreaterThan(0);

  const identifier = String.raw`[A-Za-z_$][\w$]*`;
  const requireCall = String.raw`require\(["']internal/primordials["']\)`;
  const violations: string[] = [];
  let namesChecked = 0;

  const glob = new Glob("**/*.{js,ts}");
  for (const rel of [...glob.scanSync({ cwd: srcJs })].sort()) {
    if (rel.replaceAll("\\", "/") === "internal/primordials.js") continue;
    const source = readFileSync(path.join(srcJs, rel), "utf8");
    if (!source.includes("internal/primordials")) continue;

    // `const { A, B: alias } = require("internal/primordials")`, also matching
    // multi-line destructuring patterns.
    const names: string[] = [];
    for (const [, body] of source.matchAll(new RegExp(String.raw`\{([^{}]*)\}\s*=\s*${requireCall}`, "g"))) {
      names.push(...destructuredNames(body));
    }

    // `const primordials = require("internal/primordials")` followed by
    // `const { A } = primordials` and/or `primordials.A` member reads.
    for (const [, binding] of source.matchAll(
      new RegExp(String.raw`(?:const|let|var)\s+(${identifier})\s*=\s*${requireCall}`, "g"),
    )) {
      for (const [, body] of source.matchAll(new RegExp(String.raw`\{([^{}]*)\}\s*=\s*${binding}\b`, "g"))) {
        names.push(...destructuredNames(body));
      }
      for (const [, member] of source.matchAll(new RegExp(String.raw`\b${binding}\.(${identifier})`, "g"))) {
        names.push(member);
      }
    }

    // Direct member reads off the require call itself.
    for (const [, member] of source.matchAll(new RegExp(String.raw`${requireCall}\.(${identifier})`, "g"))) {
      names.push(member);
    }

    namesChecked += names.length;
    for (const name of new Set(names)) {
      if (!exported.has(name)) {
        violations.push(`src/js/${rel.replaceAll("\\", "/")}: ${name}`);
      }
    }
  }

  // Guard against the scan going vacuous if consumers move or the require
  // shape changes.
  expect(namesChecked).toBeGreaterThan(0);

  violations.sort();
  expect(violations).toEqual([]);
});

// Property names bound by a destructuring body: `A`, `A: alias`, `A = def`.
function destructuredNames(body: string): string[] {
  return body
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(",")
    .map(entry => entry.split(":")[0].split("=")[0].trim())
    .filter(name => name !== "" && !name.startsWith("..."));
}

// Collects the top-level keys of primordials.js's `export default { ... }`
// object with a depth-tracking scan, so identifiers inside nested values
// (makeSafe class bodies, getGetter arguments) are not mistaken for keys.
function parseExportKeys(source: string): Set<string> {
  const start = source.indexOf("export default {");
  expect(start).toBeGreaterThan(-1);

  const keys = new Set<string>();
  let i = source.indexOf("{", start);
  let depth = 0;
  let expectingKey = false;
  for (; i < source.length; i++) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < source.length && source[i] !== c; i++) {
        if (source[i] === "\\") i++;
      }
    } else if (c === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      if (end === -1) break;
      i = end;
    } else if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i);
      if (end === -1) break;
      i = end + 1;
    } else if (c === "{" || c === "(" || c === "[") {
      depth++;
      if (c === "{" && depth === 1) expectingKey = true;
    } else if (c === "}" || c === ")" || c === "]") {
      depth--;
      if (depth === 0) break;
    } else if (depth === 1) {
      if (c === ",") {
        expectingKey = true;
      } else if (expectingKey && /[A-Za-z_$]/.test(c)) {
        let j = i;
        while (j < source.length && /[\w$]/.test(source[j])) j++;
        keys.add(source.slice(i, j));
        i = j - 1;
        expectingKey = false;
      }
    }
  }
  expect(depth).toBe(0);
  return keys;
}
