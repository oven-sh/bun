/// <reference path="../../src/bake/bake.d.ts" />
import { Bake, Subprocess } from "bun";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert";
import { Matchers } from "bun:test";
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

export function emptyHtmlFile({
  styles = [],
  scripts = [],
  body = "",
}: {
  styles?: string[];
  scripts?: string[];
  body?: string;
}) {
  return dedent`
    <!DOCTYPE html>
    <html>
      <head>
        ${styles.map(style => `<link rel="stylesheet" href="${style}">`).join("\n        ")}
      </head>
      <body>
        ${scripts.map(script => `<script type="module" src="${script}"></script>`).join("\n        ")}
        ${body}
      </body>
    </html>
  `;
}

export type DevServerTest = (
  | {
      /** Starting files */
      files: FileObject;
      /**
       * Framework to use. Consider `minimalFramework` if possible.
       * Provide this object or `files['bun.app.ts']` for a dynamic one.
       */
      framework?: Bake.Framework | "react";
      /**
       * Source code for a TSX file that `export default`s an array of BunPlugin,
       * combined with the `framework` option.
       */
      pluginFile?: string;
    }
  | {
      /**
       * Copy all files from test/bake/fixtures/<name>
       * This directory must contain `bun.app.ts` or `index.html` to allow hacking on fixtures manually via `bun run .`
       */
      fixture: string;
    }
) & {
  test: (dev: Dev) => Promise<void>;
};

let interactive = false;
let activeClient: Client | null = null;

async function maybeWaitInteractive(message: string) {
  if (interactive) {
    while (activeClient) {
      const input = prompt("\x1b[32mPress return to " + message + "; JS>\x1b[0m");
      if (input === "q" || input === "exit") {
        process.exit(0);
      }
      if (input === "" || input == null) return;
      const result = await activeClient.jsInteractive(input);
      console.log(result);
    }
    console.log("\x1b[32mPress return to " + message + "\x1b[0m");
    await new Promise(resolve => {
      // Enable raw mode
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", chunk => {
        if (chunk.toString().trim() === "q" || chunk[0] === 3) {
          process.exit(0);
          return;
        }
        // Disable after one keypress
        process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve(undefined);
      });
    });
  }
}

const hmrClientInitRegex = /\[Bun\] (Live|Hot-module)-reloading socket connected, waiting for changes/;

type ErrorSpec = string;

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
    return new DevFetchPromise(
      (resolve, reject) => fetch(new URL(url, this.baseUrl).toString(), init).then(resolve, reject),
      this,
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

  async write(file: string, contents: string) {
    await maybeWaitInteractive("write " + file);
    const wait = this.waitForHotReload();
    // TODO: consider using IncomingMessageId.virtual_file_change to reduce theoretical flakiness.
    fs.writeFileSync(this.join(file), contents);
    return wait;
  }

  async patch(file: string, { find, replace }: { find: string; replace: string }) {
    await maybeWaitInteractive("patch " + file);
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
    const err = this.output.waitForLine(/error/i);
    const success = this.output.waitForLine(/bundled page|bundled route|reloaded/i);
    await Promise.race([
      // On failure, give a little time in case a partial write caused a
      // bundling error, and a success came in.
      err.then(
        () => Bun.sleep(500),
        () => {},
      ),
      success,
    ]);
  }

  async client(url = "/", options: { errors?: ErrorSpec[] } = {}) {
    await maybeWaitInteractive("open client " + url);
    const client = new Client(new URL(url, this.baseUrl).href);
    try {
      await client.output.waitForLine(hmrClientInitRegex);
    } catch (e) {
      client[Symbol.asyncDispose]();
      throw e;
    }
    const hasVisibleModal = await client.js`document.querySelector("bun-hmr")?.style.display === "block"`;
    if (options.errors) {
      if (!hasVisibleModal) {
        throw new Error("Expected errors, but none found");
      }
    } else {
      if (hasVisibleModal) {
        throw new Error("Bundle failures!");
      }
    }
    return client;
  }
}

type StepFn = (dev: Dev) => Promise<void>;

export interface Step {
  run: StepFn;
  caller: string;
  name?: string;
}

class DevFetchPromise extends Promise<Response> {
  dev: Dev;
  constructor(
    executor: (resolve: (value: Response | PromiseLike<Response>) => void, reject: (reason?: any) => void) => void,
    dev: Dev,
  ) {
    super(executor);
    this.dev = dev;
  }

