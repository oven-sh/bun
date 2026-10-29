import { describe, expect, test } from "bun:test";
import { tempDir, tmpdirSync } from "harness";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const repository = path.resolve(import.meta.dir, "..", "..", "..");
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

// What git prints, or null where it fails.
async function git(root: string, args: string[], env: Record<string, string | undefined> = process.env) {
  await using proc = Bun.spawn({
    cmd: ["git", "-C", root, ...args],
    // A folder that is no repository must not find one above it.
    env: { ...env, GIT_CEILING_DIRECTORIES: path.dirname(root) },
    stdout: "pipe",
    stderr: "ignore",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  return exitCode === 0 ? stdout : null;
}

// In a pull request HEAD is the merge commit. Its parents are the base branch and the head of the pull request.
async function parentsOfHead(root: string) {
  const head = await git(root, ["cat-file", "commit", "HEAD"]);
  if (head === null) throw new Error(`git cannot read HEAD in ${root}`);
  const parents = Array.from(head.split("\n\n", 1)[0].matchAll(/^parent ([0-9a-f]+)$/gm), match => match[1]);
  // A checkout of one commit cannot read them: .github/workflows/source-lints.yml fetches two commits deep.
  const found = await Promise.all(parents.map(parent => git(root, ["cat-file", "-e", `${parent}^{commit}`])));
  const missing = parents.filter((_, i) => found[i] === null);
  if (missing.length > 0) throw new Error(`not in this checkout, fetch two commits deep: ${missing.join(", ")}`);
  return parents;
}

const readWorkingTree = (root: string) => read(readFileSync(path.join(root, file), "utf8"));

// null: the commit does not have the file. A file that the commit lists and git cannot read is an error.
async function readAt(root: string, commit: string) {
  if ((await git(root, ["ls-tree", "--name-only", commit, "--", file])) === "") return null;
  const text = await git(root, ["show", `${commit}:${file}`]);
  if (text === null) throw new Error(`git cannot read ${file} in ${commit}`);
  return read(text);
}

// Each of the three checks returns what is wrong in the checkout at `root`, a line each.
function outOfOrder(root: string) {
  const { version, entries } = readWorkingTree(root);
  const listed = entries.map(entry => entry.version);
  const wrong = listed
    .filter((entry, i) => i > 0 && entry <= listed[i - 1])
    .map(entry => `Version ${entry} is listed twice or out of order`);
  return version === listed.at(-1)
    ? wrong
    : [...wrong, `EXPECTED_VERSION is ${version}, and the last entry is Version ${listed.at(-1)}`];
}

async function lowerThanACommit(root: string) {
  const current = readWorkingTree(root);
  const commits = ["HEAD", ...(await parentsOfHead(root))];
  const versions = await Promise.all(commits.map(async commit => (await readAt(root, commit))?.version ?? null));
  return commits.flatMap((commit, i) => {
    const version = versions[i];
    const found = `EXPECTED_VERSION is ${current.version}, and ${commit.slice(0, 10)} has ${version}`;
    return version !== null && current.version! < version ? [`${found}: take a number above ${version}`] : [];
  });
}

// Two pull requests can take the same number. The one that merges second keeps the entry of the first and takes a
// higher number for its own. A merge cannot tell a reworded entry from the entry of another pull request, so the entry
// at the number of a parent keeps its text until a higher number lands. An older entry can change.
async function reusedInAMerge(root: string) {
  const current = readWorkingTree(root);
  const parents = await parentsOfHead(root);
  const commits = parents.length > 1 ? parents : [];
  const listings = await Promise.all(commits.map(commit => readAt(root, commit)));
  return commits.flatMap((commit, i) => {
    const parent = listings[i];
    if (!parent || parent.version !== current.version) return [];
    const listed = new Map(parent.entries.map(entry => [entry.version, entry.text]));
    const added = current.entries.find(
      ({ version, text }) => !listed.has(version) || (version === parent.version && listed.get(version) !== text),
    );
    if (!added) return [];
    const entry = `"Version ${added.version}: ${added.text.replaceAll("\n", " ")}"`;
    const rule = `a new entry takes a number above ${parent.version}, the entry at ${parent.version} keeps its text`;
    return [`${commit.slice(0, 10)} has EXPECTED_VERSION ${parent.version} and does not list ${entry}: ${rule}`];
  });
}

test("each version of the runtime transpiler cache is listed once, in order", () => {
  expect(outOfOrder(repository)).toEqual([]);
});

test("the version of the runtime transpiler cache is not lower than in HEAD or its parents", async () => {
  expect(await lowerThanACommit(repository)).toEqual([]);
});

test("a merge does not keep the number of a parent for an entry that the parent does not list", async () => {
  expect(await reusedInAMerge(repository)).toEqual([]);
});

describe.concurrent("the three checks, on a merge of two branches that each took a number", () => {
  type Entry = [version: number, text: string];
  const first: Entry = [42, "The first commit."];
  const other = (version: number): Entry => [version, "What another pull request prints."];
  const own = (version: number): Entry => [version, "What this pull request prints."];
  const source = (version: number, ...entries: Entry[]) =>
    entries.map(([entry, text]) => `/// Version ${entry}: ${text.replaceAll("\n", "\n/// ")}\n`).join("") +
    `const EXPECTED_VERSION: u32 = ${version};\n`;

  // The repositories of these tests do not read the git configuration of the machine: `merge.ff=only` or a hook
  // there would fail the commands that make them.
  const emptyGitConfig = path.join(tmpdirSync(), "empty.gitconfig");
  writeFileSync(emptyGitConfig, "");
  const gitEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: emptyGitConfig,
    GIT_AUTHOR_NAME: "lint",
    GIT_AUTHOR_EMAIL: "lint@example.com",
    GIT_COMMITTER_NAME: "lint",
    GIT_COMMITTER_EMAIL: "lint@example.com",
  };

  type Run = (...args: string[]) => Promise<void>;
  type Commit = (text: string) => Promise<void>;

  // Makes a repository with a first commit, a commit on main, a commit of the pull request, and their merge with
  // `merged` as the file. `check` runs in it.
  async function inMerge<T>(
    main: string,
    pullRequest: string,
    merged: string,
    check: (root: string, commit: Commit, run: Run) => T | Promise<T>,
  ) {
    using dir = tempDir("transpiler-cache-version", { [file]: source(42, first) });
    const root = String(dir);
    const run: Run = async (...args) => {
      if ((await git(root, args, gitEnv)) === null) throw new Error(`git ${args.join(" ")} failed in ${root}`);
    };
    const commit: Commit = async text => {
      writeFileSync(path.join(root, file), text);
      await run("commit", "--quiet", "--all", "--allow-empty", "--message", "a commit");
    };
    await run("init", "--quiet", "--initial-branch=main");
    await run("add", "--all");
    await run("commit", "--quiet", "--message", "first");
    await run("checkout", "--quiet", "-b", "pull-request");
    await commit(pullRequest);
    await run("checkout", "--quiet", "main");
    await commit(main);
    await run("merge", "--quiet", "--no-commit", "--strategy=ours", "pull-request");
    await commit(merged);
    return await check(root, commit, run);
  }
  async function problems(root: string) {
    const withoutCommit = (lines: string[]) => lines.map(line => line.replace(/\b[0-9a-f]{10}\b/, "<commit>"));
    const [lower, reused] = await Promise.all([lowerThanACommit(root), reusedInAMerge(root)]);
    return { outOfOrder: outOfOrder(root), lower: withoutCommit(lower), reused: withoutCommit(reused) };
  }
  const merge = (main: string, pullRequest: string, merged: string) => inMerge(main, pullRequest, merged, problems);
  const rule = (version: number) =>
    `a new entry takes a number above ${version}, the entry at ${version} keeps its text`;

  test("pass a merge that keeps the entry of main and takes a higher number", async () => {
    const main = source(43, first, other(43));
    const pullRequest = source(43, first, own(43));
    expect(await merge(main, pullRequest, source(44, first, other(43), own(44)))).toEqual({
      outOfOrder: [],
      lower: [],
      reused: [],
    });
  });

  test("fail a merge that keeps its own entry at the number of main", async () => {
    const main = source(43, first, other(43));
    const pullRequest = source(43, first, own(43));
    expect(await merge(main, pullRequest, pullRequest)).toEqual({
      outOfOrder: [],
      lower: [],
      reused: [
        `<commit> has EXPECTED_VERSION 43 and does not list "Version 43: What this pull request prints.": ${rule(43)}`,
      ],
    });
  });

  test("fail a merge that adds its text as a second line of the entry of main", async () => {
    const main = source(43, first, other(43));
    const pullRequest = source(43, first, own(43));
    const both = `"Version 43: What another pull request prints. What this pull request prints."`;
    expect(await merge(main, pullRequest, source(43, first, [43, `${other(43)[1]}\n${own(43)[1]}`]))).toEqual({
      outOfOrder: [],
      lower: [],
      reused: [
        `<commit> has EXPECTED_VERSION 43 and does not list ${both}: ${rule(43)}`,
        `<commit> has EXPECTED_VERSION 43 and does not list ${both}: ${rule(43)}`,
      ],
    });
  });

  test("fail a merge that keeps a number below the number of main", async () => {
    const pullRequest = source(43, first, own(43));
    expect(await merge(source(45, first, other(45)), pullRequest, pullRequest)).toEqual({
      outOfOrder: [],
      lower: ["EXPECTED_VERSION is 43, and <commit> has 45: take a number above 45"],
      reused: [],
    });
  });

  test("fail a merge that lists its entry below the number of main and takes no number", async () => {
    const main = source(45, first, other(45));
    expect(await merge(main, source(43, first, own(43)), source(45, first, own(43), other(45)))).toEqual({
      outOfOrder: [],
      lower: [],
      reused: [
        `<commit> has EXPECTED_VERSION 45 and does not list "Version 43: What this pull request prints.": ${rule(45)}`,
      ],
    });
  });

  test("fail a list with a number twice and a number that no entry has", async () => {
    const main = source(43, first, other(43));
    expect(await merge(main, source(43, first, own(43)), source(44, first, other(43), own(43)))).toEqual({
      outOfOrder: [
        "Version 43 is listed twice or out of order",
        "EXPECTED_VERSION is 44, and the last entry is Version 43",
      ],
      lower: [],
      reused: [],
    });
  });

  test("fail a list with a number below the number in front of it", async () => {
    const main = source(43, first, other(43));
    expect(await merge(main, source(43, first, own(43)), source(44, first, other(44), own(43)))).toEqual({
      outOfOrder: [
        "Version 43 is listed twice or out of order",
        "EXPECTED_VERSION is 44, and the last entry is Version 43",
      ],
      lower: [],
      reused: [],
    });
  });

  test("fail a working tree with a number below the number of HEAD", async () => {
    const pullRequest = source(43, first, own(43));
    const right = source(44, first, other(43), own(44));
    const lower = await inMerge(source(43, first, other(43)), pullRequest, right, root => {
      writeFileSync(path.join(root, file), pullRequest);
      return lowerThanACommit(root);
    });
    expect(lower).toEqual(["EXPECTED_VERSION is 43, and HEAD has 44: take a number above 44"]);
  });

  test("fail where git cannot read the file of a parent", async () => {
    const right = source(44, first, other(43), own(44));
    await inMerge(source(43, first, other(43)), source(43, first, own(43)), right, async root => {
      const blob = (await git(root, ["rev-parse", `${(await parentsOfHead(root))[0]}:${file}`]))!.trim();
      rmSync(path.join(root, ".git", "objects", blob.slice(0, 2), blob.slice(2)));
      await expect(lowerThanACommit(root)).rejects.toThrow(`git cannot read ${file}`);
      await expect(reusedInAMerge(root)).rejects.toThrow(`git cannot read ${file}`);
    });
  });

  test("pass a commit whose parent does not have the file", async () => {
    const right = source(44, first, other(43), own(44));
    const main = source(43, first, other(43));
    const result = await inMerge(main, source(43, first, own(43)), right, async (root, commit, run) => {
      await run("rm", "--quiet", file);
      await run("commit", "--quiet", "--message", "the file is gone");
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), right);
      await run("add", "--all");
      await commit(right);
      return problems(root);
    });
    expect(result).toEqual({ outOfOrder: [], lower: [], reused: [] });
  });

  test("pass a commit with one parent that rewords the newest entry", async () => {
    const right = source(44, first, other(43), own(44));
    const main = source(43, first, other(43));
    const result = await inMerge(main, source(43, first, own(43)), right, async (root, commit) => {
      await commit(source(44, first, other(43), [44, "What this pull request prints, in other words."]));
      return problems(root);
    });
    expect(result).toEqual({ outOfOrder: [], lower: [], reused: [] });
  });

  test("fail in a checkout that does not have the parents of HEAD", async () => {
    const right = source(44, first, other(43), own(44));
    await inMerge(source(43, first, other(43)), source(43, first, own(43)), right, async root => {
      using shallow = tempDir("transpiler-cache-version-shallow", {});
      const clone = ["clone", "--quiet", "--depth=1", Bun.pathToFileURL(root).href, String(shallow)];
      expect(await git(root, clone, gitEnv)).not.toBeNull();
      await expect(lowerThanACommit(String(shallow))).rejects.toThrow("fetch two commits deep");
      await expect(reusedInAMerge(String(shallow))).rejects.toThrow("fetch two commits deep");
    });
  });

  test("fail where git cannot read the commits", async () => {
    using dir = tempDir("transpiler-cache-version-no-repository", { [file]: source(42, first) });
    await expect(lowerThanACommit(String(dir))).rejects.toThrow("git cannot read HEAD");
    await expect(reusedInAMerge(String(dir))).rejects.toThrow("git cannot read HEAD");
  });
});
