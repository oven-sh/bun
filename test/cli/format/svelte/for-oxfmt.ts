/** The `.oxfmtrc.json` that says what these options of Prettier and of prettier-plugin-svelte say. */
export function forOxfmt(options: Record<string, unknown>): Record<string, unknown> {
  const [result, svelte]: Record<string, unknown>[] = [{ printWidth: 80 }, {}];
  for (const [name, value] of Object.entries(options)) {
    if (name.startsWith("svelte")) svelte[name[6].toLowerCase() + name.slice(7)] = value;
    else result[name] = value;
  }
  return { ...result, svelte };
}