  equals(result: any) {
    if (typeof result !== "string") {
      result = JSON.stringify(result);
    }
    return withAnnotatedStack(snapshotCallerLocation(), async () => {
      try {
        const res = await this;
        if (!res.ok) {
          throw new Error(`Expected response to be ok, but got ${res.status} ${res.statusText}`);
        }
        const text = (await res.text()).trim();
        expect(text).toBe(result.trim());
      } catch (err) {
        if (this.dev.panicked) {
          throw new Error("DevServer crashed");
        }
        throw err;
      }
    });
  }

  equalsNoSpaces(result: string) {
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

  /// Usage: await dev.fetch("/").expect.toInclude("Hello");
  get expect(): Matchers<string> {
    return expectProxy(this.text(), [], expect(""));
  }

  expect404() {
    return withAnnotatedStack(snapshotCallerLocation(), async () => {
      try {
        const res = await this;
        expect(res.status).toBe(404);
      } catch (err) {
        if (this.dev.panicked) {
          throw new Error("DevServer crashed");
        }
        throw err;
      }
    });
  }
}

const node = process.env.DEV_SERVER_CLIENT_EXECUTABLE ?? Bun.which("node");

/**
 * Controls a subprocess that uses happy-dom as a lightweight browser. It is
 * sandboxed in a separate process because happy-dom is a terrible mess to work
 * with, and has some compatibility issues with Bun.
 */
class Client extends EventEmitter {
  #proc: Subprocess;
  output: OutputLineStream;
  exited = false;
  exitCode: string | null = null;
  messages: any[] = [];

  constructor(url: string) {
    super();
    activeClient = this;
    const proc = Bun.spawn({
      cmd: [node, path.join(import.meta.dir, "client-fixture.mjs"), url],
      env: {
        ...process.env,
      },
      serialization: "json",
      ipc: (message, subprocess) => {
        this.emit(message.type, ...message.args);
      },
      onExit: (subprocess, exitCode, signalCode, error) => {
        if (exitCode !== null) {
          this.exitCode = exitCode.toString();
        } else if (signalCode !== null) {
          this.exitCode = `SIG${signalCode}`;
        } else {
          this.exitCode = "unknown";
        }
        this.emit("exit", this.exitCode, error);
        this.exited = true;
        if (activeClient === this) {
          activeClient = null;
        }
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.on("message", (message: any) => {
      this.messages.push(message);
    });
    this.#proc = proc;
    // @ts-expect-error
    this.output = new OutputLineStream("browser", proc.stdout, proc.stderr);
  }

  hardReload() {
    return withAnnotatedStack(snapshotCallerLocation(), async () => {
      await maybeWaitInteractive("hard-reload");
      if (this.exited) throw new Error("Client is not running.");
      this.#proc.send({ type: "hard-reload" });
      await this.output.waitForLine(hmrClientInitRegex);
    });
  }

  elemText(selector: string): Promise<string> {
    return withAnnotatedStack(snapshotCallerLocation(), async () => {
      const text = await this.js<string | null>`
        const elem = document.querySelector(${selector});
        if (!elem) throw new Error("Element not found: " + ${selector});
        return elem.innerHTML;
      `;
      if (text == null) throw new Error(`Element found but has no text content: ${selector}`);
      return text;
    });
  }

  async [Symbol.asyncDispose]() {
    if (activeClient === this) {
      activeClient = null;
    }
    try {
      this.#proc.send({ type: "exit" });
    } catch (e) {}
    await this.#proc.exited;
    if (this.exitCode !== null && this.exitCode !== "0") {
      throw new Error(`Client exited with code ${this.exitCode}`);
    }
    if (this.messages.length > 0) {
      throw new Error(`Client sent ${this.messages.length} unread messages: ${JSON.stringify(this.messages, null, 2)}`);
    }
    this.output[Symbol.dispose]();
  }

  expectReload(cb: () => Promise<void>) {
    return withAnnotatedStack(snapshotCallerLocation(), async () => {
      if (this.exited) throw new Error("Client exited while waiting for reload");
      let emitted = false;
      const resolver = Promise.withResolvers();
      this.#proc.send({ type: "expect-reload" });
      function onEvent() {
        emitted = true;
        resolver.resolve();
      }
      this.once("reload", onEvent);
      this.once("exit", onEvent);
      let t: any = setTimeout(() => {
        t = null;
        resolver.resolve();
      }, 1000);
      await cb();
      await resolver.promise;
      if (t) clearTimeout(t);
      this.off("reload", onEvent);
      this.off("exit", onEvent);
      if (this.exited) throw new Error("Client exited while waiting for reload");
      if (!emitted) {
        throw new Error("expectReload: reload event was not emitted");
      }
    });
  }

  expectMessage(...x: any) {
    return withAnnotatedStack(snapshotCallerLocation(), async () => {
      if (this.exited) throw new Error("Client exited while waiting for message");
      if (this.messages.length !== x.length) {
        // Wait up to a threshold before giving up
        const resolver = Promise.withResolvers();
        function onMessage(message: any) {
          if (this.messages.length === x.length) resolver.resolve();
        }
        function onExit() {
          resolver.resolve();
        }
        this.once("message", onMessage);
        this.once("exit", onExit);
        let t: any = setTimeout(() => {
          t = null;
          resolver.resolve();
        }, 1000);
        await resolver.promise;
        if (t) clearTimeout(t);
        this.off("message", onMessage);
      }
      if (this.exited) throw new Error("Client exited while waiting for message");
      const m = this.messages;
      this.messages = [];
      expect(m).toEqual(x);
    });
  }

  getStringMessage(): Promise<string> {
    return withAnnotatedStack(snapshotCallerLocation(), async () => {
      if (this.messages.length === 0) {
        // Wait up to a threshold before giving up
        const resolver = Promise.withResolvers();
        function onEvent() {
          resolver.resolve();
        }
        this.once("message", onEvent);
        this.once("exit", onEvent);
        let t: any = setTimeout(() => {
          t = null;
          resolver.resolve();
        }, 1000);
        await resolver.promise;
        if (t) clearTimeout(t);
        this.off("message", onEvent);
      }
      if (this.messages.length === 0) {
        throw new Error("No message received");
      }
      const m = this.messages.shift();
      expect(m).toBeString();
      return m;
    });
  }

  js<T = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T> {
    // Combine the template strings and values into a single string
    const code = strings.reduce(
      (acc, str, i) => acc + str + (values[i] !== undefined ? JSON.stringify(values[i]) : ""),
      "",
    );
    return withAnnotatedStack(snapshotCallerLocationMayFail(), async () => {
      await maybeWaitInteractive("js");
      return new Promise((resolve, reject) => {
        // Create unique message ID for this evaluation
        const messageId = Math.random().toString(36).slice(2);

        // Set up one-time handler for the response
        const handler = (result: any) => {
          if (result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result.value);
          }
        };

        this.once(`js-result-${messageId}`, handler);

        // Send the evaluation request
        this.#proc.send({
          type: "evaluate",
          args: [messageId, code],
        });
      });
    });
  }

