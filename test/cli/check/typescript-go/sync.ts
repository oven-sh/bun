// Collects TypeScript's compiler and conformance tests, and what typescript-go expects of them, in `bundle.zst`.
//
//   bun test/cli/check/typescript-go/sync.ts <tag, branch or commit of microsoft/typescript-go>
//   bun test/cli/check/typescript-go/sync.ts <path to a checkout of it, with its submodule>
//   bun test/cli/check/typescript-go/sync.ts --extract <part of a path> [directory]
//
// The files in `../conformance` run the tests. After a sync, `bun check` is expected to differ wherever typescript-go changed.
import { $ } from "bun";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const here = import.meta.dir;
const bundle = join(here, "bundle.zst");
const [source, ...rest] = process.argv.slice(2);
if (!source) {
  console.error("usage: bun sync.ts <tag, branch, commit or path> | --extract <part of a path> [directory]");
  process.exit(1);
}

// One file after the other: `=== <path> <length in bytes>\n`, the bytes, `\n`. Sixty thousand small files would be slow
// to clone and to check out. The baselines of a test repeat its source, so 136 MB compress to 8 MB.
if (source === "--extract") {
  const [part, into = mkdtempSync(join(tmpdir(), "typescript-go-"))] = rest;
  const bytes = Buffer.from(Bun.zstdDecompressSync(readFileSync(bundle)));
  for (let at = 0; at < bytes.length; ) {
    const end = bytes.indexOf(10, at);
    const header = bytes.toString("utf8", at + 4, end);
    const space = header.lastIndexOf(" ");
    const [path, length] = [header.slice(0, space), Number(header.slice(space + 1))];
    if (path.includes(part) && !path.endsWith("/names.txt")) {
      mkdirSync(dirname(join(into, path)), { recursive: true });
      writeFileSync(join(into, path), bytes.subarray(end + 1, end + 1 + length));
      console.log(join(into, path));
    }
    at = end + 1 + length + 1;
  }
  process.exit(0);
}

// With the same paths as there.
const copied = [
  "_submodules/TypeScript/tests/cases/compiler",
  "_submodules/TypeScript/tests/cases/conformance",
  "_submodules/TypeScript/tests/lib",
  "testdata/tests/cases/compiler",
  "testdata/tests/cases/conformance",
  "internal/bundled/libs",
];
// Of a directory of baselines, the kinds that are compared. `names.txt` has the names of all of them, which say which
// configurations a test has, and that a test without an `.errors.txt` has no errors.
const kinds = [".errors.txt", ".types", ".symbols", ".js", ".trace.json"];
const baselines = [
  "testdata/baselines/reference/submodule/compiler",
  "testdata/baselines/reference/submodule/conformance",
  "testdata/baselines/reference/compiler",
  "testdata/baselines/reference/conformance",
];

let checkout = source;
let temporary: string | undefined;
if (!existsSync(join(source, "testdata"))) {
  temporary = checkout = mkdtempSync(join(tmpdir(), "typescript-go-"));
  await $`git init -q`.cwd(checkout);
  await $`git remote add origin https://github.com/microsoft/typescript-go`.cwd(checkout);
  await $`git fetch -q --depth 1 --filter=blob:none origin ${source}`.cwd(checkout);
  const wanted = [
    "/LICENSE",
    "/NOTICE.txt",
    ...copied.filter(path => !path.startsWith("_submodules")).map(path => `/${path}/`),
    ...baselines.flatMap(path => kinds.map(kind => `/${path}/*${kind}`)),
  ];
  await $`git sparse-checkout set --no-cone ${wanted}`.cwd(checkout);
  await $`git checkout -q FETCH_HEAD`.cwd(checkout);
  await $`git submodule update -q --init --depth 1 --filter=blob:none _submodules/TypeScript`.cwd(checkout);
}

const files = new Map<string, Uint8Array>();
const add = (path: string) => {
  let count = 0;
  for (const entry of readdirSync(join(checkout, path), { withFileTypes: true })) {
    if (entry.isFile()) files.set(`${path}/${entry.name}`, readFileSync(join(checkout, path, entry.name)));
    count += entry.isFile() ? 1 : add(`${path}/${entry.name}`);
  }
  return count;
};
for (const path of copied) console.log(`${add(path)}`.padStart(6), path);
for (const path of baselines) {
  // From the commit: the checkout may be sparse.
  const listed = await $`git ls-tree --name-only HEAD ${path + "/"}`.cwd(checkout).text();
  const names = listed
    .split("\n")
    .filter(Boolean)
    .map(name => basename(name))
    .sort();
  files.set(`${path}/names.txt`, Buffer.from(names.join("\n") + "\n"));
  const compared = names.filter(name => kinds.some(kind => name.endsWith(kind)));
  for (const name of compared) files.set(`${path}/${name}`, readFileSync(join(checkout, path, name)));
  console.log(`${compared.length}`.padStart(6), path);
}

const parts: Uint8Array[] = [];
for (const path of [...files.keys()].sort()) {
  const bytes = files.get(path)!;
  parts.push(Buffer.from(`=== /${path} ${bytes.length}\n`), bytes, Buffer.from("\n"));
}
writeFileSync(bundle, Bun.zstdCompressSync(Buffer.concat(parts), { level: 19 }));
for (const name of ["LICENSE", "NOTICE.txt"]) writeFileSync(join(here, name), readFileSync(join(checkout, name)));

const commit = async (dir: string) => (await $`git rev-parse HEAD`.cwd(dir).text()).trim();
writeFileSync(
  join(here, "version.json"),
  JSON.stringify(
    {
      "microsoft/typescript-go": await commit(checkout),
      "microsoft/TypeScript": await commit(join(checkout, "_submodules/TypeScript")),
    },
    null,
    2,
  ) + "\n",
);
if (temporary) rmSync(temporary, { recursive: true, force: true });
