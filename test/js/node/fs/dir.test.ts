import { describe, beforeAll, afterAll, it, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("given a directory that exists", () => {
  let dirname: string;

  beforeAll(() => {
    const name = "dir-sync.test." + String(Math.random() * 100).substring(0, 6);
    dirname = path.join(os.tmpdir(), name);
    fs.mkdirSync(dirname);
  });

  afterAll(() => {
    fs.rmdirSync(dirname, { recursive: true });
  });

  it("can be opened/closed synchronously", () => {
    const dir = fs.opendirSync(dirname);
    expect(dir).toBeDefined();
    expect(dir).toBeInstanceOf(fs.Dir);
    expect(dir.closeSync()).toBeUndefined();
    expect(() => dir.readSync()).toThrow("Directory handle was closed");
  });

  it("can be opened/closed asynchronously", async () => {
    const dir = await fs.promises.opendir(dirname);
    expect(dir).toBeDefined();
    expect(dir).toBeInstanceOf(fs.Dir);
    expect(await dir.close()).toBeUndefined();
    expect(() => dir.read()).toThrow("Directory handle was closed");
  });
});