  jsInteractive(code: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Create unique message ID for this evaluation
      const messageId = Math.random().toString(36).slice(2);

      // Set up one-time handler for the response
      const handler = (result: any) => {
        if (result.error) {
          reject(new Error(result.error));
        } else {
          resolve(result.value);
        }
      };

      this.once(`js-result-${messageId}`, handler);

      // Send the evaluation request
      this.#proc.send({
        type: "evaluate",
        args: [messageId, code, "interactive"],
      });
    });
  }

  click(selector: string) {
    this.js`
      const elem = document.querySelector(${selector});
      if (!elem) throw new Error("Element not found: " + ${selector});
      elem.click();
    `;
  }
}

function expectProxy(text: Promise<string>, chain: string[], expect: any): any {
  function fn() {
    throw new TypeError();
  }
  fn.text = text;
  fn.chain = chain;
  fn.expect = expect;
  return new Proxy(fn, fetchExpectProxyHandler);
}

const fetchExpectProxyHandler: ProxyHandler<any> = {
  get(target, prop, receiver) {
    if (Reflect.has(target.expect, prop)) {
      return expectProxy(target.text, target.chain.concat(prop), Reflect.get(target.expect, prop, receiver));
    }
    return undefined;
  },
  has(target, p) {
    return Reflect.has(target.expect, p);
  },
  set() {
    throw new Error("Cannot set properties");
  },
  apply(target, thisArg, argArray) {
    if (typeof target.expect !== "function") {
      throw new Error(`expect.${target.chain.join(".")} is not a function`);
    }
    return withAnnotatedStack(snapshotCallerLocation(), async () => {
      var m: any = expect(await target.text);
      for (const part of target.chain.slice(0, -1)) {
        m = m[part];
      }
      return m[target.chain[target.chain.length - 1]].apply(m, argArray);
    });
  },
};

