// The format of ../dns-simulation-c-ares.txt, for the test that reads it and for regenerate.ts, which writes it.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const path = join(import.meta.dir, "../dns-simulation-c-ares.txt");

/**
 * The script as it is run: `{x*n}` is `x` n times, and after each command comes a line that nothing understands, so that
 * `? @` in the log ends what the command did.
 */
export const marked = (script: string) =>
  script
    .replace(/\{([^*{}]+)\*(\d+)\}/g, (_, text, count) => Buffer.alloc(text.length * count, text).toString())
    .split("\n")
    .filter(line => line !== "")
    .flatMap(line => [line, "@"])
    .join("\n") + "\n";

export function read() {
  const [preamble, ...entries] = readFileSync(path, "utf8").split(/^=== /m);
  return {
    preamble,
    entries: entries.map(entry => {
      const [head, logs] = entry.split(/^---\n/m);
      const [theirs, ours] = logs.split(/^\+\+\+\n/m);
      const title = head.slice(0, head.indexOf("\n"));
      return { title, script: head.slice(title.length + 1), theirs, ours: ours as string | undefined };
    }),
  };
}
