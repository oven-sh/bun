import { join } from "node:path";

/** What the questions are asked about. `generate.ts` takes it from ICU's sources: JavaScript cannot enumerate it. */
export interface Inputs {
  /** By tree of ICU's data (`lang`, `curr`, `coll`, …; `locales` for the main one), the locales that have a bundle in it. */
  trees: Record<string, string[]>;
  codes: {
    languages: string[];
    scripts: string[];
    variants: string[];
    regions: string[];
    currencies: string[];
    keys: string[];
    types: Record<string, string[]>;
  };
  /** By break dictionary, how many words it has. */
  wordCounts: Record<string, number>;
  /** The words of a break dictionary, or with no argument nothing, but they are unpacked again the next time. */
  words(dictionary?: string): string[];
  [name: string]: any;
}

const path = join(import.meta.dir, "fixtures.tar.gz");

const read = async () => await new Bun.Archive(await Bun.file(path).bytes()).files();

/** Sorted words, each as the number of UTF-16 units it shares with the one before, at most 9, and the rest. */
export const packWords = (words: string[]) => {
  let before = "";
  return words
    .map(word => {
      let shared = 0;
      while (shared < 9 && shared < before.length && shared < word.length && before[shared] === word[shared]) shared++;
      before = word;
      return shared + word.slice(shared);
    })
    .join("\n");
};

const unpackWords = (text: string) => {
  let before = "";
  return text.split("\n").map(line => (before = before.slice(0, Number(line[0])) + line.slice(1)));
};

export async function readInputs(): Promise<Inputs> {
  const files = await read();
  const inputs: Inputs = await files.get("inputs.json")!.json();
  const packed = new Map<string, string>();
  for (const dictionary of Object.keys(inputs.wordCounts))
    packed.set(dictionary, await files.get(`words/${dictionary}`)!.text());
  // Half a million strings, which most workers have no use for.
  const words = new Map<string, string[]>();
  inputs.words = dictionary => {
    if (dictionary === undefined) words.clear();
    return dictionary === undefined
      ? []
      : words.getOrInsertComputed(dictionary, () => unpackWords(packed.get(dictionary)!));
  };
  return inputs;
}

/** By `section/subject`, the hash of the answers of a build of Bun whose ICU has ICU's own data. */
export async function readExpected(): Promise<Map<string, string>> {
  const text = await (await read()).get("expected.txt")!.text();
  return new Map(text.split("\n").map(line => line.split("\t") as [string, string]));
}

export async function writeFixtures(files: Record<string, string>) {
  const old = (await Bun.file(path).exists()) ? await read() : new Map<string, File>();
  const all: Record<string, string> = {};
  for (const [name, file] of old) all[name] = await file.text();
  await Bun.write(path, await new Bun.Archive({ ...all, ...files }, { compress: "gzip", level: 12 }).bytes());
}
