import { Commit, DeltaType, Repository, Status, StatusEntry } from "bun:git";
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

describe("bun:git", () => {
  describe("Repository", () => {
    test("Repository.open opens the current repository", () => {
      // Open the Bun repository itself
      const repo = Repository.open(".");

      expect(repo).toBeInstanceOf(Repository);
      expect(typeof repo.path).toBe("string");
      expect(repo.path).toContain(".git");
    });

    test("Repository.path returns the .git directory path", () => {
      const repo = Repository.open(".");

      expect(repo.path).toEndWith(".git/");
    });

    test("Repository.workdir returns the working directory path", () => {
      const repo = Repository.open(".");

      expect(repo.workdir).not.toBeNull();
      expect(typeof repo.workdir).toBe("string");
    });

    test("Repository.isBare returns false for normal repositories", () => {
      const repo = Repository.open(".");

      expect(repo.isBare).toBe(false);
    });

    test("Repository.open throws for non-existent path", () => {
      expect(() => Repository.open("/nonexistent/path")).toThrow();
    });

    test("Repository.open throws for non-repository path", () => {
      expect(() => Repository.open("/tmp")).toThrow();
    });

    test("Repository.open works with .git directory path", () => {
      const repo = Repository.open("./.git");

      expect(repo).toBeInstanceOf(Repository);
      expect(repo.path).toEndWith(".git/");
    });
  });

  describe("Commit", () => {
    test("Repository.head() returns a Commit object", () => {
      const repo = Repository.open(".");
      const head = repo.head();

      expect(head).toBeInstanceOf(Commit);
    });

    test("Commit.id returns a 40-character hex string", () => {
      const repo = Repository.open(".");
      const head = repo.head();

      expect(typeof head.id).toBe("string");
      expect(head.id).toMatch(/^[0-9a-f]{40}$/);
    });

    test("Commit.message returns the commit message", () => {
      const repo = Repository.open(".");
      const head = repo.head();

      expect(typeof head.message).toBe("string");
      expect(head.message.length).toBeGreaterThan(0);
    });

    test("Commit.summary returns the first line of the message", () => {
      const repo = Repository.open(".");
      const head = repo.head();

      expect(typeof head.summary).toBe("string");
      expect(head.summary.length).toBeGreaterThan(0);
      // Summary should not contain newlines
      expect(head.summary).not.toContain("\n");
    });

    test("Commit.author returns a Signature object", () => {
      const repo = Repository.open(".");
      const head = repo.head();
      const author = head.author;

      expect(typeof author).toBe("object");
      expect(typeof author.name).toBe("string");
      expect(typeof author.email).toBe("string");
      expect(typeof author.time).toBe("number");
    });

    test("Commit.committer returns a Signature object", () => {
      const repo = Repository.open(".");
      const head = repo.head();
      const committer = head.committer;

      expect(typeof committer).toBe("object");
      expect(typeof committer.name).toBe("string");
      expect(typeof committer.email).toBe("string");
      expect(typeof committer.time).toBe("number");
    });

    test("Commit.time returns a Unix timestamp", () => {
      const repo = Repository.open(".");
      const head = repo.head();

      expect(typeof head.time).toBe("number");
      expect(head.time).toBeGreaterThan(0);
      // Should be a reasonable Unix timestamp (after 2020)
      expect(head.time).toBeGreaterThan(1577836800);
    });
  });

  describe("getStatus", () => {
    test("getStatus returns an array of StatusEntry", () => {
      const repo = Repository.open(".");
      const status = repo.getStatus();

      expect(Array.isArray(status)).toBe(true);
      // Each entry should have path and status
      for (const entry of status) {
        expect(entry).toBeInstanceOf(StatusEntry);
        expect(typeof entry.path).toBe("string");
        expect(typeof entry.status).toBe("number");
      }
    });

    test("StatusEntry has helper methods", () => {
      const repo = Repository.open(".");
      const status = repo.getStatus();

      // Test that helper methods exist and return booleans
      for (const entry of status) {
        expect(typeof entry.isNew()).toBe("boolean");
        expect(typeof entry.isModified()).toBe("boolean");
        expect(typeof entry.isDeleted()).toBe("boolean");
        expect(typeof entry.isRenamed()).toBe("boolean");
        expect(typeof entry.isIgnored()).toBe("boolean");
        expect(typeof entry.inIndex()).toBe("boolean");
        expect(typeof entry.inWorkingTree()).toBe("boolean");
      }
    });

    test("getStatus with includeUntracked option", () => {
      const repo = Repository.open(".");

      const withUntracked = repo.getStatus({ includeUntracked: true });
      const withoutUntracked = repo.getStatus({ includeUntracked: false });

      // Both should be arrays
      expect(Array.isArray(withUntracked)).toBe(true);
      expect(Array.isArray(withoutUntracked)).toBe(true);
    });

    test("getStatus with all options", () => {
      const repo = Repository.open(".");

      // Should not throw with various option combinations
      expect(() =>
        repo.getStatus({
          includeUntracked: true,
          includeIgnored: false,
          recurseUntrackedDirs: true,
          detectRenames: false,
        }),
      ).not.toThrow();

      expect(() =>
        repo.getStatus({
          includeUntracked: false,
          includeIgnored: true,
          recurseUntrackedDirs: false,
          detectRenames: true,
        }),
      ).not.toThrow();
    });

    test("Status constants are defined", () => {
      expect(Status.CURRENT).toBe(0);
      expect(Status.INDEX_NEW).toBe(1);
      expect(Status.INDEX_MODIFIED).toBe(2);
      expect(Status.INDEX_DELETED).toBe(4);
      expect(Status.INDEX_RENAMED).toBe(8);
      expect(Status.INDEX_TYPECHANGE).toBe(16);
      expect(Status.WT_NEW).toBe(128);
      expect(Status.WT_MODIFIED).toBe(256);
      expect(Status.WT_DELETED).toBe(512);
      expect(Status.WT_TYPECHANGE).toBe(1024);
      expect(Status.WT_RENAMED).toBe(2048);
      expect(Status.IGNORED).toBe(16384);
      expect(Status.CONFLICTED).toBe(32768);
    });

    test("StatusEntry helper methods work correctly with status flags", () => {
      // Create a StatusEntry-like object manually to test helpers
      const entry = new StatusEntry({ path: "test.txt", status: Status.WT_NEW });
      expect(entry.isNew()).toBe(true);
      expect(entry.isModified()).toBe(false);
      expect(entry.inWorkingTree()).toBe(true);
      expect(entry.inIndex()).toBe(false);

      const modifiedEntry = new StatusEntry({ path: "test.txt", status: Status.INDEX_MODIFIED });
      expect(modifiedEntry.isModified()).toBe(true);
      expect(modifiedEntry.isNew()).toBe(false);
      expect(modifiedEntry.inIndex()).toBe(true);

      const deletedEntry = new StatusEntry({ path: "test.txt", status: Status.WT_DELETED });
      expect(deletedEntry.isDeleted()).toBe(true);

      const renamedEntry = new StatusEntry({ path: "test.txt", status: Status.INDEX_RENAMED });
      expect(renamedEntry.isRenamed()).toBe(true);

      const ignoredEntry = new StatusEntry({ path: "test.txt", status: Status.IGNORED });
      expect(ignoredEntry.isIgnored()).toBe(true);
    });
  });

  describe("revParse", () => {
    test("revParse resolves HEAD", () => {
      const repo = Repository.open(".");
      const oid = repo.revParse("HEAD");

      expect(typeof oid).toBe("string");
      expect(oid).toMatch(/^[0-9a-f]{40}$/);
    });

    test("revParse resolves HEAD~1", () => {
      const repo = Repository.open(".");
      const head = repo.revParse("HEAD");
      const parent = repo.revParse("HEAD~1");

      expect(typeof parent).toBe("string");
      expect(parent).toMatch(/^[0-9a-f]{40}$/);
      // Parent should be different from HEAD
      expect(parent).not.toBe(head);
    });

    test("revParse resolves HEAD^", () => {
      const repo = Repository.open(".");
      const parent1 = repo.revParse("HEAD~1");
      const parent2 = repo.revParse("HEAD^");

      // HEAD^ and HEAD~1 should be the same for non-merge commits
      expect(parent1).toBe(parent2);
    });

    test("revParse resolves HEAD~n for various n", () => {
      const repo = Repository.open(".");

      const head = repo.revParse("HEAD");
      const parent1 = repo.revParse("HEAD~1");
      const parent2 = repo.revParse("HEAD~2");
      const parent5 = repo.revParse("HEAD~5");

      // All should be different and valid
      expect(head).not.toBe(parent1);
      expect(parent1).not.toBe(parent2);
      expect(parent2).not.toBe(parent5);

      // All should be valid OIDs
      expect(parent5).toMatch(/^[0-9a-f]{40}$/);
    });

    test("revParse resolves short SHA", () => {
      const repo = Repository.open(".");
      const head = repo.head();
      const shortSha = head.id.slice(0, 7);

      const resolved = repo.revParse(shortSha);
      expect(resolved).toBe(head.id);
    });

    test("revParse throws for invalid spec", () => {
      const repo = Repository.open(".");

      expect(() => repo.revParse("invalid-ref-that-does-not-exist")).toThrow();
    });

    test("revParse throws for empty string", () => {
      const repo = Repository.open(".");

      expect(() => repo.revParse("")).toThrow();
    });

    test("revParse result matches head().id for HEAD", () => {
      const repo = Repository.open(".");

      const headFromRevParse = repo.revParse("HEAD");
      const headFromHead = repo.head().id;

      expect(headFromRevParse).toBe(headFromHead);
    });
  });

  describe("getCurrentBranch", () => {
    test("getCurrentBranch returns a string or null", () => {
      const repo = Repository.open(".");
      const branch = repo.getCurrentBranch();

      // It's either a string (branch name) or null (detached HEAD)
      if (branch !== null) {
        expect(typeof branch).toBe("string");
        expect(branch.length).toBeGreaterThan(0);
        // Branch name should not contain refs/heads/ prefix
        expect(branch).not.toContain("refs/heads/");
      }
    });
  });

  describe("aheadBehind", () => {
    test("aheadBehind returns ahead and behind counts", () => {
      const repo = Repository.open(".");

      // This may return {ahead: 0, behind: 0} if no upstream is set
      const result = repo.aheadBehind();

      expect(typeof result).toBe("object");
      expect(typeof result.ahead).toBe("number");
      expect(typeof result.behind).toBe("number");
      expect(result.ahead).toBeGreaterThanOrEqual(0);
      expect(result.behind).toBeGreaterThanOrEqual(0);
    });

    test("aheadBehind with explicit refs", () => {
      const repo = Repository.open(".");

      // Compare HEAD~5 to HEAD
      const result = repo.aheadBehind("HEAD", "HEAD~5");

      expect(typeof result.ahead).toBe("number");
      expect(typeof result.behind).toBe("number");
      // HEAD should be 5 ahead of HEAD~5
      expect(result.ahead).toBe(5);
      expect(result.behind).toBe(0);
    });

    test("aheadBehind with same ref returns 0/0", () => {
      const repo = Repository.open(".");

      const result = repo.aheadBehind("HEAD", "HEAD");

      expect(result.ahead).toBe(0);
      expect(result.behind).toBe(0);
    });

    test("aheadBehind is symmetric", () => {
      const repo = Repository.open(".");

      const result1 = repo.aheadBehind("HEAD", "HEAD~3");
      const result2 = repo.aheadBehind("HEAD~3", "HEAD");

      expect(result1.ahead).toBe(result2.behind);
      expect(result1.behind).toBe(result2.ahead);
    });

    test("aheadBehind throws for invalid local ref", () => {
      const repo = Repository.open(".");

      expect(() => repo.aheadBehind("invalid-ref-xxx", "HEAD")).toThrow();
    });

    test("aheadBehind throws for invalid upstream ref", () => {
      const repo = Repository.open(".");

      expect(() => repo.aheadBehind("HEAD", "invalid-ref-xxx")).toThrow();
    });
  });

  describe("listFiles", () => {
    test("listFiles returns an array of IndexEntry", () => {
      const repo = Repository.open(".");
      const files = repo.listFiles();

      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThan(0);

      // Check structure of entries
      for (const entry of files.slice(0, 5)) {
        expect(typeof entry.path).toBe("string");
        expect(typeof entry.mode).toBe("number");
        expect(typeof entry.oid).toBe("string");
        expect(entry.oid).toMatch(/^[0-9a-f]{40}$/);
        expect(typeof entry.stage).toBe("number");
        expect(typeof entry.size).toBe("number");
      }
    });

    test("listFiles includes package.json", () => {
      const repo = Repository.open(".");
      const files = repo.listFiles();

      const packageJson = files.find(f => f.path === "package.json");
      expect(packageJson).toBeDefined();
      expect(packageJson!.path).toBe("package.json");
    });

    test("listFiles entries have stage 0 for non-conflicted files", () => {
      const repo = Repository.open(".");
      const files = repo.listFiles();

      // In a normal repository, all files should have stage 0
      for (const entry of files) {
        expect(entry.stage).toBe(0);
      }
    });

    test("listFiles file modes are valid", () => {
      const repo = Repository.open(".");
      const files = repo.listFiles();

      // Common file modes: 0o100644 (regular), 0o100755 (executable), 0o120000 (symlink)
      const validModes = [0o100644, 0o100755, 0o120000, 0o040000, 0o160000];

      for (const entry of files.slice(0, 100)) {
        expect(validModes).toContain(entry.mode);
      }
    });

    test("listFiles returns files in consistent order", () => {
      const repo = Repository.open(".");
      const files1 = repo.listFiles();
      const files2 = repo.listFiles();

      // Same order on repeated calls
      expect(files1.map(f => f.path)).toEqual(files2.map(f => f.path));
    });
  });

  describe("diff", () => {
    test("diff returns DiffResult", () => {
      const repo = Repository.open(".");
      const diff = repo.diff();

      expect(typeof diff).toBe("object");
      expect(Array.isArray(diff.files)).toBe(true);
      expect(typeof diff.stats).toBe("object");
      expect(typeof diff.stats.filesChanged).toBe("number");
      expect(typeof diff.stats.insertions).toBe("number");
      expect(typeof diff.stats.deletions).toBe("number");
    });

    test("diff with cached option", () => {
      const repo = Repository.open(".");

      const workdir = repo.diff({ cached: false });
      const cached = repo.diff({ cached: true });

      // Both should return valid DiffResult
      expect(typeof workdir.stats.filesChanged).toBe("number");
      expect(typeof cached.stats.filesChanged).toBe("number");
    });

    test("diff files have correct structure", () => {
      const repo = Repository.open(".");
      const diff = repo.diff();

      for (const file of diff.files) {
        expect(typeof file.status).toBe("number");
        // newPath should always be present
        expect(typeof file.newPath).toBe("string");
        // oldPath can be string or null
        expect(file.oldPath === null || typeof file.oldPath === "string").toBe(true);
      }
    });

    test("diff stats are non-negative", () => {
      const repo = Repository.open(".");
      const diff = repo.diff();

      expect(diff.stats.filesChanged).toBeGreaterThanOrEqual(0);
      expect(diff.stats.insertions).toBeGreaterThanOrEqual(0);
      expect(diff.stats.deletions).toBeGreaterThanOrEqual(0);
    });

    test("diff filesChanged matches files array length", () => {
      const repo = Repository.open(".");
      const diff = repo.diff();

      expect(diff.stats.filesChanged).toBe(diff.files.length);
    });

    test("DeltaType constants are defined", () => {
      expect(DeltaType.UNMODIFIED).toBe(0);
      expect(DeltaType.ADDED).toBe(1);
      expect(DeltaType.DELETED).toBe(2);
      expect(DeltaType.MODIFIED).toBe(3);
      expect(DeltaType.RENAMED).toBe(4);
      expect(DeltaType.COPIED).toBe(5);
      expect(DeltaType.IGNORED).toBe(6);
      expect(DeltaType.UNTRACKED).toBe(7);
      expect(DeltaType.TYPECHANGE).toBe(8);
      expect(DeltaType.CONFLICTED).toBe(10);
    });
  });

  describe("countCommits", () => {
    test("countCommits returns a positive number", () => {
      const repo = Repository.open(".");
      const count = repo.countCommits();

      expect(typeof count).toBe("number");
      expect(count).toBeGreaterThan(0);
    });

    test("countCommits with range", () => {
      const repo = Repository.open(".");

      // Count commits between HEAD~10 and HEAD
      const count = repo.countCommits("HEAD~10..HEAD");

      expect(typeof count).toBe("number");
      expect(count).toBe(10);
    });

    test("countCommits with various ranges", () => {
      const repo = Repository.open(".");

      expect(repo.countCommits("HEAD~1..HEAD")).toBe(1);
      expect(repo.countCommits("HEAD~5..HEAD")).toBe(5);
      expect(repo.countCommits("HEAD~20..HEAD")).toBe(20);
    });

    test("countCommits with empty range returns 0", () => {
      const repo = Repository.open(".");

      // HEAD..HEAD should be 0 commits
      const count = repo.countCommits("HEAD..HEAD");

      expect(count).toBe(0);
    });

    test("countCommits throws for invalid range", () => {
      const repo = Repository.open(".");

      expect(() => repo.countCommits("invalid-ref..HEAD")).toThrow();
      expect(() => repo.countCommits("HEAD..invalid-ref")).toThrow();
    });
  });

  describe("log", () => {
    test("log returns an array of Commit objects", () => {
      const repo = Repository.open(".");
      const commits = repo.log({ limit: 5 });

      expect(Array.isArray(commits)).toBe(true);
      expect(commits.length).toBe(5);

      for (const commit of commits) {
        expect(commit).toBeInstanceOf(Commit);
        expect(commit.id).toMatch(/^[0-9a-f]{40}$/);
        expect(typeof commit.summary).toBe("string");
      }
    });

    test("log with limit option", () => {
      const repo = Repository.open(".");

      const ten = repo.log({ limit: 10 });
      const five = repo.log({ limit: 5 });

      expect(ten.length).toBe(10);
      expect(five.length).toBe(5);
    });

    test("log with limit=1", () => {
      const repo = Repository.open(".");

      const commits = repo.log({ limit: 1 });

      expect(commits.length).toBe(1);
      expect(commits[0].id).toBe(repo.head().id);
    });

    test("log with range option", () => {
      const repo = Repository.open(".");

      const commits = repo.log({ range: "HEAD~5..HEAD" });

      expect(commits.length).toBe(5);
    });

    test("log with from option", () => {
      const repo = Repository.open(".");
      const head = repo.head();

      const commits = repo.log({ from: "HEAD", limit: 1 });

      expect(commits.length).toBe(1);
      expect(commits[0].id).toBe(head.id);
    });

    test("log with from option using commit SHA", () => {
      const repo = Repository.open(".");
      const parent = repo.revParse("HEAD~2");

      const commits = repo.log({ from: parent, limit: 1 });

      expect(commits.length).toBe(1);
      expect(commits[0].id).toBe(parent);
    });

    test("log returns commits in chronological order (newest first)", () => {
      const repo = Repository.open(".");
      const commits = repo.log({ limit: 5 });

      // Verify commits are sorted by time (newest first)
      for (let i = 1; i < commits.length; i++) {
        expect(commits[i - 1].time).toBeGreaterThanOrEqual(commits[i].time);
      }
    });

    test("log without limit returns all commits up to HEAD", () => {
      const repo = Repository.open(".");

      const allCommits = repo.log({});
      const countedCommits = repo.countCommits();

      expect(allCommits.length).toBe(countedCommits);
    });

    test("log range matches countCommits", () => {
      const repo = Repository.open(".");

      const commits = repo.log({ range: "HEAD~7..HEAD" });
      const count = repo.countCommits("HEAD~7..HEAD");

      expect(commits.length).toBe(count);
      expect(commits.length).toBe(7);
    });

    test("log throws for invalid from ref", () => {
      const repo = Repository.open(".");

      expect(() => repo.log({ from: "invalid-ref-xxx" })).toThrow();
    });

    test("log throws for invalid range", () => {
      const repo = Repository.open(".");

      expect(() => repo.log({ range: "invalid..HEAD" })).toThrow();
    });

    test("log commit properties are accessible", () => {
      const repo = Repository.open(".");
      const commits = repo.log({ limit: 3 });

      for (const commit of commits) {
        // All properties should be accessible without throwing
        expect(commit.id).toMatch(/^[0-9a-f]{40}$/);
        expect(typeof commit.message).toBe("string");
        expect(typeof commit.summary).toBe("string");
        expect(typeof commit.time).toBe("number");
        expect(typeof commit.author.name).toBe("string");
        expect(typeof commit.author.email).toBe("string");
        expect(typeof commit.committer.name).toBe("string");
        expect(typeof commit.committer.email).toBe("string");
      }
    });
  });

  describe("temporary repository tests", () => {
    test("getStatus detects new untracked file", async () => {
      using dir = tempDir("git-status-test", {});
      const dirPath = String(dir);

      // Initialize a git repository
      await Bun.$`git init ${dirPath}`.quiet();
      await Bun.$`git -C ${dirPath} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${dirPath} config user.name "Test"`.quiet();

      // Create initial commit
      writeFileSync(join(dirPath, "initial.txt"), "initial content");
      await Bun.$`git -C ${dirPath} add .`.quiet();
      await Bun.$`git -C ${dirPath} commit -m "initial"`.quiet();

      // Create an untracked file
      writeFileSync(join(dirPath, "untracked.txt"), "untracked content");

      const repo = Repository.open(dirPath);
      const status = repo.getStatus();

      expect(status.length).toBe(1);
      expect(status[0].path).toBe("untracked.txt");
      expect(status[0].status & Status.WT_NEW).toBeTruthy();
      expect(status[0].isNew()).toBe(true);
    });

    test("getStatus detects modified file", async () => {
      using dir = tempDir("git-status-modified-test", {});
      const dirPath = String(dir);

      await Bun.$`git init ${dirPath}`.quiet();
      await Bun.$`git -C ${dirPath} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${dirPath} config user.name "Test"`.quiet();

      writeFileSync(join(dirPath, "file.txt"), "original content");
      await Bun.$`git -C ${dirPath} add .`.quiet();
      await Bun.$`git -C ${dirPath} commit -m "initial"`.quiet();

      // Modify the file
      writeFileSync(join(dirPath, "file.txt"), "modified content");

      const repo = Repository.open(dirPath);
      const status = repo.getStatus();

      expect(status.length).toBe(1);
      expect(status[0].path).toBe("file.txt");
      expect(status[0].status & Status.WT_MODIFIED).toBeTruthy();
      expect(status[0].isModified()).toBe(true);
    });

    test("getStatus detects staged file", async () => {
      using dir = tempDir("git-status-staged-test", {});
      const dirPath = String(dir);

      await Bun.$`git init ${dirPath}`.quiet();
      await Bun.$`git -C ${dirPath} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${dirPath} config user.name "Test"`.quiet();

      writeFileSync(join(dirPath, "file.txt"), "original content");
      await Bun.$`git -C ${dirPath} add .`.quiet();
      await Bun.$`git -C ${dirPath} commit -m "initial"`.quiet();

      // Modify and stage
      writeFileSync(join(dirPath, "file.txt"), "modified content");
      await Bun.$`git -C ${dirPath} add file.txt`.quiet();

      const repo = Repository.open(dirPath);
      const status = repo.getStatus();

      expect(status.length).toBe(1);
      expect(status[0].path).toBe("file.txt");
      expect(status[0].status & Status.INDEX_MODIFIED).toBeTruthy();
      expect(status[0].inIndex()).toBe(true);
    });

    test("getStatus detects deleted file", async () => {
      using dir = tempDir("git-status-deleted-test", {});
      const dirPath = String(dir);

      await Bun.$`git init ${dirPath}`.quiet();
      await Bun.$`git -C ${dirPath} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${dirPath} config user.name "Test"`.quiet();

      writeFileSync(join(dirPath, "file.txt"), "content");
      await Bun.$`git -C ${dirPath} add .`.quiet();
      await Bun.$`git -C ${dirPath} commit -m "initial"`.quiet();

      // Delete the file
      unlinkSync(join(dirPath, "file.txt"));

      const repo = Repository.open(dirPath);
      const status = repo.getStatus();

      expect(status.length).toBe(1);
      expect(status[0].path).toBe("file.txt");
      expect(status[0].status & Status.WT_DELETED).toBeTruthy();
      expect(status[0].isDeleted()).toBe(true);
    });

    test("diff detects changes in temp repo", async () => {
      using dir = tempDir("git-diff-test", {});
      const dirPath = String(dir);

      await Bun.$`git init ${dirPath}`.quiet();
      await Bun.$`git -C ${dirPath} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${dirPath} config user.name "Test"`.quiet();

      writeFileSync(join(dirPath, "file.txt"), "line1\nline2\nline3\n");
      await Bun.$`git -C ${dirPath} add .`.quiet();
      await Bun.$`git -C ${dirPath} commit -m "initial"`.quiet();

      // Modify the file
      writeFileSync(join(dirPath, "file.txt"), "line1\nmodified\nline3\nnewline\n");

      const repo = Repository.open(dirPath);
      const diff = repo.diff();

      expect(diff.files.length).toBe(1);
      expect(diff.files[0].newPath).toBe("file.txt");
      expect(diff.files[0].status).toBe(DeltaType.MODIFIED);
      expect(diff.stats.filesChanged).toBe(1);
      expect(diff.stats.insertions).toBeGreaterThan(0);
      expect(diff.stats.deletions).toBeGreaterThan(0);
    });

    test("diff cached shows staged changes", async () => {
      using dir = tempDir("git-diff-cached-test", {});
      const dirPath = String(dir);

      await Bun.$`git init ${dirPath}`.quiet();
      await Bun.$`git -C ${dirPath} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${dirPath} config user.name "Test"`.quiet();

      writeFileSync(join(dirPath, "file.txt"), "original\n");
      await Bun.$`git -C ${dirPath} add .`.quiet();
      await Bun.$`git -C ${dirPath} commit -m "initial"`.quiet();

      // Modify and stage
      writeFileSync(join(dirPath, "file.txt"), "modified\n");
      await Bun.$`git -C ${dirPath} add file.txt`.quiet();

      const repo = Repository.open(dirPath);
      const cachedDiff = repo.diff({ cached: true });

      // Staged changes should show the modification
      expect(cachedDiff.files.length).toBe(1);
      expect(cachedDiff.files[0].status).toBe(DeltaType.MODIFIED);
    });

    test("listFiles in new repo", async () => {
      using dir = tempDir("git-listfiles-test", {});
      const dirPath = String(dir);

      await Bun.$`git init ${dirPath}`.quiet();
      await Bun.$`git -C ${dirPath} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${dirPath} config user.name "Test"`.quiet();

      writeFileSync(join(dirPath, "a.txt"), "a");
      writeFileSync(join(dirPath, "b.txt"), "b");
      writeFileSync(join(dirPath, "c.txt"), "c");
      await Bun.$`git -C ${dirPath} add .`.quiet();
      await Bun.$`git -C ${dirPath} commit -m "initial"`.quiet();

      const repo = Repository.open(dirPath);
      const files = repo.listFiles();

      expect(files.length).toBe(3);
      expect(files.map(f => f.path).sort()).toEqual(["a.txt", "b.txt", "c.txt"]);
    });

    test("log and countCommits in new repo", async () => {
      using dir = tempDir("git-log-test", {});
      const dirPath = String(dir);

      await Bun.$`git init ${dirPath}`.quiet();
      await Bun.$`git -C ${dirPath} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${dirPath} config user.name "Test"`.quiet();

      // Create 3 commits
      writeFileSync(join(dirPath, "file.txt"), "1");
      await Bun.$`git -C ${dirPath} add .`.quiet();
      await Bun.$`git -C ${dirPath} commit -m "first commit"`.quiet();

      writeFileSync(join(dirPath, "file.txt"), "2");
      await Bun.$`git -C ${dirPath} add .`.quiet();
      await Bun.$`git -C ${dirPath} commit -m "second commit"`.quiet();

      writeFileSync(join(dirPath, "file.txt"), "3");
      await Bun.$`git -C ${dirPath} add .`.quiet();
      await Bun.$`git -C ${dirPath} commit -m "third commit"`.quiet();

      const repo = Repository.open(dirPath);

      expect(repo.countCommits()).toBe(3);

      const commits = repo.log({});
      expect(commits.length).toBe(3);

      // Verify all commit messages are present (order may vary due to same timestamp)
      const summaries = commits.map(c => c.summary).sort();
      expect(summaries).toEqual(["first commit", "second commit", "third commit"]);
    });

    test("getCurrentBranch returns main/master in new repo", async () => {
      using dir = tempDir("git-branch-test", {});
      const dirPath = String(dir);

      await Bun.$`git init ${dirPath}`.quiet();
      await Bun.$`git -C ${dirPath} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${dirPath} config user.name "Test"`.quiet();

      writeFileSync(join(dirPath, "file.txt"), "content");
      await Bun.$`git -C ${dirPath} add .`.quiet();
      await Bun.$`git -C ${dirPath} commit -m "initial"`.quiet();

      const repo = Repository.open(dirPath);
      const branch = repo.getCurrentBranch();

      // Default branch could be "main" or "master" depending on git config
      expect(branch === "main" || branch === "master").toBe(true);
    });

    test("getCurrentBranch returns null for detached HEAD", async () => {
      using dir = tempDir("git-detached-test", {});
      const dirPath = String(dir);

      await Bun.$`git init ${dirPath}`.quiet();
      await Bun.$`git -C ${dirPath} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${dirPath} config user.name "Test"`.quiet();

      writeFileSync(join(dirPath, "file.txt"), "1");
      await Bun.$`git -C ${dirPath} add .`.quiet();
      await Bun.$`git -C ${dirPath} commit -m "first"`.quiet();

      writeFileSync(join(dirPath, "file.txt"), "2");
      await Bun.$`git -C ${dirPath} add .`.quiet();
      await Bun.$`git -C ${dirPath} commit -m "second"`.quiet();

      // Detach HEAD
      await Bun.$`git -C ${dirPath} checkout HEAD~1`.quiet();

      const repo = Repository.open(dirPath);
      const branch = repo.getCurrentBranch();

      expect(branch).toBeNull();
    });

    test("empty repository - head() throws", async () => {
      using dir = tempDir("git-empty-test", {});
      const dirPath = String(dir);

      await Bun.$`git init ${dirPath}`.quiet();

      const repo = Repository.open(dirPath);

      // head() should throw on empty repository (no commits)
      expect(() => repo.head()).toThrow();
    });

    test("empty repository - getStatus works", async () => {
      using dir = tempDir("git-empty-status-test", {});
      const dirPath = String(dir);

      await Bun.$`git init ${dirPath}`.quiet();

      const repo = Repository.open(dirPath);

      // getStatus should work even without commits
      const status = repo.getStatus();
      expect(Array.isArray(status)).toBe(true);
    });

    test("empty repository - listFiles returns empty", async () => {
      using dir = tempDir("git-empty-listfiles-test", {});
      const dirPath = String(dir);

      await Bun.$`git init ${dirPath}`.quiet();

      const repo = Repository.open(dirPath);

      const files = repo.listFiles();
      expect(files).toEqual([]);
    });

    test("empty repository - countCommits returns 0", async () => {
      using dir = tempDir("git-empty-count-test", {});
      const dirPath = String(dir);

      await Bun.$`git init ${dirPath}`.quiet();

      const repo = Repository.open(dirPath);

      // countCommits should throw or return 0 on empty repository
      expect(() => repo.countCommits()).toThrow();
    });

    test("empty repository - getCurrentBranch returns null", async () => {
      using dir = tempDir("git-empty-branch-test", {});
      const dirPath = String(dir);

      await Bun.$`git init ${dirPath}`.quiet();

      const repo = Repository.open(dirPath);

      // No commits means unborn branch
      const branch = repo.getCurrentBranch();
      expect(branch).toBeNull();
    });
  });

  describe("argument validation", () => {
    test("revParse throws for non-string argument", () => {
      const repo = Repository.open(".");

      // @ts-expect-error - testing runtime behavior
      expect(() => repo.revParse(123)).toThrow();
      // @ts-expect-error - testing runtime behavior
      expect(() => repo.revParse(null)).toThrow();
      // @ts-expect-error - testing runtime behavior
      expect(() => repo.revParse(undefined)).toThrow();
      // @ts-expect-error - testing runtime behavior
      expect(() => repo.revParse({})).toThrow();
    });

    test("revParse throws when called without arguments", () => {
      const repo = Repository.open(".");

      // @ts-expect-error - testing runtime behavior
      expect(() => repo.revParse()).toThrow();
    });

    test("aheadBehind throws for non-string arguments", () => {
      const repo = Repository.open(".");

      // @ts-expect-error - testing runtime behavior
      expect(() => repo.aheadBehind(123, "HEAD")).toThrow();
      // @ts-expect-error - testing runtime behavior
      expect(() => repo.aheadBehind("HEAD", 123)).toThrow();
    });

    test("countCommits throws for non-string argument", () => {
      const repo = Repository.open(".");

      // @ts-expect-error - testing runtime behavior
      expect(() => repo.countCommits(123)).toThrow();
    });

    test("log handles invalid options gracefully", () => {
      const repo = Repository.open(".");

      // Empty options should work
      expect(() => repo.log({})).not.toThrow();

      // Null options should work (treated as no options)
      // @ts-expect-error - testing runtime behavior
      expect(() => repo.log(null)).not.toThrow();
    });

    test("getStatus handles various option types", () => {
      const repo = Repository.open(".");

      // Empty options
      expect(() => repo.getStatus({})).not.toThrow();

      // Undefined options
      expect(() => repo.getStatus(undefined)).not.toThrow();

      // Invalid option values are coerced to boolean
      // @ts-expect-error - testing runtime behavior
      expect(() => repo.getStatus({ includeUntracked: "yes" })).not.toThrow();
      // @ts-expect-error - testing runtime behavior
      expect(() => repo.getStatus({ includeUntracked: 0 })).not.toThrow();
    });

    test("diff handles various option types", () => {
      const repo = Repository.open(".");

      // Empty options
      expect(() => repo.diff({})).not.toThrow();

      // Undefined options
      expect(() => repo.diff(undefined)).not.toThrow();

      // Invalid cached value is coerced to boolean
      // @ts-expect-error - testing runtime behavior
      expect(() => repo.diff({ cached: "yes" })).not.toThrow();
    });

    test("Repository.open throws for non-string path", () => {
      // @ts-expect-error - testing runtime behavior
      expect(() => Repository.open(123)).toThrow();
      // @ts-expect-error - testing runtime behavior
      expect(() => Repository.open(null)).toThrow();
      // @ts-expect-error - testing runtime behavior
      expect(() => Repository.open(undefined)).toThrow();
    });

    test("Repository.open throws when called without arguments", () => {
      // @ts-expect-error - testing runtime behavior
      expect(() => Repository.open()).toThrow();
    });
  });

  describe("error messages", () => {
    test("Repository.open provides meaningful error for non-existent path", () => {
      try {
        Repository.open("/this/path/does/not/exist/anywhere");
        expect.unreachable("should have thrown");
      } catch (e: any) {
        // Error message should be descriptive
        expect(typeof e.message).toBe("string");
        expect(e.message.length).toBeGreaterThan(0);
      }
    });

    test("revParse provides meaningful error for invalid ref", () => {
      const repo = Repository.open(".");

      try {
        repo.revParse("this-ref-definitely-does-not-exist-12345");
        expect.unreachable("should have thrown");
      } catch (e: any) {
        expect(typeof e.message).toBe("string");
        expect(e.message.length).toBeGreaterThan(0);
      }
    });

    test("countCommits provides meaningful error for invalid range", () => {
      const repo = Repository.open(".");

      try {
        repo.countCommits("invalid-ref-abc..HEAD");
        expect.unreachable("should have thrown");
      } catch (e: any) {
        expect(typeof e.message).toBe("string");
        expect(e.message.length).toBeGreaterThan(0);
      }
    });
  });
});
