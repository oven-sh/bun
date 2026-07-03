import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * scripts/orderfile/linker.order is the lld `--symbol-ordering-file` for the
 * linux release link: it lists the functions bun executes while starting up so
 * they land together at the front of `.text`, which is worth ~12 MB of resident
 * binary pages on a `bun -e 'console.log(1)'` (see scripts/orderfile/generate.ts).
 *
 * Nothing in the build fails if this file rots. lld skips names it cannot
 * resolve, and we pass --no-warn-symbol-ordering, so a truncated or malformed
 * file silently gives the RSS back instead of breaking the link. These checks
 * are what notices.
 */
const repoRoot = join(import.meta.dir, "..", "..", "..", "..");
const orderFilePath = join(repoRoot, "scripts", "orderfile", "linker.order");
const flagsPath = join(repoRoot, "scripts", "build", "flags.ts");

// lld's parser (args::getLines) trims each line, drops empty ones, and treats a
// leading '#' as a comment. Everything else is taken as a symbol name.
const symbols = existsSync(orderFilePath)
  ? readFileSync(orderFilePath, "utf8")
      .split("\n")
      .filter(line => line.trim().length > 0 && !line.startsWith("#"))
  : [];

describe("linker.order", () => {
  it("exists", () => {
    expect(existsSync(orderFilePath)).toBe(true);
  });

  it("holds the startup hot set", () => {
    // ~30k functions at the time of writing. A file that shrank by an order of
    // magnitude means the generator recorded nothing, not that bun got smaller.
    expect(symbols.length).toBeGreaterThan(5_000);
  });

  it("has no duplicate entries", () => {
    const seen = new Set<string>();
    const repeated: string[] = [];
    for (const symbol of symbols) {
      if (seen.has(symbol)) repeated.push(symbol);
      seen.add(symbol);
    }
    expect(repeated.slice(0, 5)).toEqual([]);
  });

  it("is one mangled symbol per line", () => {
    // A line with whitespace in it is read as a symbol name containing a space,
    // which can never match anything, so the entry is silently dropped.
    const malformed = symbols.filter(symbol => !/^[A-Za-z0-9_$.@]+$/.test(symbol));
    expect(malformed.slice(0, 5)).toEqual([]);
  });

  it("is wired into the linux release link", () => {
    const flags = readFileSync(flagsPath, "utf8");
    expect(flags).toContain("--symbol-ordering-file=${c.cwd}/scripts/orderfile/linker.order");
    // linkDepends() is what makes ninja relink when the file changes.
    expect(flags).toMatch(/linkDepends[\s\S]*scripts\/orderfile\/linker\.order/);
  });
});
