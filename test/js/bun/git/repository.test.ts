import { Commit, DeltaType, Repository, Status, StatusEntry } from "bun:git";
import { describe, expect, test } from "bun:test";

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

    test("Status constants are defined", () => {
      expect(Status.CURRENT).toBe(0);
      expect(Status.INDEX_NEW).toBe(1);
      expect(Status.INDEX_MODIFIED).toBe(2);
      expect(Status.INDEX_DELETED).toBe(4);
      expect(Status.INDEX_RENAMED).toBe(8);
      expect(Status.WT_NEW).toBe(128);
      expect(Status.WT_MODIFIED).toBe(256);
      expect(Status.WT_DELETED).toBe(512);
      expect(Status.IGNORED).toBe(16384);
      expect(Status.CONFLICTED).toBe(32768);
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

    test("revParse throws for invalid spec", () => {
      const repo = Repository.open(".");

      expect(() => repo.revParse("invalid-ref-that-does-not-exist")).toThrow();
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

    test("log returns commits in chronological order (newest first)", () => {
      const repo = Repository.open(".");
      const commits = repo.log({ limit: 5 });

      // Verify commits are sorted by time (newest first)
      for (let i = 1; i < commits.length; i++) {
        expect(commits[i - 1].time).toBeGreaterThanOrEqual(commits[i].time);
      }
    });
  });
});
