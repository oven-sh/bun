import { promises as fs } from "fs";
import { bunEnv, bunExe } from "harness";
import path from "path";

const fixturePath = (...segs: string[]): string => path.join(import.meta.dirname, "fixtures", "bun-pragma", ...segs);

const OK = 0;
const ERR = 1;

const runFixture = async (path: string): Promise<number> => {
  const child = Bun.spawn({
    cmd: [bunExe(), "run", path],
    env: bunEnv,
    stdio: ["ignore", "ignore", "ignore"],
  });
  await child.exited;
  expect(child.exitCode).not.toBeNull();
  return child.exitCode!;
};

describe("@bun pragma", () => {
  describe("valid files", async () => {
    const passPath = fixturePath("pass");
    const passFiles: string[] = await fs.readdir(passPath, { encoding: "utf-8" });
    expect(passFiles).not.toHaveLength(0);

    it.each(passFiles)("bun run %s", async file => {
      const fullpath = path.join(passPath, file);
      const exitCode = await runFixture(fullpath);
      expect(exitCode).toBe(OK);
    });
  });

  describe("invalid files", async () => {
    const failPath = fixturePath("fail");
    const failFiles: string[] = await fs.readdir(failPath, { encoding: "utf-8" });
    expect(failFiles).not.toHaveLength(0);

    it.each(failFiles)("bun run %s", async file => {
      const fullpath = path.join(failPath, file);
      const exitCode = await runFixture(fullpath);
      expect(exitCode).toBe(ERR);
    });
  });
});
