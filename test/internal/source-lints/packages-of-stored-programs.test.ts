import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..", "..", "aot");

// Where no node_modules stands above a file, plain Bun asks the registry for a package that it does not find, and runs what comes.
// A made-up name may be somebody's package there. So a stored program brings what it loads.
const answeredByBun = ["@jest/globals", "@vercel/fetch", "abort-controller", "utf-8-validate", "vitest"];

// These are loaded to see how a package that is not there fails, or who answers for it. TODO: a name under the scope below for each. Nothing is added here.
const plainNamesOfPackagesThatAreNotThere = [
  "also-not-installed",
  "asked",
  "kit-that-is-missing",
  "left-out",
  "no-such-package",
  "no-such-package-here",
  "not-installed",
  "not-installed-anywhere",
  "not-installed-package",
  "only-nearby",
];
const scopeOfPackagesThatAreNotThere = "@made-up/";

const asksByName =
  /\b(?:require\.resolve|import\.meta\.resolve(?:Sync)?|Bun\.resolve(?:Sync)?|mock\.module|jest\.mock|vi\.mock)\(\s*(["'`])([^"'`\n$]+)\1/g;

const transpilers = {
  js: new Bun.Transpiler({ loader: "js" }),
  jsx: new Bun.Transpiler({ loader: "jsx" }),
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
};

function packagesThatNothingBrings(folder: string) {
  const top = path.join(root, folder);
  const missing = new Map<string, string>();
  const brought = new Map<string, boolean>();
  const brings = (above: string, wanted: string) => {
    const key = `${above}\0${wanted}`;
    if (!brought.has(key))
      brought.set(
        key,
        existsSync(path.join(above, "node_modules", wanted)) || existsSync(path.join(above, "installed", wanted)),
      );
    return brought.get(key)!;
  };
  let files = 0;
  for (const entry of readdirSync(top, { recursive: true, withFileTypes: true })) {
    const loader = /\.[cm]?([jt]sx?)$/.exec(entry.name)?.[1] as keyof typeof transpilers | undefined;
    if (!loader || !entry.isFile()) continue;
    files++;
    const file = path.join(entry.parentPath, entry.name);
    const text = readFileSync(file, "utf8");
    const asked = Array.from(text.matchAll(asksByName), match => match[2]);
    try {
      // The scan lays React's runtime to every file with an element in it, whatever runtime the file or its tsconfig.json names.
      for (const { path: specifier } of transpilers[loader].scanImports(text))
        if (['"', "'", "`"].some(quote => text.includes(quote + specifier + quote))) asked.push(specifier);
    } catch {
      // A program that does not parse loads nothing.
    }
    for (const specifier of asked) {
      // With a colon it is a built-in module, a URL or the namespace of a plugin.
      if (/^[./#~]|:|\\/.test(specifier) || isBuiltin(specifier)) continue;
      const wanted = specifier.split("/", specifier.startsWith("@") ? 2 : 1).join("/");
      if (answeredByBun.includes(wanted) || wanted.startsWith(scopeOfPackagesThatAreNotThere)) continue;
      let above = entry.parentPath;
      while (above.length >= top.length && !brings(above, wanted)) above = path.dirname(above);
      if (above.length < top.length) missing.set(wanted, path.relative(root, file).replaceAll("\\", "/"));
    }
  }
  return { files, missing };
}

test("a stored program brings every package that it loads", () => {
  const programs = packagesThatNothingBrings("parallel");
  const projects = packagesThatNothingBrings("parallel-test-runs");
  expect({ projects: [...projects.missing], programs: [...programs.missing.keys()].sort() }).toEqual({
    projects: [],
    programs: plainNamesOfPackagesThatAreNotThere,
  });
  expect(programs.files).toBeGreaterThan(10_000);
  expect(projects.files).toBeGreaterThan(5_000);
}, 120_000);
