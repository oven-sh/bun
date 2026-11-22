// What an expression evaluates to, as text, and how that differs from what was recorded.
import { bunEnv, bunExe, isDebug, isGlibc, isWindows, tempDir } from "harness";
import { existsSync, symlinkSync } from "node:fs";
import { delimiter, join } from "node:path";
import { differences } from "../../../bun/archive-golden/observe";
import { observe } from "./evaluate";

export type Case = [source: string, result: string];
export type Cases = {
  /** By topic. These name their locale and time zone. */
  anywhere: Record<string, Case[]>;
  /** By the variables of a process, which runs them in order. */
  environments: Record<string, Case[]>;
};

export const fixture = join(import.meta.dir, "cases.json.gz");

/** The version of src/icu, and of the ICU4C that the results were recorded with. macOS has the system's. */
export const version = "79.1";
export const hasVersion = process.platform !== "darwin" && process.versions.icu === version;

const load = async (file: string) => JSON.parse(Buffer.from(Bun.gunzipSync(await Bun.file(file).bytes())).toString());
export const loadCases = (): Promise<Cases> => load(fixture);

/** What build-data-files.ts makes: by directory and path, in base64. */
export type DataFiles = Record<string, Record<string, string>>;
export const dataFiles = join(import.meta.dir, "data-files.json.gz");

async function filesOf(directory: string) {
  const all: DataFiles = await load(dataFiles);
  return Object.fromEntries(Object.entries(all[directory]).map(([path, bytes]) => [path, Buffer.from(bytes, "base64")]));
}

/** glibc sets a locale of any name if `LOCPATH` has its files, and `locale.alias` does not list the name. */
const localeFiles = "/usr/lib/locale/C.utf8";

const canSetLocale = isGlibc && existsSync(localeFiles);
const canSet = (variable: string) =>
  variable.startsWith("SETLOCALE=") ? canSetLocale : !isWindows || !/^(LANG|LC_\w+|TZ)=/.test(variable);
export const canObserveIn = (environment: string) => environment.split(" ").every(canSet);

/**
 * `SETLOCALE` is for `setlocale()`, from which JavaScriptCore takes its default locale. `FILES` names a directory of
 * data-files.txt, which is the working directory, and `ICU_DATA` unless that is given.
 */
export async function observeIn(environment: string, sources: string[]): Promise<string[]> {
  const variables = Object.fromEntries(environment.split(" ").map(variable => variable.split("=")));
  using locales = tempDir("intl-golden", {});
  if (variables.SETLOCALE) symlinkSync(localeFiles, join(String(locales), variables.SETLOCALE));
  using files = variables.FILES && tempDir("intl-golden", await filesOf(variables.FILES));
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "evaluate-fixture.ts")],
    cwd: String(files ?? import.meta.dir),
    env: {
      ...bunEnv,
      ICU_ENABLE_TENTATIVE_ERA: undefined,
      ICU_TIMEZONE_FILES_DIR: undefined,
      LANG: "en_US.UTF-8",
      LC_ALL: undefined,
      LC_MESSAGES: undefined,
      LOCPATH: String(locales),
      TZ: "UTC",
      ...variables,
      ICU_DATA: variables.ICU_DATA?.replaceAll(":", delimiter) ?? files?.toString(),
    },
    stdin: Buffer.from(JSON.stringify(sources)),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`exit code ${exitCode}, signal ${proc.signalCode}\n${stderr}`);
  return JSON.parse(stdout);
}

export const differencesFrom = (cases: Case[], results = cases.map(([source]) => observe(source))) =>
  differences(
    cases.map(([source, result], i) => ({ index: source, expected: result + "\n", actual: results[i] + "\n" })),
  );

/** All of them take more than a minute in a debug build. */
export const fewerIfDebug = <T>(all: T[]) => all.filter((_, i) => !isDebug || i % 4 === 0);

/** For `test.each()`: the cases of the topics that start with `prefix`, so many at a time. */
export function inParts({ anywhere }: Cases, prefix: string, size = 200) {
  const parts: [name: string, cases: Case[]][] = [];
  for (const [topic, cases] of Object.entries(anywhere)) {
    if (!topic.startsWith(prefix)) continue;
    for (let start = 0; start < cases.length; start += size) {
      parts.push([`${topic}, from ${start}`, fewerIfDebug(cases.slice(start, start + size))]);
    }
  }
  return parts;
}
