import * as git from "bun:git";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const { Repository, Commit, Branch, Signature } = git;

describe("bun:git module exports", () => {
  test("exports Repository constructor", () => {
    expect(Repository).toBeDefined();
    expect(typeof Repository).toBe("function");
  });

  test("exports Commit constructor", () => {
    expect(Commit).toBeDefined();
    expect(typeof Commit).toBe("function");
  });

  test("exports Branch constructor", () => {
    expect(Branch).toBeDefined();
    expect(typeof Branch).toBe("function");
  });

  test("exports Signature constructor", () => {
    expect(Signature).toBeDefined();
    expect(typeof Signature).toBe("function");
  });

  test("new Repository() finds repo from current directory", () => {
    // new Repository() is supported and finds the repo from current directory
    // This tests from the bun workspace which is a git repo
    const repo = new (Repository as any)();
    expect(repo).toBeDefined();
    expect(repo.path).toBeDefined();
  });

  test("Commit cannot be directly constructed", () => {
    expect(() => new (Commit as any)()).toThrow();
  });

  test("Branch cannot be directly constructed", () => {
    expect(() => new (Branch as any)()).toThrow();
  });

  test("Signature cannot be directly constructed", () => {
    expect(() => new (Signature as any)()).toThrow();
  });
});

describe("Repository.find()", () => {
  let repoDir: string;

  beforeAll(async () => {
    // Create a temp directory and initialize a git repo
    repoDir = await mkdtemp(join(tmpdir(), "bun-git-test-"));
    await Bun.$`git init ${repoDir}`.quiet();
    await Bun.$`git -C ${repoDir} config user.email "test@example.com"`.quiet();
    await Bun.$`git -C ${repoDir} config user.name "Test User"`.quiet();
  });

  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  test("finds repository from exact path", () => {
    const repo = Repository.find(repoDir);
    expect(repo).toBeDefined();
    expect(repo.path).toBe(repoDir + "/");
  });

  test("finds repository from subdirectory", async () => {
    const subDir = join(repoDir, "subdir");
    await mkdir(subDir, { recursive: true });

    const repo = Repository.find(subDir);
    expect(repo).toBeDefined();
    expect(repo.path).toBe(repoDir + "/");
  });

  test("finds repository with default path (current directory)", () => {
    const originalCwd = process.cwd();
    try {
      process.chdir(repoDir);
      const repo = Repository.find();
      expect(repo).toBeDefined();
      expect(repo.path).toBe(repoDir + "/");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("returns null when no repository found", async () => {
    const noRepoDir = await mkdtemp(join(tmpdir(), "bun-git-no-repo-"));
    try {
      const repo = Repository.find(noRepoDir);
      expect(repo).toBeNull();
    } finally {
      await rm(noRepoDir, { recursive: true, force: true });
    }
  });

  test("repository has correct properties", () => {
    const repo = Repository.find(repoDir);
    expect(repo).toBeDefined();
    expect(repo!.path).toContain(repoDir);
    expect(repo!.gitDir).toContain(".git");
    expect(repo!.isBare).toBe(false);
  });
});

describe("Repository.init()", () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = await mkdtemp(join(tmpdir(), "bun-git-init-test-"));
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("initializes a new repository", async () => {
    const newRepoPath = join(testDir, "new-repo");
    await mkdir(newRepoPath);

    const repo = Repository.init(newRepoPath);
    expect(repo).toBeDefined();
    expect(repo.path).toBe(newRepoPath + "/");
    expect(repo.isBare).toBe(false);

    // Verify .git directory was created
    const gitDir = await stat(join(newRepoPath, ".git"));
    expect(gitDir.isDirectory()).toBe(true);
  });

  test("initializes a bare repository", async () => {
    const bareRepoPath = join(testDir, "bare-repo");
    await mkdir(bareRepoPath);

    const repo = Repository.init(bareRepoPath, { bare: true });
    expect(repo).toBeDefined();
    expect(repo.isBare).toBe(true);
  });

  test("init creates directory if it doesn't exist", async () => {
    // libgit2 creates the directory structure if needed
    const newPath = join(testDir, "auto-created-repo");
    const repo = Repository.init(newPath);
    expect(repo).toBeDefined();
    expect(repo.path).toBe(newPath + "/");
  });
});

describe("Repository with commits", () => {
  let repoDir: string;
  let repo: InstanceType<typeof Repository>;

  beforeAll(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "bun-git-commit-test-"));
    await Bun.$`git init ${repoDir}`.quiet();
    await Bun.$`git -C ${repoDir} config user.email "test@example.com"`.quiet();
    await Bun.$`git -C ${repoDir} config user.name "Test User"`.quiet();

    // Create initial commit
    await writeFile(join(repoDir, "README.md"), "# Test Repo\n");
    await Bun.$`git -C ${repoDir} add README.md`.quiet();
    await Bun.$`git -C ${repoDir} commit -m "Initial commit"`.quiet();

    // Create second commit
    await writeFile(join(repoDir, "file1.txt"), "content1\n");
    await Bun.$`git -C ${repoDir} add file1.txt`.quiet();
    await Bun.$`git -C ${repoDir} commit -m "Add file1"`.quiet();

    repo = Repository.find(repoDir)!;
  });

  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  test("repository has head as Commit object", () => {
    expect(repo.head).toBeDefined();
    expect(typeof repo.head).toBe("object");
    expect(repo.head.sha).toBeDefined();
    expect(repo.head.sha.length).toBe(40); // SHA-1 hash length
  });

  test("repository has branch", () => {
    const branch = repo.branch;
    expect(branch).toBeDefined();
    expect(branch!.name).toMatch(/^(main|master)$/);
    expect(branch!.isHead).toBe(true);
    expect(branch!.isRemote).toBe(false);
  });

  test("getCommit returns commit object", () => {
    const commit = repo.getCommit(repo.head.sha);
    expect(commit).toBeDefined();
    expect(commit!.sha).toBe(repo.head.sha);
    expect(commit!.shortSha.length).toBe(7);
    expect(commit!.message).toBe("Add file1\n");
    expect(commit!.summary).toBe("Add file1");
  });

  test("getCommit returns null for invalid SHA", () => {
    const commit = repo.getCommit("0000000000000000000000000000000000000000");
    expect(commit).toBeNull();
  });

  test("commit has author signature", () => {
    const commit = repo.getCommit(repo.head.sha);
    expect(commit!.author).toBeDefined();
    expect(commit!.author.name).toBe("Test User");
    expect(commit!.author.email).toBe("test@example.com");
    expect(commit!.author.date).toBeInstanceOf(Date);
  });

  test("commit has committer signature", () => {
    const commit = repo.getCommit(repo.head.sha);
    expect(commit!.committer).toBeDefined();
    expect(commit!.committer.name).toBe("Test User");
    expect(commit!.committer.email).toBe("test@example.com");
  });

  test("commit has parent", () => {
    const commit = repo.getCommit(repo.head.sha);
    expect(commit!.parents).toBeDefined();
    expect(commit!.parents.length).toBe(1);

    const parent = commit!.parent(0);
    expect(parent).toBeDefined();
    expect(parent!.message).toBe("Initial commit\n");
  });

  test("commit.isAncestorOf works", () => {
    const headCommit = repo.getCommit(repo.head.sha)!;
    const parentCommit = headCommit.parent(0)!;

    expect(parentCommit.isAncestorOf(headCommit)).toBe(true);
    expect(headCommit.isAncestorOf(parentCommit)).toBe(false);
  });
});

