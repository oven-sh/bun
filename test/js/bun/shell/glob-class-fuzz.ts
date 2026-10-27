// Compares what the Bun shell prints for a word with a `[...]` class and a `*` with what bash prints.
// It does not run in CI: it needs bash. Run it with the build to check:
//
//   bun bd test/js/bun/shell/glob-class-fuzz.ts <seed> <count> [class|brace] [--backslash]
//
// A member of a class is text of the script, or data: quoted, escaped, the value of a variable, or an interpolated
// value. Data has to be a member and nothing else, so in bash the value `c` is written `'c'`. The exit code is 1 if
// a word prints a name that bash does not print. Words that print fewer names are listed: the known ones have a `[`
// before `:`, `.` or `=` in their brackets, which bash reads as the start of a POSIX class.
import { $ } from "bun";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [seed = 1, count = 1000] = process.argv.slice(2, 4).map(Number);
const inBraces = process.argv[4] === "brace";
const withBackslash = process.argv.includes("--backslash");

// mulberry32
let state = seed >>> 0;
const random = () => {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];

// A file for each first and each last character.
const dir = mkdtempSync(join(tmpdir(), "glob-class-fuzz-"));
const names = [..."abcdyzABZ059!^-][,{}?*()|#=+@:%_é\\"].flatMap(c => [c + "1", "0" + c, c + c]);
for (const name of names) writeFileSync(join(dir, name), "");

// `~` is left out: after a quote or a variable the shell expands it. A brace word also prints each variant as it is
// written, so a space in one could make a part of it look like a name.
const scriptChars = [..."abcz09!^-][=#?*+@:%_é"];
const dataChars = [...("abz0!^-][*?{},()|#=.é" + (inBraces ? "" : " ") + (withBackslash ? "\\" : ""))];

type Piece = { raw: string; bash: string; quoted?: string } | { value: string; bash: string };
const script = (text: string): Piece => ({ raw: text, bash: text });
const quote = (c: string) => `'${c}'`;

function data(c: string, variables: string[]): Piece {
  const origin = pick(["quoted", "escaped", "value", "variable"]);
  if (origin === "quoted") return script(quote(c));
  // An escaped space before a `#` starts a comment.
  if (origin === "escaped" && c !== "é" && c !== " ") return script("\\" + c);
  if (origin === "variable") {
    const name = "V" + variables.length;
    variables.push(`${name}=${quote(c)}; `);
    return { raw: "$" + name, quoted: `"$${name}"`, bash: `"$${name}"` };
  }
  return { value: c, bash: quote(c) };
}

function brackets(variables: string[]): Piece[] {
  const pieces = [script("[")];
  for (let i = 1 + Math.floor(random() * 5); i > 0; i--) {
    const r = random();
    // A brace of the script in the brackets is left out: such brackets are the characters, and bash has a class.
    if (r < 0.5) pieces.push(script(inBraces && random() < 0.3 ? "," : pick(scriptChars)));
    else if (r < 0.6) pieces.push(script("-"));
    else pieces.push(data(pick(dataChars), variables));
  }
  if (random() < 0.92) pieces.push(script("]"));
  return pieces;
}

function word(variables: string[]): Piece[] {
  const letter = () => script(pick([..."abz0"]));
  const group = () => [script("{"), letter(), script(","), letter(), script("}")];
  switch (Math.floor(random() * (inBraces ? 8 : 5))) {
    case 0:
      return [...brackets(variables), script("*")];
    case 1:
      return [script("*"), ...brackets(variables)];
    case 2:
      return [...brackets(variables), ...brackets(variables), script("*")];
    case 3:
      return [letter(), ...brackets(variables), script("*")];
    case 4:
      return [...brackets(variables), script("?"), script("*")];
    case 5:
      return [script("{"), ...brackets(variables), script(","), letter(), script("}"), script("*")];
    case 6:
      return [...group(), ...brackets(variables), script("*")];
    default:
      return [...brackets(variables), ...group(), script("*")];
  }
}

const cases = Array.from({ length: count }, () => {
  const variables: string[] = [];
  const pieces = word(variables);
  // `$V0a` is the variable `V0a`, so a variable before a name character is in quotes.
  pieces.forEach((piece, at) => {
    const next = pieces[at + 1];
    if ("quoted" in piece && next && "raw" in next && /^\\?[A-Za-z0-9_]/.test(next.raw)) piece.raw = piece.quoted!;
  });
  const strings = [variables.join("") + "echo "];
  const values: string[] = [];
  for (const piece of pieces) {
    if ("value" in piece) strings.push("") && values.push(piece.value);
    else strings[strings.length - 1] += piece.raw;
  }
  const shown = pieces.map(piece => ("value" in piece ? "${" + JSON.stringify(piece.value) + "}" : piece.raw)).join("");
  return { strings, values, shown, bash: variables.join("") + "echo " + pieces.map(piece => piece.bash).join("") };
});

const bashScript = join(dir, ".script.sh");
writeFileSync(
  bashScript,
  "shopt -s nullglob\nLC_ALL=C.UTF-8\n" + cases.map((c, i) => `echo "@@${i}"\n${c.bash}`).join("\n") + "\n",
);
const bash = spawnSync("bash", [bashScript], { cwd: dir, encoding: "utf8", maxBuffer: 1 << 28 });
if (bash.error) throw bash.error;
const wanted: string[] = [];
for (const line of bash.stdout.split("\n")) {
  // `@@` alone is a file name.
  if (/^@@\d+$/.test(line)) wanted.push("");
  else if (line) wanted[wanted.length - 1] = line;
}

const printed = (out: string) =>
  new Set(
    out
      .trimEnd()
      .split(" ")
      .filter(name => names.includes(name)),
  );
const counts = { same: 0, fewer: 0, more: 0, other: 0 };
for (const [i, c] of cases.entries()) {
  const template = Object.assign([...c.strings], { raw: c.strings }) as unknown as TemplateStringsArray;
  let got: Set<string>;
  try {
    const { exitCode, stdout, stderr } = await $(template, ...c.values)
      .cwd(dir)
      .quiet()
      .nothrow();
    if (exitCode !== 0 && !stderr.includes("no matches found")) throw new Error(stderr.toString().trim());
    got = exitCode === 0 ? printed(stdout.toString()) : new Set();
  } catch (error) {
    // A word that ends in `]]` or `[[` does not parse.
    counts.other++;
    continue;
  }
  const want = printed(wanted[i]);
  const more = [...got].filter(name => !want.has(name));
  const kind = more.length ? "more" : got.size < want.size ? "fewer" : "same";
  counts[kind]++;
  if (kind !== "same")
    console.log(
      `${kind}: ${c.shown}\n  bash: ${c.bash}\n  bun:  ${[...got].sort().join(" ")}\n  bash: ${[...want].sort().join(" ")}`,
    );
}
rmSync(dir, { recursive: true, force: true });
console.log(
  `seed ${seed}, ${inBraces ? "brace" : "class"}${withBackslash ? " with \\" : ""}: ${counts.same} of ${count} words the same as bash, ` +
    `${counts.fewer} with fewer names, ${counts.more} with a name that bash does not print, ${counts.other} with a parse error`,
);
process.exit(counts.more ? 1 : 0);
