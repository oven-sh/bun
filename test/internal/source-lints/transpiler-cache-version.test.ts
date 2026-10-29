import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..", "..", "..");
const file = "src/jsc/RuntimeTranspilerCache.rs";

// A build reads only the cache entries of its own EXPECTED_VERSION. Each pull request that changes what the parser
// prints takes a new number, and all of them edit the same line. If two builds that print differently have the same
// number, one reads what the other printed.
function read(text: string) {
  const constant = /^const EXPECTED_VERSION: u32 = (\d+);$/m.exec(text);
  // An entry is its `/// Version N:` line and the `///` lines that follow it.
  const entry = /^\/\/\/ Version (\d+):(.*(?:\n\/\/\/(?! Version \d+:).*)*)$/gm;
  return {
    version: constant ? Number(constant[1]) : null,
    entries: Array.from(text.matchAll(entry), match => ({
      version: Number(match[1]),
      text: match[2].replace(/\n\/\/\/ ?/g, "\n").trim(),
    })),
  };
}

function git(...args: string[]) {
  const { stdout, exitCode } = Bun.spawnSync({ cmd: ["git", "-C", root, ...args], stdout: "pipe", stderr: "pipe" });
  return exitCode === 0 ? stdout.toString() : null;
}

// In a pull request HEAD is the merge commit. Its parents are the base branch and the head of the pull request.
function parentsOfHead() {
  const head = git("cat-file", "commit", "HEAD");
  if (head === null) throw new Error(`git cannot read HEAD in ${root}`);
  const parents = Array.from(head.split("\n\n", 1)[0].matchAll(/^parent ([0-9a-f]+)$/gm), match => match[1]);
  // A checkout of one commit cannot read them: .github/workflows/source-lints.yml fetches two commits deep.
  const missing = parents.filter(parent => git("cat-file", "-e", `${parent}^{commit}`) === null);
  if (missing.length > 0) throw new Error(`not in this checkout, fetch two commits deep: ${missing.join(", ")}`);
  return parents;
}

// null: the commit does not have the file.
function readAt(commit: string) {
  const text = git("show", `${commit}:${file}`);
  return text === null ? null : read(text);
}

const current = read(readFileSync(path.join(root, file), "utf8"));

test("each version of the runtime transpiler cache is listed once, in order", () => {
  const listed = current.entries.map(entry => entry.version);
  expect(listed.filter((version, i) => i > 0 && version <= listed[i - 1])).toEqual([]);
  expect(current.version).toBe(listed.at(-1)!);
});

test("the version of the runtime transpiler cache is not lower than in HEAD or its parents", () => {
  const lower = ["HEAD", ...parentsOfHead()].flatMap(commit => {
    const version = readAt(commit)?.version ?? null;
    const found = `EXPECTED_VERSION is ${current.version}, and ${commit.slice(0, 10)} has ${version}`;
    return version !== null && current.version! < version ? [`${found}: take a number above ${version}`] : [];
  });
  expect(lower).toEqual([]);
});

// Two pull requests can take the same number. The one that merges second keeps the entry of the first and takes a
// higher number for its own. A merge cannot tell a reworded entry from the entry of another pull request, so the entry
// at the number of a parent keeps its text until a higher number lands. An older entry can change.
test("a merge does not keep the number of a parent for an entry that the parent does not list", () => {
  const parents = parentsOfHead();
  const reused = (parents.length > 1 ? parents : []).flatMap(commit => {
    const parent = readAt(commit);
    if (!parent || parent.version !== current.version) return [];
    const listed = new Map(parent.entries.map(entry => [entry.version, entry.text]));
    const added = current.entries.find(
      ({ version, text }) => !listed.has(version) || (version === parent.version && listed.get(version) !== text),
    );
    if (!added) return [];
    const entry = `"Version ${added.version}: ${added.text.split("\n")[0]}"`;
    const rule = `a new entry takes a number above ${parent.version}, the entry at ${parent.version} keeps its text`;
    return [`${commit.slice(0, 10)} has EXPECTED_VERSION ${parent.version} and does not list ${entry}: ${rule}`];
  });
  expect(reused).toEqual([]);
});
