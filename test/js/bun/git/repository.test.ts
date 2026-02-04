import { Commit, Repository } from "bun:git";
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
});
