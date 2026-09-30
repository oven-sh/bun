// A command that stands for a linter: it reads its operands and never runs them. A line of an operand that starts with "//~ " tells it what to do.
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const loaders: Record<string, "ts" | "tsx" | "jsx"> = {
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".tsx": "tsx",
  ".jsx": "jsx",
};
const forever = () => new Promise<never>(() => setInterval(() => {}, 1 << 30));

// The verbs of such a line: print <line for stderr>, stdout <line>, exit <code>, kill <signal>, hang. "{file}" is the operand as it was given.
async function lint(args: string[]): Promise<number> {
  if (args[0] !== "--lint" || args.length < 2) {
    process.stderr.write("usage: --lint <files>\n");
    return 1;
  }
  if (process.env.BUN_FEATURE_FLAG_EXPERIMENTAL_LINT !== "1") {
    process.stderr.write("error: --lint needs BUN_FEATURE_FLAG_EXPERIMENTAL_LINT=1\n");
    return 1;
  }
  let err = "";
  let out = "";
  let exit: number | undefined;
  let errors = 0;
  for (const operand of args.slice(1)) {
    let text: string;
    try {
      text = readFileSync(operand, "utf8");
    } catch {
      process.stderr.write(`error: cannot read ${operand}\n`);
      return 1;
    }
    const orders = text.split(/\r?\n/).filter(line => line.startsWith("//~ "));
    for (const order of orders) {
      const [, verb, rest = ""] = /^\/\/~ (\S+) ?(.*)$/.exec(order) ?? [];
      const value = rest.replaceAll("{file}", operand);
      if (verb === "print") {
        err += value + "\n";
        if (/^(?:\S.*?\(\d+,\d+\): )?error /.test(value)) errors++;
      } else if (verb === "stdout") out += value + "\n";
      else if (verb === "exit") exit = Number(value);
      else if (verb === "kill") {
        process.kill(process.pid, value);
        await forever();
      } else if (verb === "hang") await forever();
    }
    if (orders.length > 0) continue;
    // An operand without such a line is parsed, and each syntax error is printed with the code TS1005.
    try {
      new Bun.Transpiler({ loader: loaders[extname(operand)] ?? "js" }).transformSync(text);
    } catch (error) {
      const found = (error as { errors?: unknown[] }).errors ?? [error];
      for (const one of found) {
        const { message, position } = one as { message: string; position?: { line: number; column: number } | null };
        err += `${operand}(${position?.line ?? 1},${position?.column ?? 1}): error TS1005: ${message}\n`;
        errors++;
      }
    }
  }
  process.stdout.write(out);
  process.stderr.write(err);
  return exit ?? (errors > 0 ? 2 : 0);
}

// The exit code is set and the process ends by itself, after what it wrote has left.
process.exitCode = await lint(process.argv.slice(2));
