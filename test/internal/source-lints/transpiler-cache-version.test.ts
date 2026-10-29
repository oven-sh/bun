import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..", "..", "..");
const file = "src/jsc/RuntimeTranspilerCache.rs";

// A build reads only the cache entries of its own EXPECTED_VERSION. Each pull request that changes what the parser
// prints takes a new number, and all of them edit the same line. If the number goes back to one that an earlier build
// had, the new build reads what that build printed.
function versionOf(text: string) {
  const constant = /^const EXPECTED_VERSION: u32 = (\d+);$/m.exec(text);
  return constant ? Number(constant[1]) : null;
}

function git(...args: string[]) {
  const { stdout, exitCode } = Bun.spawnSync({ cmd: ["git", "-C", root, ...args], stdout: "pipe", stderr: "pipe" });
  return exitCode === 0 ? stdout.toString() : null;
}

const source = readFileSync(path.join(root, file), "utf8");
const current = versionOf(source);

test("each version of the runtime transpiler cache is listed once, in order", () => {
  const listed = Array.from(source.matchAll(/^\/\/\/ Version (\d+):/gm), match => Number(match[1]));
  expect(listed.filter((version, i) => i > 0 && version <= listed[i - 1])).toEqual([]);
  expect(current).toBe(listed.at(-1)!);
});

// In a pull request HEAD is the merge commit. Its parents are the base branch and the head of the pull request. A merge
// that keeps the number of the pull request where the base branch has a higher one fails here.
test("the version of the runtime transpiler cache is not lower than in HEAD or its parents", () => {
  const header = (git("cat-file", "commit", "HEAD") ?? "").split("\n\n", 1)[0];
  const parents = Array.from(header.matchAll(/^parent ([0-9a-f]+)$/gm), match => match[1]);
  // A checkout of one commit cannot read them: .github/workflows/source-lints.yml fetches two commits deep.
  const missing = parents.filter(parent => git("cat-file", "-e", `${parent}^{commit}`) === null);
  expect(missing.map(parent => `${parent.slice(0, 10)} is not in this checkout: fetch two commits deep`)).toEqual([]);

  let highest = { version: current!, commit: "" };
  for (const commit of ["HEAD", ...parents]) {
    const version = versionOf(git("show", `${commit}:${file}`) ?? "");
    if (version !== null && version > highest.version) highest = { version, commit };
  }
  const found = `EXPECTED_VERSION is ${current}, and ${highest.commit.slice(0, 10)} has ${highest.version}`;
  expect(highest.commit ? [`${found}: take a number above ${highest.version}`] : []).toEqual([]);
});
