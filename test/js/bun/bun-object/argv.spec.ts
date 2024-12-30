import path from "node:path";
import fs from "node:fs";
import { bunExe, bunEnv } from "harness";
import { describe, beforeAll, afterAll, test, it, expect } from "bun:test";

const fixturePath = (name: string): string => path.join(import.meta.dirname, "fixtures", "argv", name);

const runFile = async (filename: string, ...args: string[]): Promise<string> => {
  const child = Bun.spawn([filename, ...args], {
    env: bunEnv,
  });
  const stdout = await Bun.readableStreamToText(child.stdout);
  expect(await child.exited).toBe(0);
  return stdout;
};

// NOTE: intentionally not using `bunRun` from `harness`.
const runBun = async (...args: string[]): Promise<string> => {
  const child = Bun.spawn([bunExe(), ...args], {
    env: bunEnv,
  });
  const stdout = await Bun.readableStreamToText(child.stdout);
  expect(await child.exited).toBe(0);
  return stdout;
};
const run = async (...args: string[]): Promise<string> => {
  const child = Bun.spawn(args, {
    env: bunEnv,
  });
  const stdout = await Bun.readableStreamToText(child.stdout);
  expect(await child.exited).toBe(0);
  return stdout;
};

describe("Given an executable JS file", () => {
  const filename = fixturePath("log-argv.js");

  // logs Bun.argv as a CSV
  const logArgv = /* js */ `
  #!${bunExe()}
  console.log(Bun.argv.join(', '))
  `.trim();

  beforeAll(() => {
    fs.writeFileSync(filename, logArgv, { mode: 0o755, flush: true });
  });

  afterAll(() => {
    // await Bun.$`rm ${filename}`;
    fs.rmSync(filename);
  });

  describe("When run with no arguments", () => {
    describe.each([
      ["directly as an executable", [filename]],
      ["using `bun <file>`", [bunExe(), filename]],
      ["using `bun run <file>`", [bunExe(), "run", filename]],
    ])("When run %s", (_, args) => {
      let actual: string[];

      beforeAll(async () => {
        actual = await run(...args).then(out => out.trimEnd().split(", "));
      });

      afterAll(() => {
        actual = undefined as any;
      });

      it("Then Bun.argv has two arguments", () => {
        expect(actual.length).toBe(2);
      });

      it("And the first arg is an absolute path to the bun binary", () => {
        const [bun] = actual;
        expect(path.isAbsolute(bun));
        expect(bun).toMatch(/bun(-debug)?$/);
      });

      it("And the second arg is the path to the JS file", () => {
        const [, file] = actual;
        expect(file).toEqual(filename);
      });
    });
  }); // </ When run with no arguments />
});
