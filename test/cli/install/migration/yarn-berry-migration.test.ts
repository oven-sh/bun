import { describe, test, expect } from "bun:test";
import { bunExe, bunEnv, tempDir } from "harness";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

describe("yarn berry (v2+) migration", () => {
  test("basic npm packages", async () => {
    using temp = tempDir("yarn-berry-basic", join(import.meta.dir, "yarn-berry/basic-npm"));
    
    const proc = Bun.spawn([bunExe(), "pm", "migrate"], {
      cwd: String(temp),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    
    const exitCode = await proc.exited;
    
    expect(exitCode).toBe(0);
    expect(existsSync(join(String(temp), "bun.lock"))).toBe(true);
    
    const lockContent = readFileSync(join(String(temp), "bun.lock"), "utf-8");
    expect(lockContent).toContain("lodash");
  }, 30000);

  test("multiple packages with dependencies", async () => {
    using temp = tempDir("yarn-berry-multi", join(import.meta.dir, "yarn-berry/multi-deps"));
    
    const proc = Bun.spawn([bunExe(), "pm", "migrate"], {
      cwd: String(temp),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    
    const exitCode = await proc.exited;
    
    expect(exitCode).toBe(0);
    expect(existsSync(join(String(temp), "bun.lock"))).toBe(true);
    
    const lockContent = readFileSync(join(String(temp), "bun.lock"), "utf-8");
    expect(lockContent).toContain("react");
    expect(lockContent).toContain("loose-envify");
  }, 30000);

  test("workspace packages", async () => {
    using temp = tempDir("yarn-berry-workspace", join(import.meta.dir, "yarn-berry/workspace"));
    
    const proc = Bun.spawn([bunExe(), "pm", "migrate"], {
      cwd: String(temp),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    
    const exitCode = await proc.exited;
    
    expect(exitCode).toBe(0);
    expect(existsSync(join(String(temp), "bun.lock"))).toBe(true);
    
    const lockContent = readFileSync(join(String(temp), "bun.lock"), "utf-8");
    expect(lockContent).toContain("workspace");
  }, 30000);
  
  test("multi-spec packages", async () => {
    using temp = tempDir("yarn-berry-multispec", join(import.meta.dir, "yarn-berry/multi-spec"));
    
    const proc = Bun.spawn([bunExe(), "pm", "migrate"], {
      cwd: String(temp),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    
    const exitCode = await proc.exited;
    
    expect(exitCode).toBe(0);
    expect(existsSync(join(String(temp), "bun.lock"))).toBe(true);
  }, 30000);
});
