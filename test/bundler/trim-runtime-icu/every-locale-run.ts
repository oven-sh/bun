import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, getMacOSVersion, isMacOS, isWindows, tempDir } from "harness";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, join } from "node:path";
import { unsupported } from "../../aot/run-programs";
import { canTrim, withoutFeatures } from "../compile-trim-features";

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = bunEnv) {
  await using child = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode, signalCode: child.signalCode };
}

const files = Object.fromEntries(
  readdirSync(import.meta.dir)
    .filter(name => name.endsWith(".js"))
    .map(name => [name, readFileSync(join(import.meta.dir, name), "utf8")]),
);
const features = [
  "IntlSegmenter",
  "IntlDisplayNames",
  "IntlOther",
  "IntlCollation",
  "IntlUnits",
  "IntlDateTimeFormat",
  "IntlNumberFormat",
];

// macOS has its own ICU, another in each version, and a lane's version is not to be had at home. Where Bun dies in a program there, the log says
// which call it was and, out of the report that macOS writes, in which functions of which libraries.
function withCallsSaid(lists: string) {
  const attempt = "export function attempt(f) { try {";
  const locales = "export const LOCALES = process.env.SOME_LOCALES ? SOME : EVERY_LOCALE;";
  if (!lists.includes(attempt) || !lists.includes(locales)) throw new Error("lists.js is not written as this expects");
  return (
    'import { writeSync } from "node:fs";\nlet asked = 0, locale = "";\n' +
    lists
      .replace(
        attempt,
        'export function attempt(f) { writeSync(2, "CALL " + ++asked + " " + locale + " " + f + "\\n"); try {',
      )
      .replace(
        locales,
        "export const LOCALES = Object.assign([...(process.env.SOME_LOCALES ? SOME : EVERY_LOCALE)], { *[Symbol.iterator]() { for (let i = 0; i < this.length; i++) yield (locale = this[i]); } });",
      )
  );
}

function framesOfReports(since: number): string[] {
  const folder = join(userInfo().homedir, "Library", "Logs", "DiagnosticReports");
  const lines: string[] = [];
  for (const name of readdirSync(folder)) {
    if (!name.startsWith(basename(bunExe())) || !name.endsWith(".ips") || statSync(join(folder, name)).mtimeMs < since)
      continue;
    const text = readFileSync(join(folder, name), "utf8");
    const report = JSON.parse(text.slice(text.indexOf("\n") + 1));
    lines.push(`${name}: ${report.exception?.type} ${report.exception?.signal} ${report.exception?.subtype ?? ""}`);
    for (const frame of report.threads[report.faultingThread].frames.slice(0, 16))
      lines.push(
        `  ${report.usedImages[frame.imageIndex]?.name} + 0x${frame.imageOffset.toString(16)} ${frame.symbol ?? ""}`,
      );
  }
  return lines;
}

async function describeDeath(entry: string, folder: string, env: Record<string, string | undefined>) {
  const since = Date.now() - 60_000;
  const traced = join(folder, "calls-said");
  mkdirSync(traced, { recursive: true });
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(traced, name), name === "lists.js" ? withCallsSaid(text) : text);
  const again = await run([bunExe(), entry], traced, env);
  const calls = again.stderr.split("\n").filter(line => line.startsWith("CALL "));
  await Bun.sleep(10_000);
  let frames: string[];
  try {
    frames = framesOfReports(since);
  } catch (error) {
    frames = ["no report could be read: " + error];
  }
  return [
    `${entry} once more, each call said first: ${again.signalCode ?? "exit " + again.exitCode}; the last of ${calls.length}:`,
    ...calls.slice(-2),
    ...frames,
  ].join("\n");
}

let running = 0;
const waiting: (() => void)[] = [];
async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= 4) await new Promise<void>(resolve => waiting.push(resolve));
  else running++;
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

const environments: Record<string, string | undefined>[] = [
  { TZ: "America/Los_Angeles", LANG: "en_US.UTF-8" },
  { TZ: "Europe/Berlin", LANG: "de_DE.UTF-8", LC_ALL: "de_DE.UTF-8", SOME_LOCALES: "1" },
  { TZ: undefined, LANG: "C", SOME_LOCALES: "1" },
];

