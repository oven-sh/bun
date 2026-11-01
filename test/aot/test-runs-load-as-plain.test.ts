import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

test("a test poses as another runtime through process.versions", async () => {
  using dir = tempDir("test-runs-load-as-plain", {
    "one.test.ts": `
      import { expect, test } from "bun:test";
      const read = () => [process.versions.bun, process.versions.node];
      for (const name of ["bun", "node"]) {
        test(name, () => {
          const saved = Object.getOwnPropertyDescriptor(process.versions, name)!;
          const before = read();
          Object.defineProperty(process.versions, name, { value: "posed" });
          try {
            expect(read()).toContain("posed");
          } finally {
            Object.defineProperty(process.versions, name, saved);
          }
          expect(read()).toEqual(before);
        });
      }`,
  });
  const { stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", "--debug-aot"], String(dir), bunEnv);
  for (const name of ["bun", "node"]) expect(stderr).toContain(`(pass) ${name}`);
  expect(exitCode).toBe(0);
});

test("a test run loads a module that a test wrote at run time", async () => {
  using dir = tempDir("test-runs-load-as-plain", {
    "worker.ts": `
      declare var self: Worker;
      self.onmessage = async (event: MessageEvent) => {
        self.postMessage((await import(event.data)).value);
      };`,
    "one.test.ts": `
      import { expect, test } from "bun:test";
      import { mkdtempSync, writeFileSync } from "node:fs";
      import { tmpdir } from "node:os";
      import { join } from "node:path";
      const write = (value: number) => {
        const path = join(mkdtempSync(join(tmpdir(), "mods-")), "mod.ts");
        writeFileSync(path, "export const value = " + value + ";");
        return path;
      };
      test("here", async () => {
        expect((await import(write(1))).value).toBe(1);
      });
      test("in a Worker", async () => {
        const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
        const value = await new Promise(resolve => {
          worker.onmessage = event => resolve(event.data);
          worker.postMessage(write(2));
        });
        worker.terminate();
        expect(value).toBe(2);
      });`,
  });
  const { stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", "--debug-aot"], String(dir), bunEnv);
  for (const name of ["here", "in a Worker"]) expect(stderr).toContain(`(pass) ${name}`);
  expect(exitCode).toBe(0);
});

test("a Worker's text that is no program throws where the Worker starts, and the run goes on", async () => {
  using dir = tempDir("test-runs-load-as-plain", {
    "one.test.ts": `
      import { expect, test } from "bun:test";
      import { Worker } from "node:worker_threads";
      test("the text", async () => {
        const worker = new Worker(\`postMessage(throw new Error("boom"))\`, { eval: true });
        const result = await new Promise<any>(resolve => {
          worker.on("message", resolve);
          worker.on("error", resolve);
        });
        expect(result.name).toBe("SyntaxError");
        await worker.terminate();
      });`,
    "two.test.ts": `
      import { expect, test } from "bun:test";
      test("another file", () => expect(1 + 1).toBe(2));`,
  });
  const { stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", "--aot"], String(dir), bunEnv);
  expect(stderr).toContain("(pass) the text");
  expect(stderr).toContain("(pass) another file");
  expect(exitCode).toBe(0);
});
