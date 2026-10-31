// Reads and writes fixtures the way oxc's test harness (`oxc_formatter_core/src/test_support/harness.rs`) does.
import { dirname } from "node:path";

export type Options = Record<string, unknown>;

/** Returns a fixture's option sets: those in the nearest `options.json`, each at widths 80 and 100. */
export function rowsOf(name: string, files: Map<string, Uint8Array>): Options[] {
  let sets: Options[] = [{}];
  for (let directory = dirname(name); directory !== "."; directory = dirname(directory)) {
    const options = files.get(`${directory}/options.json`);
    if (options) {
      sets = JSON.parse(Buffer.from(options).toString());
      break;
    }
  }
  return sets.flatMap(set => {
    const pinned = set.printWidth;
    const rows = typeof pinned === "number" && pinned !== 80 && pinned !== 100 ? [set] : [];
    return [...rows, { ...set, printWidth: 80 }, { ...set, printWidth: 100 }];
  });
}

export const display = (options: Options) =>
  `{ ${Object.entries(options)
    .map(([name, value]) => `${name}: ${JSON.stringify(value)}`)
    .sort()
    .join(", ")} }`;

export function render(outputs: [Options, string][]) {
  let text = "";
  for (const [options, output] of outputs) {
    const line = display(options);
    text += `${"-".repeat(line.length)}\n${line}\n${"-".repeat(line.length)}\n${output}\n`;
  }
  return text + "===================== End =====================\n";
}

/** Returns a snapshot's outputs, keyed by the `display` string of their options. */
export function parse(text: string) {
  const outputs = new Map<string, string>();
  const title = "==================== Output ====================\n";
  const start = text.lastIndexOf(title);
  const body = text.slice(start < 0 ? 0 : start + title.length).replace(/===================== End =====================\n$/, "");
  const headers = [...body.matchAll(/^(-+)\n(\{.*\})\n\1\n/gm)];
  headers.forEach((match, i) => {
    const end = i + 1 < headers.length ? headers[i + 1].index : body.length;
    outputs.set(match[2], body.slice(match.index + match[0].length, end - 1));
  });
  return outputs;
}
