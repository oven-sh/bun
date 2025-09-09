import { $ } from "bun";
import { describe, test, expect } from "bun:test";
import { createTestBuilder } from "./test_builder";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";

const TestBuilder = createTestBuilder(import.meta.path);

describe("Background Commands (&)", () => {
  test("background command syntax is accepted", async () => {
    // Just verify the command doesn't error out anymore
    const result = await $`echo "test" &`.quiet();
    expect(result.exitCode).toBe(0);
  });

  test("error: & followed by &&", async () => {
    await TestBuilder.command`echo "test" & && echo "should fail"`
      .error('"&" is not allowed on the left-hand side of "&&"')
      .run();
  });

  test("error: & followed by ||", async () => {
    await TestBuilder.command`echo "test" & || echo "should fail"`
      .error('"&" is not allowed on the left-hand side of "||"')
      .run();
  });

  test("background command with file output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bg-test-"));
    const file = join(dir, "output.txt");
    
    try {
      await $`echo "to file" > ${file} &`.quiet();
      // Give background task time to complete
      await Bun.sleep(100);
      
      const content = await Bun.file(file).text();
      expect(content).toBe("to file\n");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("multiple background commands with file output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bg-multi-"));
    const file = join(dir, "output.txt");
    
    try {
      await $`echo "1" >> ${file} & echo "2" >> ${file} & echo "3" >> ${file}`.quiet();
      await Bun.sleep(100);
      
      const content = await Bun.file(file).text();
      expect(content).toContain("1");
      expect(content).toContain("2");
      expect(content).toContain("3");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("background subshell", async () => {
    // Simple subshell without redirection
    const result = await $`(echo "in subshell") &`.text();
    expect(result).toBe("in subshell\n");
  });

  test("background pipeline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bg-pipeline-"));
    const file = join(dir, "output.txt");
    
    try {
      await $`echo "test" | cat > ${file} &`.quiet();
      await Bun.sleep(100);
      
      const content = await Bun.file(file).text();
      expect(content).toBe("test\n");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("background if statement", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bg-if-"));
    const file = join(dir, "output.txt");
    
    try {
      await $`if true; then echo "in if" > ${file}; fi &`.quiet();
      await Bun.sleep(100);
      
      const content = await Bun.file(file).text();
      expect(content).toBe("in if\n");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("background command with && on right side", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bg-and-"));
    const file = join(dir, "output.txt");
    
    try {
      await $`echo "left" > ${file} && echo "right" >> ${file} &`.quiet();
      await Bun.sleep(100);
      
      const content = await Bun.file(file).text();
      expect(content).toBe("left\nright\n");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("original issue example works", async () => {
    // Test the exact example from the GitHub issue
    const emulatorName = "test-emulator";
    const ANDROID_HOME = "/fake/android/home";
    
    // This should not throw an error anymore
    const result = await $`"$ANDROID_HOME/emulator/emulator" -avd "${emulatorName}" -netdelay none -netspeed full &`.quiet().nothrow();
    // Command will fail because the emulator doesn't exist, but it shouldn't complain about &
    expect(result.stderr.toString()).not.toContain("Background commands");
  });
});