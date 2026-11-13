// bun readdir-recursive-forms-fixture.ts <root>
// Every form of recursive readdir. A test imports `listInEveryForm`. A child process (bun with another
// environment, or Node.js) prints the same listing for <root> as JSON.
import fs from "node:fs";
import { join, relative } from "node:path";
import { promisify } from "node:util";

// "dddddddd/leaf.txt" as "d*8/leaf.txt", so that a failure prints short paths.
export const shorten = (path: string) => path.replace(/(.)\1{7,}/g, (run, char) => `${char}*${run.length}`);

const readdir = promisify(fs.readdir) as (path: string, options: object) => Promise<any[]>;

// The forms that return names.
const nameForms: Record<string, (root: string) => (string | Buffer)[] | Promise<(string | Buffer)[]>> = {
  "readdirSync": root => fs.readdirSync(root, { recursive: true }),
  "readdirSync, buffer": root => fs.readdirSync(root, { recursive: true, encoding: "buffer" }),
  "readdir": root => readdir(root, { recursive: true }),
  "readdir, buffer": root => readdir(root, { recursive: true, encoding: "buffer" }),
  "promises.readdir": root => fs.promises.readdir(root, { recursive: true }),
};

// The forms that return Dirents.
const direntForms: Record<string, (root: string) => fs.Dirent[] | Promise<fs.Dirent[]>> = {
  "readdirSync, withFileTypes": root => fs.readdirSync(root, { recursive: true, withFileTypes: true }),
  "readdir, withFileTypes": root => readdir(root, { recursive: true, withFileTypes: true }),
  "promises.readdir, withFileTypes": root => fs.promises.readdir(root, { recursive: true, withFileTypes: true }),
  "opendirSync": root => {
    const dir = fs.opendirSync(root, { recursive: true });
    try {
      const entries: fs.Dirent[] = [];
      for (let entry; (entry = dir.readSync());) entries.push(entry);
      return entries;
    } finally {
      dir.closeSync();
    }
  },
  "promises.opendir": async root => Array.fromAsync(await fs.promises.opendir(root, { recursive: true })),
};

const typeOf = (entry: fs.Dirent) =>
  entry.isDirectory() ? "directory" : entry.isFile() ? "file" : entry.isSymbolicLink() ? "symlink" : "unknown";

/** What each form returns for `root`: sorted paths relative to it. A Dirent form adds the type: "a/b (file)". */
export async function listInEveryForm(root: string) {
  const listing: Record<string, string[]> = {};
  for (const [form, list] of Object.entries(nameForms)) {
    listing[form] = (await list(root)).map(name => shorten(String(name))).sort();
  }
  for (const [form, list] of Object.entries(direntForms)) {
    listing[form] = (await list(root))
      .map(entry => `${shorten(relative(root, join(entry.parentPath, entry.name)))} (${typeOf(entry)})`)
      .sort();
  }
  return listing;
}

/** The listing that `listInEveryForm` returns when every form lists exactly `entries`. */
export function inEveryForm(entries: [path: string, type: "directory" | "file" | "symlink"][]) {
  const names = entries.map(([path]) => shorten(path)).sort();
  const dirents = entries.map(([path, type]) => `${shorten(path)} (${type})`).sort();
  return Object.fromEntries([
    ...Object.keys(nameForms).map(form => [form, names]),
    ...Object.keys(direntForms).map(form => [form, dirents]),
  ]);
}

if (import.meta.main) {
  console.log(JSON.stringify(await listInEveryForm(process.argv[2])));
}