describe("Branch operations", () => {
  let repoDir: string;
  let repo: InstanceType<typeof Repository>;

  beforeAll(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "bun-git-branch-test-"));
    await Bun.$`git init ${repoDir}`.quiet();
    await Bun.$`git -C ${repoDir} config user.email "test@example.com"`.quiet();
    await Bun.$`git -C ${repoDir} config user.name "Test User"`.quiet();

    await writeFile(join(repoDir, "README.md"), "# Test\n");
    await Bun.$`git -C ${repoDir} add README.md`.quiet();
    await Bun.$`git -C ${repoDir} commit -m "Initial commit"`.quiet();

    // Create a feature branch
    await Bun.$`git -C ${repoDir} branch feature-branch`.quiet();

    repo = Repository.find(repoDir)!;
  });

  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  test("branch has name property", () => {
    const branch = repo.branch;
    expect(branch).toBeDefined();
    expect(branch!.name).toMatch(/^(main|master)$/);
  });

  test("branch has fullName property", () => {
    const branch = repo.branch;
    expect(branch!.fullName).toMatch(/^refs\/heads\/(main|master)$/);
  });

  test("branch has isHead property", () => {
    const branch = repo.branch;
    expect(branch!.isHead).toBe(true);
  });

  test("branch has isRemote property", () => {
    const branch = repo.branch;
    expect(branch!.isRemote).toBe(false);
  });

  test("branch has commit property", () => {
    const branch = repo.branch;
    const commit = branch!.commit;
    expect(commit).toBeDefined();
    // head is a Commit object, so compare SHAs
    expect(commit.sha).toBe(repo.head.sha);
  });

  test("branch upstream is null for local branch", () => {
    const branch = repo.branch;
    expect(branch!.upstream).toBeNull();
  });

  test("branch ahead/behind are 0 without upstream", () => {
    const branch = repo.branch;
    expect(branch!.ahead).toBe(0);
    expect(branch!.behind).toBe(0);
  });
});