function snapshotCallerLocation(): string {
  const stack = new Error().stack!;
  const lines = stack.replaceAll("\r\n", "\n").split("\n");
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i].replaceAll("\\", "/");
    if (line.includes(import.meta.dir.replaceAll("\\", "/")) && !line.includes("dev-server-harness.ts")) {
      return line;
    }
  }
  throw new Error("Couldn't find caller location in stack trace:\n" + stack);
}
function snapshotCallerLocationMayFail(): string {
  try {
    return snapshotCallerLocation();
  } catch (e) {
    return "";
  }
}
function stackTraceFileName(line: string): string {
  let result = line.trim();

  // Remove leading "at " and any parentheses
  if (result.startsWith("at ")) {
    result = result.slice(3).trim();
  }

  // Handle case with angle brackets like "<anonymous>"
  const angleStart = result.indexOf("<");
  const angleEnd = result.indexOf(">");
  if (angleStart >= 0 && angleEnd > angleStart) {
    result = result.slice(angleEnd + 1).trim();
  }

  // Remove parentheses and everything after colon
  const openParen = result.indexOf("(");
  if (openParen >= 0) {
    result = result.slice(openParen + 1).trim();
  }

  // Handle drive letters (e.g. C:) and line numbers
  let colon = result.indexOf(":");

  // Check for drive letter (e.g. C:) by looking for single letter before colon
  if (colon > 0 && /[a-zA-Z]/.test(result[colon - 1])) {
    // On Windows, skip past drive letter colon to find line number colon
    colon = result.indexOf(":", colon + 1);
  }

  if (colon >= 0) {
    result = result.slice(0, colon);
  }

  result = result.trim();
  return result.replaceAll("\\", "/");
}

async function withAnnotatedStack<T>(stackLine: string, cb: () => Promise<T>): Promise<T> {
  if (stackLine === "") return cb();
  try {
    return await cb();
  } catch (err: any) {
    console.log();
    console.error(stackLine);
    stackLine = stackLine.replace("<anonymous>", "test");
    const oldStack = err.stack;
    const newError = new Error(err?.message ?? oldStack.slice(0, oldStack.indexOf("\n    at ")));
    newError.stack = `${newError.message}\n${stackLine}`;
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

  name: string;
  lines: string[] = [];
  cursor: number = 0;
  disposed = false;
  closes = 0;

  constructor(name: string, readable1: ReadableStream, readable2: ReadableStream) {
    super();

    this.name = name;

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
          const text = last + td.decode(value, { stream: true }).replace(clearScreenCode, "").replaceAll("\r", "");
          const lines = text.split("\n");
          last = lines.pop()!;
          for (const line of lines) {
            this.lines.push(line);
            if (line.includes("============================================================")) {
              this.emit("panic");
            }
            console.log("\x1b[0;30m" + name + "|\x1b[0m", line);
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

  waitForLine(regex: RegExp, timeout = isWindows ? 5000 : 1000): Promise<RegExpMatchArray> {
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
          setTimeout(() => {
            resolve(match);
          }, 50);
        }
      };
      const onClose = () => {
        reset();
        reject(new Error("Process exited before line " + JSON.stringify(regex.toString()) + " was found"));
      };
      let panicked = false;
      this.on("line", onLine);
      this.on("close", onClose);
      this.on("panic", () => (panicked = true));
      timer = setTimeout(() => {
        if (!ran) {
          reset();
          if (panicked) {
            this.on("close", () => {
              reject(new Error("Panicked while waiting for line " + JSON.stringify(regex.toString())));
            });
          } else {
            reject(new Error("Timeout waiting for line " + JSON.stringify(regex.toString())));
          }
        }
      }, timeout);
    });
  }

  [Symbol.dispose]() {
    if (this.disposed) return;
    this.disposed = true;
    this.reader1.cancel();
    this.reader2.cancel();
  }
}

