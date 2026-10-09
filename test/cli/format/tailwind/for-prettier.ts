/** The `.prettierrc` that says what this `.oxfmtrc.json` says. `null`: Prettier does not have all of it. */
export function forPrettier(options: Record<string, unknown>): Record<string, unknown> | null {
  const result: Record<string, unknown> = { plugins: ["prettier-plugin-tailwindcss"], printWidth: 100 };
  for (const [name, value] of Object.entries(options)) {
    if (name === "sortTailwindcss" || name === "experimentalTailwindcss") {
      for (const [key, it] of Object.entries(value as object)) {
        result[`tailwind${key[0].toUpperCase()}${key.slice(1)}`] = it;
      }
    } else if (name === "singleQuote" || name === "jsxSingleQuote") {
      result[name] = value;
    } else {
      return null;
    }
  }
  return result;
}