describe("Repository.status()", () => {
  let repoDir: string;
  let repo: InstanceType<typeof Repository>;

  beforeAll(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "bun-git-status-test-"));
    await Bun.$`git init ${repoDir}`.quiet();
    await Bun.$`git -C ${repoDir} config user.email "test@example.com"`.quiet();
    await Bun.$`git -C ${repoDir} config user.name "Test User"`.quiet();

    await writeFile(join(repoDir, "README.md"), "# Test\n");
    await Bun.$`git -C ${repoDir} add README.md`.quiet();
    await Bun.$`git -C ${repoDir} commit -m "Initial commit"`.quiet();

    repo = Repository.find(repoDir)!;
  });

  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  test("status returns empty array for clean repo", () => {
    const status = repo.status();
    expect(status).toEqual([]);
  });

  test("status shows new file", async () => {
    await writeFile(join(repoDir, "new-file.txt"), "new content\n");

    const status = repo.status();
    expect(status.length).toBe(1);
    expect(status[0].path).toBe("new-file.txt");
    expect(status[0].workTreeStatus).toBe("untracked");
    expect(status[0].indexStatus).toBe("unmodified");

    // Cleanup
    await rm(join(repoDir, "new-file.txt"));
  });

  test("status shows modified file", async () => {
    await writeFile(join(repoDir, "README.md"), "# Modified Test\n");

    const status = repo.status();
    expect(status.length).toBe(1);
    expect(status[0].path).toBe("README.md");
    expect(status[0].workTreeStatus).toBe("modified");

    // Restore
    await Bun.$`git -C ${repoDir} checkout README.md`.quiet();
  });

  test("isClean returns true for clean repo", async () => {
    // Make sure repo is clean first
    await Bun.$`git -C ${repoDir} checkout .`.quiet();
    const freshRepo = Repository.find(repoDir)!;
    expect(freshRepo.isClean).toBe(true);
  });

  test("isClean returns false for dirty repo", async () => {
    await writeFile(join(repoDir, "dirty.txt"), "dirty\n");

    // Need to refresh the repo
    const freshRepo = Repository.find(repoDir)!;
    expect(freshRepo.isClean).toBe(false);

    // Cleanup
    await rm(join(repoDir, "dirty.txt"));
  });
});

describe("Repository.add() and commit()", () => {
  let repoDir: string;
  let repo: InstanceType<typeof Repository>;

  beforeAll(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "bun-git-add-test-"));
    await Bun.$`git init ${repoDir}`.quiet();
    await Bun.$`git -C ${repoDir} config user.email "test@example.com"`.quiet();
    await Bun.$`git -C ${repoDir} config user.name "Test User"`.quiet();

    await writeFile(join(repoDir, "README.md"), "# Test\n");
    await Bun.$`git -C ${repoDir} add README.md`.quiet();
    await Bun.$`git -C ${repoDir} commit -m "Initial commit"`.quiet();

    repo = Repository.find(repoDir)!;
  });

  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  test("add stages a file", async () => {
    await writeFile(join(repoDir, "staged.txt"), "staged content\n");

    repo.add("staged.txt");

    const status = repo.status();
    const staged = status.find(s => s.path === "staged.txt");
    expect(staged).toBeDefined();
    expect(staged!.indexStatus).toBe("added");

    // Unstage for cleanup
    await Bun.$`git -C ${repoDir} reset HEAD staged.txt`.quiet();
    await rm(join(repoDir, "staged.txt"));
  });

  test("add stages multiple files", async () => {
    await writeFile(join(repoDir, "file1.txt"), "content1\n");
    await writeFile(join(repoDir, "file2.txt"), "content2\n");

    repo.add(["file1.txt", "file2.txt"]);

    const status = repo.status();
    const addedFiles = status.filter(s => s.indexStatus === "added");
    expect(addedFiles.some(s => s.path === "file1.txt")).toBe(true);
    expect(addedFiles.some(s => s.path === "file2.txt")).toBe(true);

    // Cleanup
    await Bun.$`git -C ${repoDir} reset HEAD file1.txt file2.txt`.quiet();
    await rm(join(repoDir, "file1.txt"));
    await rm(join(repoDir, "file2.txt"));
  });

  test("commit creates new commit", async () => {
    await writeFile(join(repoDir, "committed.txt"), "committed content\n");
    repo.add("committed.txt");

    const oldHeadSha = repo.head.sha;
    const newCommit = repo.commit("Test commit message");

    expect(newCommit).toBeDefined();
    expect(newCommit.sha).toBeDefined();
    expect(newCommit.sha.length).toBe(40);
    expect(newCommit.sha).not.toBe(oldHeadSha);

    const commit = repo.getCommit(newCommit.sha);
    expect(commit!.message).toContain("Test commit message");
  });
});

