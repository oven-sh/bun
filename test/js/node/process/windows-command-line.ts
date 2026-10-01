/**
 * Reference implementation of how the Microsoft C runtime splits a process's
 * UTF-16 command line into argv (the rules `wmain`, and therefore node and
 * Bun, follow):
 * https://learn.microsoft.com/en-us/cpp/c-language/parsing-c-command-line-arguments
 *
 * - argv[0] is special: a leading `"` runs to the next `"`, otherwise to the
 *   first space/tab; backslashes are literal.
 * - Arguments are separated by spaces and tabs only (not newlines, not U+00A0).
 * - 2n backslashes + `"` → n backslashes, and the `"` toggles quoting;
 *   2n+1 backslashes + `"` → n backslashes + a literal `"`;
 *   backslashes not followed by `"` are literal.
 * - Inside a quoted region, `""` is one literal `"` (and stays quoted).
 *
 * Checked against ucrt's own argv for several thousand generated command lines
 * (quotes, backslash runs, tabs/newlines/control characters, non-BMP text).
 */
export function splitWindowsCommandLine(commandLine: string): string[] {
  const args: string[] = [];
  const n = commandLine.length;
  let i = 0;

  let arg = "";
  if (commandLine[i] === '"') {
    i++;
    while (i < n && commandLine[i] !== '"') arg += commandLine[i++];
    if (i < n) i++;
  } else {
    while (i < n && commandLine[i] !== " " && commandLine[i] !== "\t") arg += commandLine[i++];
  }
  args.push(arg);

  for (;;) {
    while (i < n && (commandLine[i] === " " || commandLine[i] === "\t")) i++;
    if (i >= n) break;
    arg = "";
    let inQuotes = false;
    while (i < n) {
      const c = commandLine[i];
      if (c === "\\") {
        let backslashes = 0;
        while (i < n && commandLine[i] === "\\") (backslashes++, i++);
        if (i < n && commandLine[i] === '"') {
          arg += "\\".repeat(backslashes >> 1);
          if (backslashes & 1) {
            arg += '"';
            i++;
          }
        } else {
          arg += "\\".repeat(backslashes);
        }
        continue;
      }
      if (c === '"') {
        if (inQuotes && commandLine[i + 1] === '"') {
          arg += '"';
          i += 2;
        } else {
          inQuotes = !inQuotes;
          i++;
        }
        continue;
      }
      if (!inQuotes && (c === " " || c === "\t")) break;
      arg += c;
      i++;
    }
    args.push(arg);
  }
  return args;
}