export function devTest<T extends DevServerTest>(description: string, options: T): T {
  if (interactive) return options;

  // Capture the caller name as part of the test tempdir
  const callerLocation = snapshotCallerLocation();
  const caller = stackTraceFileName(callerLocation);
  const jest = (Bun as any).jest(caller);
  assert(caller.startsWith(devTestRoot), "dev server tests must be in test/bake/dev, not " + caller);
  const basename = path.basename(caller, ".test" + path.extname(caller));
  const count = (counts[basename] = (counts[basename] ?? 0) + 1);

  const indexHtmlScript = dedent`
    import html from "./index.html";
    export default {
      static: {
        '/*': html,
      },
      fetch(req) {
        return new Response("Not Found", { status: 404 });
      },
    };
  `;

  async function run() {
    const root = path.join(tempDir, basename + count);
    if ("files" in options) {
      writeAll(root, options.files);
      if (options.files["bun.app.ts"] == undefined && options.files["index.html"] == undefined) {
        if (!options.framework) {
          throw new Error("Must specify one of: `options.framework`, `index.html`, or `bun.app.ts`");
        }
        if (options.pluginFile) {
          fs.writeFileSync(path.join(root, "pluginFile.ts"), dedent(options.pluginFile));
        }
        fs.writeFileSync(
          path.join(root, "bun.app.ts"),
          dedent`
            ${options.pluginFile ? `import plugins from './pluginFile.ts';` : "let plugins = undefined;"}
            export default {
              app: {
                framework: ${JSON.stringify(options.framework)},
                plugins,
              },
            };
          `,
        );
      } else if (options.files["index.html"]) {
        if (options.files["bun.app.ts"]) {
          throw new Error("Cannot provide both bun.app.ts and index.html");
        }
        fs.writeFileSync(path.join(root, "bun.app.ts"), indexHtmlScript);
      }
    } else {
      if (!options.fixture) {
        throw new Error("Must provide either `fixture` or `files`");
      }
      const fixture = path.join(devTestRoot, "../fixtures", options.fixture);
      fs.cpSync(fixture, root, { recursive: true });

      if (!fs.existsSync(path.join(root, "bun.app.ts"))) {
        if (!fs.existsSync(path.join(root, "index.html"))) {
          throw new Error(`Fixture ${fixture} must contain a bun.app.ts or index.html file.`);
        } else {
          fs.writeFileSync(path.join(root, "bun.app.ts"), indexHtmlScript);
        }
      }
      if (!fs.existsSync(path.join(root, "node_modules"))) {
        if (fs.existsSync(path.join(root, "bun.lockb"))) {
          // run bun install
          await Bun.$`cd ${root} && ${process.execPath} install`;
        } else {
          // link the node_modules directory from test/node_modules to the temp directory
          fs.symlinkSync(path.join(devTestRoot, "../../node_modules"), path.join(root, "node_modules"), "junction");
        }
      }
    }
    fs.writeFileSync(
      path.join(root, "harness_start.ts"),
      dedent`
        import appConfig from "./bun.app.ts";
        export default {
          ...appConfig,
          port: 0,
        };
      `,
    );

    await using devProcess = Bun.spawn({
      cwd: root,
      cmd: [process.execPath, "./harness_start.ts"],
      env: mergeWindowEnvs([
        bunEnv,
        {
          FORCE_COLOR: "1",
          BUN_DEV_SERVER_TEST_RUNNER: "1",
          BUN_DUMP_STATE_ON_CRASH: "1",
        },
      ]),
      stdio: ["pipe", "pipe", "pipe"],
    });
    using stream = new OutputLineStream("dev", devProcess.stdout, devProcess.stderr);
    const port = parseInt((await stream.waitForLine(/localhost:(\d+)/))[1], 10);
    const dev = new Dev(root, port, devProcess, stream);

    await maybeWaitInteractive("start");

    try {
      await options.test(dev);
    } catch (err: any) {
      while (err instanceof SuppressedError) {
        console.error(err.suppressed);
        err = err.error;
      }
      if (interactive) {
        console.error(err);
        await maybeWaitInteractive("exit");
        process.exit(1);
      }
      throw err;
    }

    if (interactive) {
      console.log("\x1b[32mPASS\x1b[0m");
      await maybeWaitInteractive("exit");
      process.exit(0);
    }
  }

  const name = `DevServer > ${basename}.${count}: ${description}`;
  try {
    jest.test(name, run, (isWindows ? 10_000 : 5_000) * (Bun.version.includes("debug") ? 3 : 1));
    return options;
  } catch {
    // not in bun test. allow interactive use
    const arg = process.argv[2];
    if (!arg) {
      const mainFile = JSON.stringify(path.relative(process.cwd(), process.argv[1]));
      console.error("Options for running Dev Server tests:");
      console.error(" - automated:   bun test " + mainFile);
      console.error(" - interactive: bun " + mainFile + " <filter or number for test>");
      process.exit(1);
    }
    if (name.includes(arg)) {
      interactive = true;
      console.log("\x1b[32m" + name + " (Interactive)\x1b[0m");
      run();
      return options;
    }
  }
  return options;
}
