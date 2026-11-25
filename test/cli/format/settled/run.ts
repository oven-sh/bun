import { tempDir } from "harness";
import { join } from "node:path";
import { concatenate, parseBundle } from "../bundle.ts";

export const optionSets: Record<string, Record<string, string | number | boolean>> = {
  prettier: {},
  oxfmt: { flavor: "oxfmt", printWidth: 100 },
  sorted: { flavor: "oxfmt", sortImports: "{}", tailwind: "oxfmt" },
  wide: { printWidth: 120, arrowParens: "avoid", quoteProps: "preserve" },
  standard: { semi: false, singleQuote: true, jsxSingleQuote: true, trailingComma: "none", printWidth: 70 },
  tabs: { useTabs: true, tabWidth: 4, trailingComma: "es5", bracketSameLine: true, printWidth: 60 },
  narrow: { flavor: "oxfmt", printWidth: 40, bracketSpacing: false, semi: false, quoteProps: "consistent" },
  collapsed: { objectWrap: "collapse", singleAttributePerLine: true, tabWidth: 4, printWidth: 50, tailwind: "plugin" },
  trivago: { plugins: "@trivago/prettier-plugin-sort-imports", importOrder: '["^[./]"]', printWidth: 90 },
};

export type Result = {
  verdict: "Formatted" | "Reduced" | "Unknown";
  formatter: "keeps" | "changes" | "rejects";
  agrees: boolean;
  path: string;
  text: string;
  /** Only with `wantsFormatted` */
  formatted?: string;
};

/** The paths of `files` are `<one of optionSets>/<name>`. `more`: options for all of them. */
export async function compare(
  command: string[],
  files: Map<string, string>,
  { more = {}, wantsFormatted = false, spawn = Bun.spawn as any, env = process.env } = {},
): Promise<Result[]> {
  const bundle = new Map([...files].map(([path, text]) => [path, Buffer.from(text)]));
  for (const [name, options] of Object.entries(optionSets)) {
    const lines = Object.entries({ ...options, ...more }).map(it => it.join("\t"));
    bundle.set(`${name}/options`, Buffer.from(lines.join("\n")));
  }
  using dir = tempDir("format-settled", { "in.txt": concatenate(bundle) });
  await using proc = spawn({
    cmd: [...command, "fmt", "--run-settled-tests", "in.txt", ...(wantsFormatted ? ["--report=out.txt"] : [])],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const lines = stdout.split("\n").filter(Boolean);
  if (exitCode !== 0 || lines.length !== files.size) {
    throw new Error(`exit code ${exitCode} after ${lines.length} of ${files.size} files: ${lines.at(-1)}`);
  }
  const formatted = wantsFormatted ? parseBundle(Buffer.from(await Bun.file(join(String(dir), "out.txt")).bytes())) : null;
  return lines.map(line => {
    const [verdict, formatter, agreement, path] = line.split(" ");
    const text = files.get(path)!;
    return { verdict, formatter, agrees: agreement === "agree", path, text, formatted: formatted?.get(path)?.toString() };
  });
}
