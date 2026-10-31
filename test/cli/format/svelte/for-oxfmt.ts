/** Converts Prettier and prettier-plugin-svelte options to the equivalent `.oxfmtrc.json`. */
export function forOxfmt(options: Record<string, unknown>): Record<string, unknown> {
  const [result, svelte]: Record<string, unknown>[] = [{ printWidth: 80 }, {}];
  for (const [name, value] of Object.entries(options)) {
    if (name.startsWith("svelte")) svelte[name[6].toLowerCase() + name.slice(7)] = value;
    else result[name] = value;
  }
  return { ...result, svelte };
}