describe("Signature", () => {
  let repoDir: string;
  let repo: InstanceType<typeof Repository>;

  beforeAll(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "bun-git-sig-test-"));
    await Bun.$`git init ${repoDir}`.quiet();
    await Bun.$`git -C ${repoDir} config user.email "test@example.com"`.quiet();
    await Bun.$`git -C ${repoDir} config user.name "Test User"`.quiet();

    await writeFile(join(repoDir, "README.md"), "# Test\n");
    await Bun.$`git -C ${repoDir} add README.md`.quiet();
    await Bun.$`git -C ${repoDir} commit -m "Initial commit"`.quiet();

    repo = Repository.find(repoDir)!;
  });

  afterAll(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  test("signature has name property", () => {
    const commit = repo.getCommit(repo.head.sha);
    const sig = commit!.author;
    expect(sig.name).toBe("Test User");
  });

  test("signature has email property", () => {
    const commit = repo.getCommit(repo.head.sha);
    const sig = commit!.author;
    expect(sig.email).toBe("test@example.com");
  });

  test("signature has date property", () => {
    const commit = repo.getCommit(repo.head.sha);
    const sig = commit!.author;
    expect(sig.date).toBeInstanceOf(Date);
    expect(sig.date.getTime()).toBeLessThanOrEqual(Date.now());
    expect(sig.date.getTime()).toBeGreaterThan(Date.now() - 60000); // Within last minute
  });

  test("signature has timezone property", () => {
    const commit = repo.getCommit(repo.head.sha);
    const sig = commit!.author;
    expect(sig.timezone).toMatch(/^[+-]\d{2}:\d{2}$/);
  });

  test("signature toString() returns formatted string", () => {
    const commit = repo.getCommit(repo.head.sha);
    const sig = commit!.author;
    expect(sig.toString()).toBe("Test User <test@example.com>");
  });
});

describe("Error handling", () => {
  test("Repository.find returns null for invalid argument type", () => {
    // find() coerces arguments to string, so 123 becomes "123" which is not a valid repo
    const result = (Repository as any).find(123);
    expect(result).toBeNull();
  });

  test("Repository.init throws on missing path", () => {
    expect(() => (Repository as any).init()).toThrow();
  });

  test("getCommit handles invalid sha gracefully", () => {
    const repoDir = process.cwd(); // Use current bun repo
    const repo = Repository.find(repoDir);
    if (repo) {
      const result = repo.getCommit("invalid-sha");
      expect(result).toBeNull();
    }
  });
});

describe("Using Bun repository", () => {
  test("can find Bun repository", () => {
    const repo = Repository.find(process.cwd());
    expect(repo).toBeDefined();
  });

  test("Bun repo has commits", () => {
    const repo = Repository.find(process.cwd());
    if (repo) {
      expect(repo.head).toBeDefined();
      expect(repo.head.sha.length).toBe(40);

      const commit = repo.getCommit(repo.head.sha);
      expect(commit).toBeDefined();
      expect(commit!.message.length).toBeGreaterThan(0);
    }
  });

  test("Bun repo has branch", () => {
    const repo = Repository.find(process.cwd());
    if (repo) {
      const branch = repo.branch;
      expect(branch).toBeDefined();
      expect(branch!.name.length).toBeGreaterThan(0);
    }
  });
});
