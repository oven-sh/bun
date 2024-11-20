/// <reference path="../../src/bake/bake.d.ts" />
import { Bake, Subprocess } from "bun";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert";
import { test } from "bun:test";
import { EventEmitter } from "node:events";
// @ts-ignore
import { dedent } from "../bundler/expectBundled.ts";
import { bunEnv, mergeWindowEnvs } from "harness";
import { expect } from "bun:test";

/** For testing bundler related bugs in the DevServer */
export const minimalFramework: Bake.Framework = {
  fileSystemRouterTypes: [
    {
      root: "routes",
      style: "nextjs-pages",
      serverEntryPoint: require.resolve("./minimal.server.ts"),
    },
  ],
  serverComponents: {
    separateSSRGraph: false,
    serverRuntimeImportSource: require.resolve("./minimal.server.ts"),
    serverRegisterClientReferenceExport: "registerClientReference",
  },
};

export interface DevServerTest {
  /** 
   * Framework to use. Consider `minimalFramework` if possible.
   * Provide this object or `files['bun.app.ts']` for a dynamic one.
   */
  framework?: Bake.Framework | "react";
  /** Starting files */
  files: FileObject;
  /**
   * The dev server tests are abstracted into "steps", which are functions run
   * in order. This allows quickly writing very complicated tests, while
   * abstracting bindings to DevServer. See `Step.*` functions and examples
   * in the `dev` directory (where all dev server tests are).
   */
  steps: Step[];
}

type FileObject = Record<string, string | Buffer>;

export class Dev {
  root: string;
  port: number;
  baseUrl: string;
  panicked = false;

  // These properties are not owned by this class
  devProcess: Subprocess<"pipe", "pipe", "pipe">;
  output: OutputLineStream;

  constructor(root: string, port: number, process: Subprocess<"pipe", "pipe", "pipe">, stream: OutputLineStream) {
    this.root = root;
    this.port = port;
    this.baseUrl = `http://localhost:${port}`;
    this.devProcess = process;
    this.output = stream;
    this.output.on("panic", () => {
      this.panicked = true;
    });
  }

  join(file: string) {
    return path.join(this.root, file);
  }

  async waitForHotReload() {
    await this.output.waitForLine(/Bundled route|error|Reloaded/);
  }

  async [Symbol.asyncDispose]() {}
}

type StepFn = (dev: Dev) => Promise<void>;

export interface Step {
  run: StepFn;
  caller: string;
  name?: string;
}

export const Step = {
  fn: (name: string, cb: StepFn) => ({ run: cb, caller: snapshotCallerLocation(), name } as Step),

  write: (file: string, contents: string) =>
    Step.fn(`Update ${file}`, (dev: Dev) => {
      const wait = dev.waitForHotReload();
      fs.writeFileSync(dev.join(file), contents);
      return wait;
    }),

  patch: (file: string, { find, replace }: { find: string; replace: string }) =>
    Step.fn(`Update ${file}`, (dev: Dev) => {
      const wait = dev.waitForHotReload();
      const filename = dev.join(file);
      const contents = fs.readFileSync(filename, "utf8").replace(find, replace);
      if (contents === fs.readFileSync(filename, "utf8")) {
        throw new Error(`Couldn't find and replace ${JSON.stringify(find)} in ${file}`);
      }
      fs.writeFileSync(filename, contents);
      return wait;
    }),

  fetch: (url: string) => new FetchStep(url),
};

class FetchStep implements Step {
  url: string;
  expected: string | null;
  caller: string;

  get name() {
    return `Fetch ${JSON.stringify(this.url)}`;
  }

  constructor(url: string) {
    this.url = url;
    this.expected = null;
    this.caller = snapshotCallerLocation();
  }

  expect(expected: string) {
    this.expected = expected;
    return this;
  }

