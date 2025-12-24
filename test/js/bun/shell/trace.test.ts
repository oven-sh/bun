import { $ } from "bun";
import { describe, expect, test } from "bun:test";

// Permission flags (octal) - mirrors the Zig constants
const Permission = {
  O_RDONLY: 0o0,
  O_WRONLY: 0o1,
  O_RDWR: 0o2,
  O_CREAT: 0o100,
  O_EXCL: 0o200,
  O_TRUNC: 0o1000,
  O_APPEND: 0o2000,
  X_OK: 0o100000,
  DELETE: 0o200000,
  MKDIR: 0o400000,
  CHDIR: 0o1000000,
  ENV: 0o2000000,
} as const;

// Convenience combinations
const READ = Permission.O_RDONLY;
const WRITE = Permission.O_WRONLY;
const CREATE = Permission.O_CREAT | Permission.O_WRONLY;
const CREATE_TRUNC = Permission.O_CREAT | Permission.O_TRUNC | Permission.O_WRONLY;
const APPEND = Permission.O_APPEND | Permission.O_WRONLY;
const EXECUTE = Permission.X_OK;

describe("Bun.$.trace", () => {
  test("returns trace result object", () => {
    const result = $.trace`echo hello`;
    expect(result).toHaveProperty("operations");
    expect(result).toHaveProperty("cwd");
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("error");
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(Array.isArray(result.operations)).toBe(true);
  });

  test("traces echo command (builtin, no file access)", () => {
    const result = $.trace`echo hello world`;
    expect(result.success).toBe(true);

    // echo is a builtin that runs in-process - no file access, no operations
    // It just writes to stdout (terminal) which doesn't require any permissions
    expect(result.operations.length).toBe(0);
  });

  test("traces cat command with file read", () => {
    const result = $.trace`cat /tmp/test.txt`;
    expect(result.success).toBe(true);

    // cat is a builtin - it reads files but runs in-process (no EXECUTE)
    const readOps = result.operations.filter(op => op.flags === READ && op.path?.endsWith("test.txt"));
    expect(readOps.length).toBe(1);
    expect(readOps[0].path).toBe("/tmp/test.txt");
  });

  test("traces rm command with delete permission", () => {
    const result = $.trace`rm /tmp/to-delete.txt`;
    expect(result.success).toBe(true);

    // Should have delete for the file
    const deleteOps = result.operations.filter(op => op.flags === Permission.DELETE);
    expect(deleteOps.length).toBe(1);
    expect(deleteOps[0].path).toBe("/tmp/to-delete.txt");
  });

  test("traces mkdir command", () => {
    const result = $.trace`mkdir /tmp/newdir`;
    expect(result.success).toBe(true);

    // Should have mkdir permission
    const mkdirOps = result.operations.filter(op => op.flags === Permission.MKDIR);
    expect(mkdirOps.length).toBe(1);
    expect(mkdirOps[0].path).toBe("/tmp/newdir");
  });

  test("traces touch command with create permission", () => {
    const result = $.trace`touch /tmp/newfile.txt`;
    expect(result.success).toBe(true);

    // Should have create permission
    const createOps = result.operations.filter(op => op.flags === CREATE);
    expect(createOps.length).toBe(1);
    expect(createOps[0].path).toBe("/tmp/newfile.txt");
  });

  test("traces cp command with read and write", () => {
    const result = $.trace`cp /tmp/src.txt /tmp/dst.txt`;
    expect(result.success).toBe(true);

    // Should have read for source
    const readOps = result.operations.filter(op => op.flags === READ && op.path?.endsWith("src.txt"));
    expect(readOps.length).toBe(1);

    // Should have create for destination
    const writeOps = result.operations.filter(op => op.flags === CREATE && op.path?.endsWith("dst.txt"));
    expect(writeOps.length).toBe(1);
  });

  test("traces mv command with read, delete, and write", () => {
    const result = $.trace`mv /tmp/old.txt /tmp/new.txt`;
    expect(result.success).toBe(true);

    // Should have read+delete for source (combined in one operation)
    const srcOps = result.operations.filter(
      op => op.flags === (READ | Permission.DELETE) && op.path?.endsWith("old.txt"),
    );
    expect(srcOps.length).toBe(1);

    // Should have create for destination
    const dstOps = result.operations.filter(op => op.flags === CREATE && op.path?.endsWith("new.txt"));
    expect(dstOps.length).toBe(1);
  });

  test("traces cd command with chdir permission", () => {
    const result = $.trace`cd /tmp`;
    expect(result.success).toBe(true);

    const chdirOps = result.operations.filter(op => op.flags === Permission.CHDIR);
    expect(chdirOps.length).toBe(1);
    expect(chdirOps[0].path).toBe("/tmp");
  });

  test("traces environment variable assignments with accumulated env", () => {
    const result = $.trace`FOO=1 BAR=2 echo test`;
    expect(result.success).toBe(true);

    const envOps = result.operations.filter(op => op.flags === Permission.ENV);
    expect(envOps.length).toBe(2);
    // First op has FOO
    expect(envOps[0].env).toEqual({ FOO: "1" });
    // Second op has both FOO and BAR
    expect(envOps[1].env?.FOO).toBe("1");
    expect(envOps[1].env?.BAR).toBe("2");
  });

  test("traces export with env values", () => {
    const result = $.trace`export FOO=hello BAR=world`;
    expect(result.success).toBe(true);

    const envOps = result.operations.filter(op => op.flags === Permission.ENV);
    expect(envOps.length).toBe(1);
    expect(envOps[0].env?.FOO).toBe("hello");
    expect(envOps[0].env?.BAR).toBe("world");
  });

  test("traces output redirection combined with command", () => {
    const result = $.trace`echo hello > /tmp/output.txt`;
    expect(result.success).toBe(true);

    // echo is a builtin - redirect creates the output file (CREATE_TRUNC, no EXECUTE)
    const redirectOps = result.operations.filter(op => op.flags === CREATE_TRUNC && op.path?.endsWith("output.txt"));
    expect(redirectOps.length).toBe(1);
  });

  test("traces append redirection combined with command", () => {
    const result = $.trace`echo hello >> /tmp/append.txt`;
    expect(result.success).toBe(true);

    // echo is a builtin - append redirect opens file for appending (no EXECUTE)
    const appendOps = result.operations.filter(op => op.flags === APPEND && op.path?.endsWith("append.txt"));
    expect(appendOps.length).toBe(1);
  });

  test("traces input redirection with read and stdin stream", () => {
    const result = $.trace`cat < /tmp/input.txt`;
    expect(result.success).toBe(true);

    // Should have read for input file with stdin stream marker
    const stdinOps = result.operations.filter(
      op => op.flags === READ && op.path?.endsWith("input.txt") && op.stream === "stdin",
    );
    expect(stdinOps.length).toBe(1);
  });

  test("traces stderr redirection with stream marker", () => {
    const result = $.trace`cat /nonexistent 2> /tmp/err.txt`;
    expect(result.success).toBe(true);

    // Should have stderr stream for error redirect
    const stderrOps = result.operations.filter(op => op.stream === "stderr" && op.path?.endsWith("err.txt"));
    expect(stderrOps.length).toBe(1);
    expect(stderrOps[0].flags).toBe(CREATE_TRUNC);
  });

  test("stdout redirect has stream marker", () => {
    const result = $.trace`echo hello > /tmp/out.txt`;
    expect(result.success).toBe(true);

    const stdoutOps = result.operations.filter(op => op.stream === "stdout");
    expect(stdoutOps.length).toBe(1);
    expect(stdoutOps[0].path).toBe("/tmp/out.txt");
  });

  test("traces export command with env permission", () => {
    const result = $.trace`export FOO=bar`;
    expect(result.success).toBe(true);

    const envOps = result.operations.filter(op => op.flags === Permission.ENV);
    expect(envOps.length).toBeGreaterThan(0);
  });

  test("traces variable assignment with env permission", () => {
    const result = $.trace`FOO=bar echo $FOO`;
    expect(result.success).toBe(true);

    const envOps = result.operations.filter(op => op.flags === Permission.ENV);
    expect(envOps.length).toBeGreaterThan(0);
  });

  test("traces pipeline", () => {
    const result = $.trace`cat /tmp/file.txt | grep pattern`;
    expect(result.success).toBe(true);

    // cat is a builtin - reads file (no EXECUTE, no command field)
    const readOps = result.operations.filter(op => op.flags === READ && op.path?.endsWith("file.txt"));
    expect(readOps.length).toBe(1);

    // grep is external, should have execute permission and command field
    const grepOps = result.operations.filter(op => op.command === "grep" && (op.flags & EXECUTE) !== 0);
    expect(grepOps.length).toBe(1);
  });

  test("traces ls with directory read", () => {
    const result = $.trace`ls /tmp`;
    expect(result.success).toBe(true);

    const readOps = result.operations.filter(op => op.flags === READ && op.path === "/tmp");
    expect(readOps.length).toBe(1);
  });

  test("traces ls without args (current dir)", () => {
    const result = $.trace`ls`;
    expect(result.success).toBe(true);

    // Should read current directory (.)
    const readOps = result.operations.filter(op => op.flags === READ);
    expect(readOps.length).toBe(1);
  });

  test("includes cwd in result", () => {
    const result = $.trace`echo test`;
    expect(result.cwd).toBeTruthy();
    expect(typeof result.cwd).toBe("string");
  });

  test("includes cwd in each operation", () => {
    const result = $.trace`cat /tmp/test.txt`;
    for (const op of result.operations) {
      expect(op.cwd).toBeTruthy();
      expect(typeof op.cwd).toBe("string");
    }
  });

  test("handles template literal interpolation", () => {
    const filename = "test.txt";
    const result = $.trace`cat /tmp/${filename}`;
    expect(result.success).toBe(true);

    const readOps = result.operations.filter(op => op.flags === READ && op.path?.endsWith("test.txt"));
    expect(readOps.length).toBe(1);
  });

  test("does not actually execute commands", () => {
    // This would fail if it actually ran, since the file doesn't exist
    const result = $.trace`cat /nonexistent/path/that/does/not/exist.txt`;
    expect(result.success).toBe(true);
    expect(result.operations.length).toBeGreaterThan(0);
  });

  test("external command resolves path when available", () => {
    const result = $.trace`/bin/ls /tmp`;
    expect(result.success).toBe(true);

    const execOps = result.operations.filter(op => op.flags === EXECUTE);
    expect(execOps.length).toBeGreaterThan(0);
    // Command name should be captured
    expect(execOps[0].command).toBe("/bin/ls");
  });

  test("external commands include args array", () => {
    const result = $.trace`grep -r 'pattern' src/`;
    expect(result.success).toBe(true);

    const execOps = result.operations.filter(op => op.flags === EXECUTE);
    expect(execOps.length).toBe(1);
    expect(execOps[0].command).toBe("grep");
    expect(execOps[0].args).toEqual(["-r", "pattern", "src/"]);
  });

  test("pipeline commands each have their own args", () => {
    const result = $.trace`git diff HEAD^ -- src/ | head -100`;
    expect(result.success).toBe(true);

    const execOps = result.operations.filter(op => op.flags === EXECUTE);
    expect(execOps.length).toBe(2);

    expect(execOps[0].command).toBe("git");
    expect(execOps[0].args).toEqual(["diff", "HEAD^", "--", "src/"]);

    expect(execOps[1].command).toBe("head");
    expect(execOps[1].args).toEqual(["-100"]);
  });

  test("builtins do not have args (tracked as file operations)", () => {
    const result = $.trace`cat file1.txt file2.txt`;
    expect(result.success).toBe(true);

    // Builtins track files, not args
    const readOps = result.operations.filter(op => op.flags === READ);
    expect(readOps.length).toBe(2);
    expect(readOps[0].args).toBeUndefined();
    expect(readOps[1].args).toBeUndefined();
  });

  test("traces && (and) operator", () => {
    const result = $.trace`cat /tmp/a.txt && cat /tmp/b.txt`;
    expect(result.success).toBe(true);

    // Both commands should be traced
    const readOps = result.operations.filter(op => op.flags === READ);
    expect(readOps.length).toBe(2);
    expect(readOps[0].path).toBe("/tmp/a.txt");
    expect(readOps[1].path).toBe("/tmp/b.txt");
  });

  test("traces || (or) operator", () => {
    const result = $.trace`cat /tmp/a.txt || cat /tmp/b.txt`;
    expect(result.success).toBe(true);

    // Both commands should be traced
    const readOps = result.operations.filter(op => op.flags === READ);
    expect(readOps.length).toBe(2);
  });

  test("traces subshell with cwd isolation", () => {
    const result = $.trace`(cd /tmp && ls) && ls`;
    expect(result.success).toBe(true);

    // Should have: CHDIR /tmp, READ /tmp (inside subshell), READ . (outside subshell)
    const chdirOps = result.operations.filter(op => op.flags === Permission.CHDIR);
    expect(chdirOps.length).toBe(1);
    expect(chdirOps[0].path).toBe("/tmp");

    const readOps = result.operations.filter(op => op.flags === READ);
    expect(readOps.length).toBe(2);
    // First ls inside subshell should see /tmp
    expect(readOps[0].cwd).toBe("/tmp");
    // Second ls outside subshell should see original cwd (subshell cwd is restored)
    expect(readOps[1].cwd).not.toBe("/tmp");
  });

  test("cd updates cwd for subsequent commands", () => {
    const result = $.trace`cd /tmp && ls`;
    expect(result.success).toBe(true);

    const readOps = result.operations.filter(op => op.flags === READ);
    expect(readOps.length).toBe(1);
    expect(readOps[0].cwd).toBe("/tmp");
    expect(readOps[0].path).toBe("/tmp"); // ls reads cwd
  });

  test("expands brace patterns", () => {
    const result = $.trace`cat /tmp/{a,b,c}.txt`;
    expect(result.success).toBe(true);

    const readOps = result.operations.filter(op => op.flags === READ);
    expect(readOps.length).toBe(3);
    expect(readOps[0].path).toBe("/tmp/a.txt");
    expect(readOps[1].path).toBe("/tmp/b.txt");
    expect(readOps[2].path).toBe("/tmp/c.txt");
  });

  test("expands tilde to home directory", () => {
    const result = $.trace`cat ~/.config/test.txt`;
    expect(result.success).toBe(true);

    const readOps = result.operations.filter(op => op.flags === READ);
    expect(readOps.length).toBe(1);
    expect(readOps[0].path).not.toContain("~");
    expect(readOps[0].path).toContain(".config/test.txt");
  });

  test("expands glob patterns to matching files", () => {
    // Create test files for glob expansion
    const fs = require("fs");
    const testDir = "/tmp/trace-glob-test";
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(`${testDir}/a.txt`, "");
    fs.writeFileSync(`${testDir}/b.txt`, "");
    fs.writeFileSync(`${testDir}/c.txt`, "");

    const result = $.trace`cat ${testDir}/*.txt`;
    expect(result.success).toBe(true);

    const readOps = result.operations.filter(op => op.flags === READ);
    expect(readOps.length).toBe(3);
    const paths = readOps.map(op => op.path).sort();
    expect(paths).toEqual([`${testDir}/a.txt`, `${testDir}/b.txt`, `${testDir}/c.txt`]);

    // Cleanup
    fs.rmSync(testDir, { recursive: true });
  });
});
