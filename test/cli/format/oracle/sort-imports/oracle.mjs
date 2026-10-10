// What the real plugins make of a text: the text that they hand to Prettier, and what Prettier prints.
//
// `modules`: a directory with node_modules/prettier and the plugins that are asked about.
// Run with Node.js: `<BUILTIN_MODULES>` is `require("module").builtinModules` of what runs Prettier.
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PACKAGES = {
  trivago: "@trivago/prettier-plugin-sort-imports",
  ianvs: "@ianvs/prettier-plugin-sort-imports",
  // Needs a `typescript` with a language service next to it: 5.9.
  organize: "prettier-plugin-organize-imports",
};

/// A few sets of options for each plugin.
export const SETS = {
  trivago: [
    {},
    { importOrder: ["^@core/(.*)$", "^@server/(.*)$", "^@ui/(.*)$", "^[./]"], importOrderSeparation: true, importOrderSortSpecifiers: true },
    { importOrder: ["<BUILTIN_MODULES>", "<THIRD_PARTY_MODULES>", "^[./]"], importOrderSideEffects: false, importOrderCaseInsensitive: true },
    { importOrder: ["<THIRD_PARTY_TS_TYPES>", "<TS_TYPES>^[./]", "^[./]"], importOrderGroupNamespaceSpecifiers: true, importOrderSeparation: true },
    { importOrder: ["^react", "<SEPARATOR>", "<THIRD_PARTY_MODULES>", "^[./]"], importOrderSeparation: true, importOrderSortByLength: "asc" },
  ],
  ianvs: [
    {},
    { importOrder: ["^@core/(.*)$", "", "^@server/(.*)$", "^@ui/(.*)$", "", "^[./]"] },
    { importOrder: ["", "<BUILTIN_MODULES>", "", "<THIRD_PARTY_MODULES>", "", "^[./]"], importOrderTypeScriptVersion: "5.0.0" },
    { importOrder: ["<TYPES>", "<THIRD_PARTY_MODULES>", "<TYPES>^[./]", "^[./]"], importOrderCaseSensitive: true },
    { importOrder: ["^[./]", "<THIRD_PARTY_MODULES>"], importOrderTypeScriptVersion: "5.0.0", importOrderSafeSideEffects: ["\\.css$"] },
  ],
};

export async function load(modules) {
  const require = createRequire(path.resolve(modules, "index.js"));
  const imported = await import(pathToFileURL(require.resolve("prettier")).href);
  const prettier = imported.format ? imported : imported.default;
  const plugins = {};
  for (const [name, specifier] of Object.entries(PACKAGES)) {
    let resolved;
    try {
      resolved = require.resolve(specifier);
    } catch {
      continue;
    }
    const module = await import(pathToFileURL(resolved).href);
    const plugin = module.default?.parsers ? module.default : module;
    const captured = { text: undefined };
    const parsers = {};
    for (const parser of ["babel", "babel-ts", "typescript", "flow"]) {
      const original = plugin.parsers[parser];
      if (!original) continue;
      parsers[parser] = {
        ...original,
        preprocess(code, options) {
          return (captured.text = original.preprocess(code, options));
        },
      };
    }
    plugins[name] = { plugin: { options: plugin.options, parsers }, captured };
  }

  /// { text, output } or { error }
  async function expected(name, input, options, filepath) {
    const { plugin, captured } = plugins[name];
    captured.text = undefined;
    const log = console.error;
    console.error = console.warn = () => {};
    try {
      const output = await prettier.format(input, { ...options, filepath, plugins: [plugin] });
      return { text: captured.text, output };
    } catch (error) {
      return { error: String(error.message).split("\n")[0] };
    } finally {
      console.error = console.warn = log;
    }
  }
  return { prettier, expected };
}

export function flags(argv) {
  const named = {}, positional = [];
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/s.exec(arg);
    if (match) named[match[1]] = match[2] ?? "true";
    else positional.push(arg);
  }
  return { named, positional };
}
