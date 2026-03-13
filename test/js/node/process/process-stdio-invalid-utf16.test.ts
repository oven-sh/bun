import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe.concurrent.each(["stdout", "stderr"])("process.%s.write with invalid UTF-16", stream => {
  test("single unpaired high surrogate (D800)", async () => {
    using dir = tempDir("stdio-utf16", {
      "test.js": `
        process.${stream}.write(String.fromCharCode(0xD800));
        process.${stream}.write("\\n");
        ${stream === "stdout" ? "" : 'console.log("Done");'}
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    if (stream === "stdout") {
      expect(stdout).toBe("�\n");
    } else {
      expect(stdout).toBe("Done\n");
      expect(stderr).toBe("�\n");
    }
  });

  test("single unpaired low surrogate (DC00)", async () => {
    using dir = tempDir("stdio-utf16", {
      "test.js": `
        process.${stream}.write(String.fromCharCode(0xDC00));
        process.${stream}.write("\\n");
        ${stream === "stdout" ? "" : 'console.log("Done");'}
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    if (stream === "stdout") {
      expect(stdout).toBe("�\n");
    } else {
      expect(stdout).toBe("Done\n");
      expect(stderr).toBe("�\n");
    }
  });

  test("trailing unpaired high surrogate should not duplicate output", async () => {
    // This was the main bug: strings ending with high surrogates (D800-DBFF)
    // would duplicate the output ~32 times
    using dir = tempDir("stdio-utf16", {
      "test.js": `
        process.${stream}.write("Help" + String.fromCharCode(0xD800));
        process.${stream}.write("\\n");
        process.${stream}.write("Test" + String.fromCharCode(0xDBFF));
        process.${stream}.write("\\n");
        ${stream === "stdout" ? "" : 'console.log("Done");'}
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const output = stream === "stdout" ? stdout : stderr;
    expect(output).toBe("Help�\nTest�\n");

    // Also verify no duplication
    expect((output.match(/Help/g) || []).length).toBe(1);
    expect((output.match(/Test/g) || []).length).toBe(1);

    if (stream === "stderr") {
      expect(stdout).toBe("Done\n");
    }
  });

  test("trailing unpaired low surrogate", async () => {
    using dir = tempDir("stdio-utf16", {
      "test.js": `
        process.${stream}.write("Hello" + String.fromCharCode(0xDC00));
        process.${stream}.write("\\n");
        process.${stream}.write("World" + String.fromCharCode(0xDFFF));
        process.${stream}.write("\\n");
        ${stream === "stdout" ? "" : 'console.log("Done");'}
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    if (stream === "stdout") {
      expect(stdout).toBe("Hello�\nWorld�\n");
    } else {
      expect(stdout).toBe("Done\n");
      expect(stderr).toBe("Hello�\nWorld�\n");
    }
  });

  test("leading unpaired surrogates", async () => {
    using dir = tempDir("stdio-utf16", {
      "test.js": `
        process.${stream}.write(String.fromCharCode(0xD800) + "Hello");
        process.${stream}.write("\\n");
        process.${stream}.write(String.fromCharCode(0xDC00) + "World");
        process.${stream}.write("\\n");
        ${stream === "stdout" ? "" : 'console.log("Done");'}
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    if (stream === "stdout") {
      expect(stdout).toBe("�Hello\n�World\n");
    } else {
      expect(stdout).toBe("Done\n");
      expect(stderr).toBe("�Hello\n�World\n");
    }
  });

  test("unpaired surrogates at both ends", async () => {
    using dir = tempDir("stdio-utf16", {
      "test.js": `
        process.${stream}.write(String.fromCharCode(0xD800) + "Middle" + String.fromCharCode(0xDC00));
        process.${stream}.write("\\n");
        process.${stream}.write(String.fromCharCode(0xDC00) + "Text" + String.fromCharCode(0xD800));
        process.${stream}.write("\\n");
        ${stream === "stdout" ? "" : 'console.log("Done");'}
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    if (stream === "stdout") {
      expect(stdout).toBe("�Middle�\n�Text�\n");
    } else {
      expect(stdout).toBe("Done\n");
      expect(stderr).toBe("�Middle�\n�Text�\n");
    }
  });

  test("multiple unpaired high surrogates", async () => {
    using dir = tempDir("stdio-utf16", {
      "test.js": `
        // Multiple high surrogates only
        process.${stream}.write(String.fromCharCode(0xD800, 0xD801, 0xD802));
        process.${stream}.write("\\n");
        // Text with multiple trailing high surrogates
        process.${stream}.write("Test" + String.fromCharCode(0xD800, 0xD801, 0xD802));
        process.${stream}.write("\\n");
        ${stream === "stdout" ? "" : 'console.log("Done");'}
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    if (stream === "stdout") {
      expect(stdout).toBe("���\nTest���\n");
    } else {
      expect(stdout).toBe("Done\n");
      expect(stderr).toBe("���\nTest���\n");
    }
  });

  test("multiple unpaired low surrogates", async () => {
    using dir = tempDir("stdio-utf16", {
      "test.js": `
        // Multiple low surrogates only
        process.${stream}.write(String.fromCharCode(0xDC00, 0xDC01, 0xDC02));
        process.${stream}.write("\\n");
        // Text with multiple trailing low surrogates
        process.${stream}.write("Test" + String.fromCharCode(0xDC00, 0xDC01, 0xDC02));
        process.${stream}.write("\\n");
        ${stream === "stdout" ? "" : 'console.log("Done");'}
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    if (stream === "stdout") {
      expect(stdout).toBe("���\nTest���\n");
    } else {
      expect(stdout).toBe("Done\n");
      expect(stderr).toBe("���\nTest���\n");
    }
  });

  test("valid surrogate pairs are preserved", async () => {
    using dir = tempDir("stdio-utf16", {
      "test.js": `
        // Valid surrogate pair (𝄞 - musical symbol)
        process.${stream}.write(String.fromCharCode(0xD834, 0xDD1E));
        process.${stream}.write("\\n");
        // Valid pair with unpaired surrogates
        process.${stream}.write(
          String.fromCharCode(0xD800) +
          String.fromCharCode(0xD834, 0xDD1E) +
          String.fromCharCode(0xDC00)
        );
        process.${stream}.write("\\n");
        ${stream === "stdout" ? "" : 'console.log("Done");'}
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    if (stream === "stdout") {
      expect(stdout).toBe("𝄞\n�𝄞�\n");
    } else {
      expect(stdout).toBe("Done\n");
      expect(stderr).toBe("𝄞\n�𝄞�\n");
    }
  });

  test("surrogate pair combinations", async () => {
    using dir = tempDir("stdio-utf16", {
      "test.js": `
        // D800,D801,DC00: D800 is unpaired, D801+DC00 forms valid pair
        process.${stream}.write(String.fromCharCode(0xD800, 0xD801, 0xDC00));
        process.${stream}.write("\\n");
        // DC00,D800,DC01,D801: DC00 unpaired, D800+DC01 valid, D801 unpaired
        process.${stream}.write(String.fromCharCode(0xDC00, 0xD800, 0xDC01, 0xD801));
        process.${stream}.write("\\n");
        // Two high surrogates (both unpaired)
        process.${stream}.write(String.fromCharCode(0xD800, 0xD801));
        process.${stream}.write("\\n");
        // Two low surrogates (both unpaired)
        process.${stream}.write(String.fromCharCode(0xDC00, 0xDC01));
        process.${stream}.write("\\n");
        ${stream === "stdout" ? "" : 'console.log("Done");'}
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const expectedOutput =
      "�" +
      String.fromCharCode(0xd801, 0xdc00) +
      "\n" +
      "�" +
      String.fromCharCode(0xd800, 0xdc01) +
      "�\n" +
      "��\n" +
      "��\n";

    if (stream === "stdout") {
      expect(stdout).toBe(expectedOutput);
    } else {
      expect(stdout).toBe("Done\n");
      expect(stderr).toBe(expectedOutput);
    }
  });

  test("large strings with trailing unpaired surrogates", async () => {
    using dir = tempDir("stdio-utf16", {
      "test.js": `
        // Large string to test buffer boundaries
        const largeStr = "A".repeat(10000) + String.fromCharCode(0xD800);
        process.${stream}.write(largeStr);
        process.${stream}.write("\\n");
        ${stream === "stdout" ? "" : 'console.log("Done");'}
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const output = stream === "stdout" ? stdout : stderr;

    // Should be exactly 10000 A's plus one replacement character
    const aCount = (output.match(/A/g) || []).length;
    expect(aCount).toBe(10000);
    expect(output.endsWith("�\n")).toBe(true);

    if (stream === "stderr") {
      expect(stdout).toBe("Done\n");
    }
  });

  test("empty string and edge cases", async () => {
    using dir = tempDir("stdio-utf16", {
      "test.js": `
        // Empty string
        process.${stream}.write("");
        process.${stream}.write("\\n");
        // Single char before/after unpaired
        process.${stream}.write("A" + String.fromCharCode(0xD800));
        process.${stream}.write("\\n");
        process.${stream}.write(String.fromCharCode(0xD800) + "B");
        process.${stream}.write("\\n");
        ${stream === "stdout" ? "" : 'console.log("Done");'}
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    if (stream === "stdout") {
      expect(stdout).toBe("\nA�\n�B\n");
    } else {
      expect(stdout).toBe("Done\n");
      expect(stderr).toBe("\nA�\n�B\n");
    }
  });
});
