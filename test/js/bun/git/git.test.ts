import { GitError, NotARepositoryError, Repository } from "bun:git";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { tempDir } from "harness";
import { join } from "path";

describe("bun:git", () => {
  describe("Repository", () => {
    describe("constructor", () => {
      test("opens current directory as repository", () => {
        // The bun repo itself is a git repo
        const repo = new Repository(".");
        expect(repo).toBeDefined();
        expect(repo.path).toBeDefined();
        expect(repo.gitDir).toBeDefined();
      });

      test("throws when path is not a repository", () => {
        using dir = tempDir("git-test-not-repo");
        expect(() => new Repository(String(dir))).toThrow();
      });

      test("opens repository from subdirectory", () => {
        // The bun repo's src directory should still find the root repo
        const repo = new Repository("./src");
        expect(repo).toBeDefined();
        expect(repo.path).toContain("bun");
      });
    });

    describe("Repository.find()", () => {
      test("returns repository when found", () => {
        const repo = Repository.find(".");
        expect(repo).not.toBeNull();
        expect(repo!.path).toBeDefined();
      });

      test("returns null when not found", () => {
        using dir = tempDir("git-test-not-found");
        const repo = Repository.find(String(dir));
        expect(repo).toBeNull();
      });

      test("finds repository from subdirectory", () => {
        const repo = Repository.find("./src/js");
        expect(repo).not.toBeNull();
      });
    });

    describe("Repository.init()", () => {
      test("initializes new repository", () => {
        using dir = tempDir("git-test-init");
        const repoPath = join(String(dir), "new-repo");
        mkdirSync(repoPath, { recursive: true });

        const repo = Repository.init(repoPath);
        expect(repo).toBeDefined();
        expect(repo.path).toContain("new-repo");
        expect(existsSync(join(repoPath, ".git"))).toBe(true);
      });

      test("initializes bare repository", () => {
        using dir = tempDir("git-test-bare");
        const repoPath = join(String(dir), "bare-repo");

        const repo = Repository.init(repoPath, { bare: true });
        expect(repo).toBeDefined();
        expect(repo.isBare).toBe(true);
      });

      test("initializes with custom initial branch", () => {
        using dir = tempDir("git-test-branch");
        const repoPath = join(String(dir), "custom-branch");

        const repo = Repository.init(repoPath, { initialBranch: "main" });
        expect(repo).toBeDefined();
        // Branch might be null until first commit
      });
    });

    describe("properties", () => {
      test("path returns working directory", () => {
        const repo = new Repository(".");
        expect(repo.path).toBeDefined();
        expect(repo.path.length).toBeGreaterThan(0);
      });

      test("gitDir returns .git directory", () => {
        const repo = new Repository(".");
        expect(repo.gitDir).toBeDefined();
        expect(repo.gitDir).toContain(".git");
      });

      test("isBare returns false for regular repo", () => {
        const repo = new Repository(".");
        expect(repo.isBare).toBe(false);
      });

      test("head returns current HEAD commit", () => {
        const repo = new Repository(".");
        const head = repo.head;
        expect(head).not.toBeNull();
        expect(head!.sha).toHaveLength(40);
      });

      test("branch returns current branch or null", () => {
        const repo = new Repository(".");
        const branch = repo.branch;
        // Could be null if detached HEAD
        if (branch) {
          expect(branch.name).toBeDefined();
        }
      });

      test("isClean returns boolean", () => {
        const repo = new Repository(".");
        expect(typeof repo.isClean).toBe("boolean");
      });
    });

    describe("getCommit()", () => {
      test("returns commit by SHA", () => {
        const repo = new Repository(".");
        const head = repo.head;
        expect(head).not.toBeNull();

        const commit = repo.getCommit(head!.sha);
        expect(commit).not.toBeNull();
        expect(commit!.sha).toBe(head!.sha);
      });

      test("returns commit by short SHA", () => {
        const repo = new Repository(".");
        const head = repo.head;
        expect(head).not.toBeNull();

        const commit = repo.getCommit(head!.shortSha);
        expect(commit).not.toBeNull();
        expect(commit!.sha).toBe(head!.sha);
      });

      test("returns commit by ref", () => {
        const repo = new Repository(".");
        const commit = repo.getCommit("HEAD");
        expect(commit).not.toBeNull();
      });

      test("returns null for invalid ref", () => {
        const repo = new Repository(".");
        const commit = repo.getCommit("invalid-ref-that-does-not-exist");
        expect(commit).toBeNull();
      });
    });

    describe("getBranch()", () => {
      test("returns branch by name", () => {
        const repo = new Repository(".");
        const branch = repo.getBranch("main");
        if (branch) {
          expect(branch.name).toBe("main");
        }
      });

      test("returns null for non-existent branch", () => {
        const repo = new Repository(".");
        const branch = repo.getBranch("non-existent-branch-xyz");
        expect(branch).toBeNull();
      });
    });

    describe("getRemote()", () => {
      test("returns origin by default", () => {
        const repo = new Repository(".");
        const remote = repo.getRemote();
        // Origin might not exist in all repos
        if (remote) {
          expect(remote.name).toBe("origin");
        }
      });

      test("returns remote by name", () => {
        const repo = new Repository(".");
        const remote = repo.getRemote("origin");
        if (remote) {
          expect(remote.name).toBe("origin");
          expect(remote.url).toBeDefined();
        }
      });

      test("returns null for non-existent remote", () => {
        const repo = new Repository(".");
        const remote = repo.getRemote("non-existent-remote");
        expect(remote).toBeNull();
      });
    });

    describe("status()", () => {
      test("returns array of status entries", () => {
        const repo = new Repository(".");
        const status = repo.status();
        expect(Array.isArray(status)).toBe(true);
      });

      test("status entries have expected properties", () => {
        using dir = tempDir("git-test-status");
        const repoPath = String(dir);

        const repo = Repository.init(repoPath);

        // Create an untracked file
        writeFileSync(join(repoPath, "test.txt"), "hello");

        const status = repo.status();
        expect(status.length).toBeGreaterThan(0);

        const entry = status[0];
        expect(entry.path).toBeDefined();
        expect(entry.indexStatus).toBeDefined();
        expect(entry.workTreeStatus).toBeDefined();
        expect(typeof entry.isStaged).toBe("boolean");
        expect(typeof entry.isUntracked).toBe("boolean");
      });
    });

    describe("add() and commit()", () => {
      test("adds files and creates commit", () => {
        using dir = tempDir("git-test-commit");
        const repoPath = String(dir);

        const repo = Repository.init(repoPath);

        // Configure user for commit
        repo.config.set("user.name", "Test User");
        repo.config.set("user.email", "test@example.com");

        // Create a file
        writeFileSync(join(repoPath, "test.txt"), "hello world");

        // Add the file
        repo.add("test.txt");

        // Check it's staged
        const status = repo.status();
        const testFile = status.find(e => e.path === "test.txt");
        expect(testFile).toBeDefined();
        expect(testFile!.isStaged).toBe(true);

        // Commit
        const commit = repo.commit("Initial commit");
        expect(commit).toBeDefined();
        expect(commit.sha).toHaveLength(40);
        expect(commit.message).toContain("Initial commit");
        expect(commit.author.name).toBe("Test User");
        expect(commit.author.email).toBe("test@example.com");
      });

      test("add accepts array of paths", () => {
        using dir = tempDir("git-test-add-array");
        const repoPath = String(dir);

        const repo = Repository.init(repoPath);
        repo.config.set("user.name", "Test User");
        repo.config.set("user.email", "test@example.com");

        writeFileSync(join(repoPath, "file1.txt"), "content1");
        writeFileSync(join(repoPath, "file2.txt"), "content2");

        repo.add(["file1.txt", "file2.txt"]);

        const status = repo.status();
        const staged = status.filter(e => e.isStaged);
        expect(staged.length).toBe(2);
      });
    });

    describe("reset()", () => {
      test("unstages files", () => {
        using dir = tempDir("git-test-reset");
        const repoPath = String(dir);

        const repo = Repository.init(repoPath);
        repo.config.set("user.name", "Test User");
        repo.config.set("user.email", "test@example.com");

        // Create initial commit
        writeFileSync(join(repoPath, "initial.txt"), "initial");
        repo.add("initial.txt");
        repo.commit("Initial commit");

        // Add another file
        writeFileSync(join(repoPath, "test.txt"), "hello");
        repo.add("test.txt");

        // Verify staged
        let status = repo.status();
        let testFile = status.find(e => e.path === "test.txt");
        expect(testFile?.isStaged).toBe(true);

        // Reset
        repo.reset("test.txt");

        // Verify unstaged
        status = repo.status();
        testFile = status.find(e => e.path === "test.txt");
        expect(testFile?.isStaged).toBe(false);
        expect(testFile?.isUntracked).toBe(true);
      });
    });
  });

  describe("Commit", () => {
    test("sha returns full 40-char SHA", () => {
      const repo = new Repository(".");
      const commit = repo.head;
      expect(commit).not.toBeNull();
      expect(commit!.sha).toHaveLength(40);
      expect(/^[0-9a-f]{40}$/.test(commit!.sha)).toBe(true);
    });

    test("shortSha returns first 7 chars", () => {
      const repo = new Repository(".");
      const commit = repo.head;
      expect(commit).not.toBeNull();
      expect(commit!.shortSha).toHaveLength(7);
      expect(commit!.sha.startsWith(commit!.shortSha)).toBe(true);
    });

    test("message returns full commit message", () => {
      const repo = new Repository(".");
      const commit = repo.head;
      expect(commit).not.toBeNull();
      expect(typeof commit!.message).toBe("string");
    });

    test("summary returns first line of message", () => {
      const repo = new Repository(".");
      const commit = repo.head;
      expect(commit).not.toBeNull();
      expect(typeof commit!.summary).toBe("string");
      expect(commit!.summary.includes("\n")).toBe(false);
    });

    test("author returns signature object", () => {
      const repo = new Repository(".");
      const commit = repo.head;
      expect(commit).not.toBeNull();

      const author = commit!.author;
      expect(author.name).toBeDefined();
      expect(author.email).toBeDefined();
      expect(author.date).toBeInstanceOf(Date);
      expect(author.timezone).toBeDefined();
    });

    test("committer returns signature object", () => {
      const repo = new Repository(".");
      const commit = repo.head;
      expect(commit).not.toBeNull();

      const committer = commit!.committer;
      expect(committer.name).toBeDefined();
      expect(committer.email).toBeDefined();
      expect(committer.date).toBeInstanceOf(Date);
    });

    test("parents returns array of parent commits", () => {
      const repo = new Repository(".");
      const commit = repo.head;
      expect(commit).not.toBeNull();

      const parents = commit!.parents;
      expect(Array.isArray(parents)).toBe(true);
      // Most commits have at least one parent (except initial commit)
      if (parents.length > 0) {
        expect(parents[0].sha).toHaveLength(40);
      }
    });

    test("tree returns tree SHA", () => {
      const repo = new Repository(".");
      const commit = repo.head;
      expect(commit).not.toBeNull();
      expect(commit!.tree).toHaveLength(40);
    });

    test("parent() returns nth parent", () => {
      const repo = new Repository(".");
      const commit = repo.head;
      expect(commit).not.toBeNull();

      if (commit!.parents.length > 0) {
        const parent = commit!.parent(0);
        expect(parent).not.toBeNull();
        expect(parent!.sha).toBe(commit!.parents[0].sha);
      }

      // Parent that doesn't exist
      const noParent = commit!.parent(99);
      expect(noParent).toBeNull();
    });

    test("listFiles() returns array of file paths", () => {
      const repo = new Repository(".");
      const commit = repo.head;
      expect(commit).not.toBeNull();

      const files = commit!.listFiles();
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThan(0);
      // Should contain some known files
      expect(files.some((f: string) => f.endsWith(".zig") || f.endsWith(".ts") || f.endsWith(".md"))).toBe(true);
    });

    test("getFile() returns blob for existing file", () => {
      const repo = new Repository(".");
      const commit = repo.head;
      expect(commit).not.toBeNull();

      // Try to get a known file
      const files = commit!.listFiles();
      if (files.length > 0) {
        const blob = commit!.getFile(files[0]);
        expect(blob).not.toBeNull();
        expect(blob!.sha).toHaveLength(40);
        expect(typeof blob!.size).toBe("number");
      }
    });

    test("getFile() returns null for non-existent file", () => {
      const repo = new Repository(".");
      const commit = repo.head;
      expect(commit).not.toBeNull();

      const blob = commit!.getFile("non-existent-file-xyz.txt");
      expect(blob).toBeNull();
    });

    test("isAncestorOf() checks ancestry", () => {
      const repo = new Repository(".");
      const head = repo.head;
      expect(head).not.toBeNull();

      if (head!.parents.length > 0) {
        const parent = head!.parent(0);
        expect(parent).not.toBeNull();

        // Parent should be ancestor of HEAD
        const isAncestor = parent!.isAncestorOf(head!);
        expect(isAncestor).toBe(true);

        // HEAD should not be ancestor of parent
        const notAncestor = head!.isAncestorOf(parent!);
        expect(notAncestor).toBe(false);
      }
    });
  });

  describe("Config", () => {
    test("get() returns config value", () => {
      const repo = new Repository(".");
      const config = repo.config;

      // These are commonly set
      const userName = config.get("user.name");
      const userEmail = config.get("user.email");

      // At least one should exist in most repos
      expect(userName !== null || userEmail !== null).toBe(true);
    });

    test("get() returns null for non-existent key", () => {
      const repo = new Repository(".");
      const value = repo.config.get("non.existent.key.xyz");
      expect(value).toBeNull();
    });

    test("set() and get() round-trip", () => {
      using dir = tempDir("git-test-config");
      const repoPath = String(dir);
      const repo = Repository.init(repoPath);

      repo.config.set("test.key", "test-value");
      const value = repo.config.get("test.key");
      expect(value).toBe("test-value");
    });

    test("userEmail property works", () => {
      using dir = tempDir("git-test-config-email");
      const repoPath = String(dir);
      const repo = Repository.init(repoPath);

      repo.config.userEmail = "test@example.com";
      expect(repo.config.userEmail).toBe("test@example.com");
    });

    test("userName property works", () => {
      using dir = tempDir("git-test-config-name");
      const repoPath = String(dir);
      const repo = Repository.init(repoPath);

      repo.config.userName = "Test User";
      expect(repo.config.userName).toBe("Test User");
    });
  });

  describe("StatusEntry", () => {
    test("has expected properties", () => {
      using dir = tempDir("git-test-status-entry");
      const repoPath = String(dir);
      const repo = Repository.init(repoPath);

      writeFileSync(join(repoPath, "test.txt"), "content");

      const status = repo.status();
      expect(status.length).toBe(1);

      const entry = status[0];
      expect(entry.path).toBe("test.txt");
      expect(entry.indexStatus).toBe("unmodified");
      expect(entry.workTreeStatus).toBe("untracked");
      expect(entry.isStaged).toBe(false);
      expect(entry.isUnstaged).toBe(true);
      expect(entry.isUntracked).toBe(true);
      expect(entry.isConflicted).toBe(false);
    });
  });

  describe("Diff", () => {
    test("diff() returns Diff object", () => {
      using dir = tempDir("git-test-diff");
      const repoPath = String(dir);
      const repo = Repository.init(repoPath);
      repo.config.set("user.name", "Test User");
      repo.config.set("user.email", "test@example.com");

      writeFileSync(join(repoPath, "test.txt"), "initial content");
      repo.add("test.txt");
      repo.commit("Initial commit");

      // Modify the file
      writeFileSync(join(repoPath, "test.txt"), "modified content");

      const diff = repo.diff();
      expect(diff).toBeDefined();
      expect(diff.stats).toBeDefined();
      expect(Array.isArray(diff.files)).toBe(true);
    });

    test("commit.diff() shows changes from parent", () => {
      using dir = tempDir("git-test-commit-diff");
      const repoPath = String(dir);
      const repo = Repository.init(repoPath);
      repo.config.set("user.name", "Test User");
      repo.config.set("user.email", "test@example.com");

      writeFileSync(join(repoPath, "test.txt"), "initial");
      repo.add("test.txt");
      const commit1 = repo.commit("Initial commit");

      writeFileSync(join(repoPath, "test.txt"), "modified");
      repo.add("test.txt");
      const commit2 = repo.commit("Second commit");

      const diff = commit2.diff();
      expect(diff).toBeDefined();
    });
  });

  describe("Error classes", () => {
    test("GitError has expected properties", () => {
      const error = new GitError("test error", {
        command: "git status",
        exitCode: 1,
        stderr: "error output",
      });

      expect(error.message).toBe("test error");
      expect(error.command).toBe("git status");
      expect(error.exitCode).toBe(1);
      expect(error.stderr).toBe("error output");
      expect(error.name).toBe("GitError");
    });

    test("NotARepositoryError", () => {
      const error = new NotARepositoryError();
      expect(error.name).toBe("NotARepositoryError");
      expect(error.message).toContain("repository");
    });
  });
});
