// triage.ts <binaries> <work> <directory with node_modules/prettier> [target..]: what the findings of the formatter's targets are
// worth. For each input in <work>/findings/<target>/<kind> it asks Prettier, and prints one line:
//   same       Prettier prints the same, and what is wrong with it (it does not stay as it is, it has lost something) is wrong
//              with what Prettier prints: nothing to fix, unless the file should be left alone
//   different  Prettier prints something else
//   accepted   Prettier refuses the text
//   refused    `bun format` refuses it by now, or says that it would damage it
// A panic needs no second opinion: what Prettier does with the input is printed next to it.
// KINDS=letter,loss: only the kinds of findings whose name has one of these in it.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const [binaries, work, prettierDirectory, ...only] = process.argv.slice(2);
const prettier = await import(resolve(prettierDirectory, "node_modules/prettier/index.mjs"));
const NOT_OF_PRETTIER = new Set(["flavor", "jsdoc", "sortPackageJson"]);
const out = join(work, `triage-${process.pid}.out`);
const whole = join(work, `triage-${process.pid}.text`);

async function ask(text: string, options: Record<string, unknown>) {
  try {
    return { text: (await prettier.format(text, options)) as string };
  } catch (error) {
    return { error: String((error as Error).message).split("\n")[0] };
  }
}

const findings = join(work, "findings");
for (const target of readdirSync(findings).sort()) {
  if (only.length && !only.includes(target)) continue;
  if (["lint", "parser", "md"].includes(target)) continue;
  for (const kind of readdirSync(join(findings, target)).sort()) {
    if (process.env.KINDS && !process.env.KINDS.split(",").some(part => kind.includes(part))) continue;
    const counts = new Map<string, number>();
    for (const name of readdirSync(join(findings, target, kind)).sort()) {
      if (name.endsWith(".info") || name.endsWith(".tmp")) continue;
      const path = join(findings, target, kind, name);
      const [file, ...flags] = readFileSync(path + ".info", "utf8").split("\n")[0].split(" ");
      const options: Record<string, unknown> = { filepath: file };
      let isOnlyOurs = false;
      for (const flag of flags) {
        const [, key, value] = /^--([^=]+)=(.*)$/.exec(flag) ?? [];
        if (!key) continue;
        if (NOT_OF_PRETTIER.has(key) || target == "imports") isOnlyOurs = true;
        else options[key] = value == "true" ? true : value == "false" ? false : /^\d+$/.test(value) ? Number(value) : value;
      }
      rmSync(out, { force: true });
      const ran = spawnSync(join(binaries, `fuzz_${target}`), ["-timeout=20", "-rss_limit_mb=4096", path], {
        env: { ...process.env, FUZZ_OUT: out, FUZZ_TEXT: whole, FUZZ_FINDINGS: join(work, "triage-findings"), ASAN_OPTIONS: "detect_leaks=0:detect_stack_use_after_return=0" },
        stdio: "ignore",
      });
      const ours = existsSync(out) ? readFileSync(out) : undefined;
      const bytes = readFileSync(whole);
      const theirs = await ask(bytes.toString("utf8"), options);
      let verdict: string;
      if (ran.status != 0) verdict = `dies (${ran.signal ?? ran.status})`;
      else if (!ours) verdict = theirs.error ? "both refuse" : "refused";
      else if (theirs.error) verdict = "accepted";
      // Prettier never sees bytes that are not UTF-8: whoever reads the file for it has replaced them.
      else verdict = theirs.text == ours.toString("utf8") ? "same" : "different";
      // The widths of characters are an approximation here.
      if (verdict == "different" && bytes.some(byte => byte >= 0x80)) verdict += ", not ASCII";
      if (isOnlyOurs) verdict += " (with an option that Prettier does not have)";
      counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
      console.log(`${target}/${kind}\t${verdict}\t${bytes.length}\t${name}${theirs.error ? "\t" + theirs.error.slice(0, 100) : ""}`);
    }
    console.log(`== ${target}/${kind}: ${[...counts].map(([verdict, count]) => `${count} ${verdict}`).join(", ")}`);
  }
}
rmSync(out, { force: true });
rmSync(whole, { force: true });