const programs: [entry: string, kept: string[]][] = [
  ["date-to-locale-date-string.js", ["IntlDateTimeFormat"]],
  ["date-to-locale-time-string.js", ["IntlDateTimeFormat"]],
  ["date-to-locale-string.js", ["IntlDateTimeFormat"]],
  ["intl-date-time-format.js", ["IntlDateTimeFormat"]],
  ["intl-relative-time-format.js", ["IntlOther", "IntlNumberFormat"]],
  ["number.js", ["IntlNumberFormat", "IntlUnits"]],
  ["intl-display-names.js", ["IntlDisplayNames"]],
  ["intl-duration-format.js", ["IntlNumberFormat", "IntlUnits"]],
  ["intl-number-format.js", ["IntlNumberFormat", "IntlUnits"]],
  ["intl-plural-rules.js", ["IntlOther", "IntlNumberFormat"]],
  ["locale-compare.js", ["IntlCollation"]],
  ["intl-collator.js", ["IntlCollation"]],
  ["intl-list-format.js", ["IntlOther"]],
  ["intl-segmenter.js", ["IntlSegmenter"]],
  ["intl-locale.js", ["IntlOther", "IntlCollation"]],
  ["intl-supported-values-of.js", ["IntlOther", "IntlCollation"]],
  ["intl-get-canonical-locales.js", ["IntlOther"]],
  ["names-none-of-them.js", []],
];

// The ICU of macOS 26.4 cannot format a range of hours with a day period in "ak": there
// `new Intl.DateTimeFormat("ak", { hour: "numeric", dayPeriod: "short" }).formatRange(a, b)` ends any program, compiled or not, inside
// icu::DateIntervalFormat::formatImpl. The ICU of 14.8, 15.7 and 26.6 formats it.
const cannotRunHere = getMacOSVersion()?.startsWith("26.4") ? ["intl-date-time-format.js"] : [];

export function testDeal() {
  test("every program is in the table", () => {
    const entries = Object.keys(files).filter(name => name !== "lists.js" && name !== "date.js");
    expect(programs.map(([entry]) => entry).sort()).toEqual(entries.sort());
  });
}

export function testPrograms(part: number, parts: number) {
  describe.skipIf(!canTrim || !!unsupported)(
    "a method keeps all that it can open of ICU's data, in every locale",
    () => {
      test.concurrent.each(
        programs.filter(([entry], index) => index % parts === part - 1 && !cannotRunHere.includes(entry)),
      )(
        "%s prints the same with only %j kept",
        (entry, kept) =>
          withSlot(async () => {
            using dir = tempDir("trim-runtime-icu", files);
            const folder = String(dir);
            const leftOut = features.filter(feature => !kept.includes(feature));
            const contents: Record<string, string> = {};
            for (const [outfile, options, without] of [
              ["whole", [], []],
              ["by-use", ["--trim"], []],
              ["trimmed", ["--trim"], leftOut],
            ] as const) {
              const built = await run(
                [
                  bunExe(),
                  "build",
                  "--compile",
                  "--aot",
                  ...options,
                  ...withoutFeatures(without),
                  entry,
                  "--outfile",
                  join(outfile, "program"),
                ],
                folder,
              );
              expect(built.stderr).not.toContain("error:");
              expect(built.exitCode).toBe(0);
              const bytes = readFileSync(join(folder, outfile, isWindows ? "program.exe" : "program"));
              contents[outfile] = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
            }
            const executables =
              contents["trimmed"] === contents["by-use"] ? ["whole", "trimmed"] : ["whole", "by-use", "trimmed"];
            for (const environment of environments) {
              const env = { ...bunEnv, LANG: undefined, LC_ALL: undefined, ...environment };
              if (isMacOS) {
                const plain = await run([bunExe(), entry], folder, env);
                if (plain.signalCode) console.error(await describeDeath(entry, folder, env));
                expect(plain).toMatchObject({ stderr: "", exitCode: 0 });
              }
              const [whole, ...others] = await Promise.all(
                executables.map(outfile => run([join(folder, outfile, "program")], folder, env)),
              );
              expect(whole).toMatchObject({ stderr: "", exitCode: 0 });
              expect(whole.stdout).toMatch(/: \d+ calls, \d+ threw, digest [0-9a-f]+\n$/);
              for (const other of others) expect(other).toEqual(whole);
            }
          }),
        1_800_000,
      );
    },
  );
}
