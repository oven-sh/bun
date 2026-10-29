// An executable has the built-in modules that are imported by a constant name, and a name made at run time finds those and no others.
export function importingByName(module: string, programs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(programs).map(([entry, text]) => [entry, (entry.endsWith(".mjs") ? `import "${module}";\n` : `require("${module}");\n`) + text]),
  );
}