  async run(dev: Dev) {
    const res = await fetch(dev.baseUrl + this.url);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${this.url}: ${res.status}`);
    }
    if (this.expected !== null) {
      const text = await res.text();
      expect(text).toBe(this.expected);
    }
  }
}

function snapshotCallerLocation(): string {
  const stack = new Error().stack!;
  const lines = stack.split("\n");
  let i = 1;
  for (; i < lines.length; i++) {
    if (!lines[i].includes(import.meta.filename)) {
      return lines[i];
    }
  }
  throw new Error("Couldn't find caller location in stack trace");
}

function stackTraceFileName(line: string): string {
  return / \((.*?)[:)]/.exec(line)![1];
}

const tempDir = fs.mkdtempSync(
  path.join(process.platform === "darwin" && !process.env.CI ? "/tmp" : os.tmpdir(), "bun-dev-test-"),
);
const devTestRoot = path.join(import.meta.dir, "dev");
const counts: Record<string, number> = {};

console.log("Dev server testing directory:", tempDir);

function writeAll(root: string, files: FileObject) {
  for (const [file, contents] of Object.entries(files)) {
    const filename = path.join(root, file);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const formattedContents =
      typeof contents === "string" ? dedent(contents).replaceAll("{{root}}", root.replaceAll("\\", "\\\\")) : contents;
    fs.writeFileSync(filename, formattedContents as string);
  }
}

class OutputLineStream extends EventEmitter {
  reader1: ReadableStreamDefaultReader;
  reader2: ReadableStreamDefaultReader;

  lines: string[] = [];
  cursor: number = 0;
  disposed = false;
  closes = 0;

  constructor(readable1: ReadableStream, readable2: ReadableStream) {
    super();

    // @ts-ignore TODO: fix broken type definitions in @types/bun
    const reader1 = (this.reader1 = readable1.getReader());
    // @ts-ignore TODO: fix broken type definitions in @types/bun
    const reader2 = (this.reader2 = readable2.getReader());

    for (const reader of [reader1, reader2]) {
      (async () => {
        const td = new TextDecoder();
        let last = "";
        while (true) {
          const { done, value } = (await reader.read()) as { done: boolean; value: Uint8Array };
          if (done) break;
          const clearScreenCode = "\x1B[2J\x1B[3J\x1B[H";
          const text = last + td.decode(value, { stream: true }).replace(clearScreenCode, "");
          const lines = text.split("\n");
          last = lines.pop()!;
          for (const line of lines) {
            this.lines.push(line);
            if (line.includes('============================================================')) {
              this.emit("panic");
            }
            console.log("\x1b[0;30mdev|\x1b[0m", line);
            this.emit("line", line);
          }
        }

        this.closes++;
        if (this.closes === 2) {
          this.emit("close");
        }
        return;
      })();
    }
  }

  waitForLine(regex: RegExp, timeout = 1000): Promise<RegExpMatchArray> {
    return new Promise((resolve, reject) => {
      let ran = false;
      let timer: any;
      const reset = () => {
        this.off("close", onClose);
        this.off("line", onLine);
        ran = true;
        clearTimeout(timer);
        timer = null!;
      };
      const onLine = (line: string) => {
        let match;
        if ((match = line.match(regex))) {
          reset();
          resolve(match);
        }
      };
      const onClose = () => {
        reset();
        reject(new Error("Process exited before line " + JSON.stringify(regex.toString()) + " was found"));
      };
      this.on("line", onLine);
      this.on("close", onClose);
      timer = setTimeout(() => {
        if (!ran) {
          reset();
          reject(new Error("Timeout waiting for line " + JSON.stringify(regex.toString())));
        }
      }, timeout);
    });
  }

  [Symbol.dispose]() {
    if (this.disposed) return;
    this.disposed = true;
    this.reader1.cancel();
    this.reader2.cancel();
    this.emit("close");
  }
}

export function devTest(description: string, options: DevServerTest) {
  // Capture the caller name as part of the test tempdir
  const caller = stackTraceFileName(snapshotCallerLocation());
  assert(caller.startsWith(devTestRoot), "dev server tests must be in test/bake/dev");
  const basename = path.basename(caller, '.test' + path.extname(caller));
  const count = (counts[basename] = (counts[basename] ?? 0) + 1);
  test(`DevServer > ${basename}.${count}: ${description}`, async () => {
    const root = path.join(tempDir, basename + count);
    writeAll(root, options.files);
    if (options.files["bun.app.ts"] == undefined) {
      if (!options.framework) {
        throw new Error("Must specify a options.framework or provide a bun.app.ts file");
      }
      fs.writeFileSync(
        path.join(root, "bun.app.ts"),
        dedent`
          export default {
            app: {
              framework: ${JSON.stringify(options.framework)},
            },
          };
        `,
      );
    }
    fs.writeFileSync(
      path.join(root, "harness_start.ts"),
      dedent`
        import appConfig from "./bun.app.ts";
        export default {
          port: 0,
          ...appConfig
        };
      `,
    );

    await using devProcess = Bun.spawn({
      cwd: root,
      cmd: [process.execPath, "./bun.app.ts"],
      env: mergeWindowEnvs([
        bunEnv,
        {
          FORCE_COLOR: "1",
          BUN_DEV_SERVER_TEST_RUNNER: "1",
        },
      ]),
      stdio: ["pipe", "pipe", "pipe"],
    });
    using stream = new OutputLineStream(devProcess.stdout, devProcess.stderr);
    const port = parseInt((await stream.waitForLine(/localhost:(\d+)/))[1], 10);
    await using dev = new Dev(root, port, devProcess, stream);

    let n = 0;
    for (const step of options.steps) {
      console.log(`\x1b[95mStep ${n}${step.name ? `: ${step.name}` : ""}\x1b[0m`);
      n++;
      try {
        await step.run(dev);
      } catch (err: any) {
        console.log();
        const oldStack = err.stack;
        const editedCallerStep = step.caller.replace(/\w*at.*?\(/, "at step defined at (");
        const main = dev.panicked
        ? `caused a DevServer crash`
        : `failed: ${oldStack.slice(0, oldStack.indexOf("\n    at "))}`;
        const newError = new Error(`Step ${n} ${main}`);
        newError.stack = `${newError.message}\n${editedCallerStep}\n    at \x1b[1moriginal stack:\x1b[0m ()\n${oldStack}`;
        throw newError;
      }
    }
  });
}
