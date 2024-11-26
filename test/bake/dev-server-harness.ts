/// <reference path="../../src/bake/bake.d.ts" />
import { Bake, Subprocess } from "bun";
import fs from "node:fs";
import path, { resolve } from "node:path";
import os from "node:os";
import assert from "node:assert";
import { test } from "bun:test";
import { EventEmitter } from "node:events";
// @ts-ignore
import { dedent } from "../bundler/expectBundled.ts";
import { bunEnv, isWindows, mergeWindowEnvs } from "harness";
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
  test: (dev: Dev) => Promise<void>;
}

type FileObject = Record<string, string | Buffer>;

export class Dev {
  rootDir: string;
  port: number;
  baseUrl: string;
  panicked = false;

  // These properties are not owned by this class
  devProcess: Subprocess<"pipe", "pipe", "pipe">;
  output: OutputLineStream;

  constructor(root: string, port: number, process: Subprocess<"pipe", "pipe", "pipe">, stream: OutputLineStream) {
    this.rootDir = root;
    this.port = port;
    this.baseUrl = `http://localhost:${port}`;
    this.devProcess = process;
    this.output = stream;
    this.output.on("panic", () => {
      this.panicked = true;
    });
  }

  fetch(url: string, init?: RequestInit) {
    return new DevFetchPromise((resolve, reject) =>
      fetch(new URL(url, this.baseUrl).toString(), init).then(resolve, reject),
    );
  }

  fetchJSON(url: string, object: any) {
    return this.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(object),
    });
  }

  write(file: string, contents: string) {
    const wait = this.waitForHotReload();
    // TODO: consider using IncomingMessageId.virtual_file_change to reduce theoretical flakiness.
    fs.writeFileSync(this.join(file), contents);
    return wait;
  }

  patch(file: string, { find, replace }: { find: string; replace: string }) {
    const wait = this.waitForHotReload();
    const filename = this.join(file);
    const source = fs.readFileSync(filename, "utf8");
    const contents = source.replace(find, replace);
    if (contents === source) {
      throw new Error(`Couldn't find and replace ${JSON.stringify(find)} in ${file}`);
    }
    // TODO: consider using IncomingMessageId.virtual_file_change to reduce theoretical flakiness.
    fs.writeFileSync(filename, contents);
    return wait;
  }

  join(file: string) {
    return path.join(this.rootDir, file);
  }

  async waitForHotReload() {
    await this.output.waitForLine(/bundled route|error|reloaded/i);
  }

  async [Symbol.asyncDispose]() {}
}

type StepFn = (dev: Dev) => Promise<void>;

export interface Step {
  run: StepFn;
  caller: string;
  name?: string;
}

class DevFetchPromise extends Promise<Response> {
  expect(result: string) {
    return withAnnotatedStack(snapshotCallerLocation(), async () => {
      const res = await this;
      if (!res.ok) {
        throw new Error(`Expected response to be ok, but got ${res.status} ${res.statusText}`);
      }
      const text = (await res.text()).trim();
      expect(text).toBe(result.trim());
    });
  }
  expectNoSpaces(result: string) {
    expect(result).not.toMatch(/\s/);
    return withAnnotatedStack(snapshotCallerLocation(), async () => {
      const res = await this;
      if (!res.ok) {
        throw new Error(`Expected response to be ok, but got ${res.status} ${res.statusText}`);
      }
      const text = (await res.text()).replace(/\s/g, "");
      expect(text).toBe(result.trim());
    });
  }
  async text() {
    return (await this).text();
  }
  async json() {
    return (await this).json();
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
  return / \(((?:[A-Za-z]:)?.*?)[:)]/.exec(line)![1].replaceAll("\\", "/");
}

async function withAnnotatedStack<T>(stackLine: string, cb: () => Promise<T>): Promise<T> {
  try {
    return await cb();
  } catch (err: any) {
    console.log();
    const oldStack = err.stack;
    const newError = new Error(err?.message ?? oldStack.slice(0, oldStack.indexOf("\n    at ")));
    newError.stack = `${newError.message}\n${stackLine}\n    at \x1b[1moriginal stack:\x1b[0m ()\n${oldStack}`;
    throw newError;
  }
}

const tempDir = fs.mkdtempSync(
  path.join(process.platform === "darwin" && !process.env.CI ? "/tmp" : os.tmpdir(), "bun-dev-test-"),
);
const devTestRoot = path.join(import.meta.dir, "dev").replaceAll("\\", "/");
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
            if (line.includes("============================================================")) {
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
  const callerLocation = snapshotCallerLocation();
  const caller = stackTraceFileName(callerLocation);
  const jest = (Bun as any).jest(caller);
  assert(caller.startsWith(devTestRoot), "dev server tests must be in test/bake/dev, not " + caller);
  const basename = path.basename(caller, ".test" + path.extname(caller));
  const count = (counts[basename] = (counts[basename] ?? 0) + 1);

  // TODO: Tests are too flaky on Windows. Cannot reproduce locally.
  if (isWindows) {
    jest.test.todo(`DevServer > ${basename}.${count}: ${description}`);
    return;
  }

  jest.test(`DevServer > ${basename}.${count}: ${description}`, async () => {
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

    try {
      await options.test(dev);
    } catch (err: any) {
      // const oldStack = err.stack;
      // const editedCallerStep = callerLocation.replace(/\w*at.*?\(/, "at test defined at (");
      // const main = dev.panicked
      // ? `caused a DevServer crash`
      // : `failed: ${oldStack.slice(0, oldStack.indexOf("\n    at "))}`;
      // const newError = new Error(`Step ${n} ${main}`);
      // newError.stack = `${newError.message}\n${editedCallerStep}\n    at \x1b[1moriginal stack:\x1b[0m ()\n${oldStack}`;
      throw err;
    }
  });
}
