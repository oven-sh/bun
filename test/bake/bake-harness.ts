/// <reference path="../../src/bake/bake.d.ts" />
/* Dev server tests can be run with `bun test` or in interactive mode with `bun run test.ts "name filter"`
 *
 * Env vars:
 *
 * To run with an out-of-path node.js:
 * export BUN_DEV_SERVER_CLIENT_EXECUTABLE="/Users/clo/.local/share/nvm/v22.13.1/bin/node"
 *
 * To write files to a stable location:
 * export BUN_DEV_SERVER_TEST_TEMP="/Users/clo/scratch/dev"
 */
import { Bake, BunFile, Subprocess } from "bun";
import fs, { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert";
import { Matchers } from "bun:test";
import { EventEmitter } from "node:events";
// @ts-ignore
import { dedent } from "../bundler/expectBundled.ts";
import { bunEnv, bunExe, isASAN, isCI, isWindows, mergeWindowEnvs, tempDirWithFiles } from "harness";
import { expect } from "bun:test";
import { exitCodeMapStrings } from "./exit-code-map.mjs";

const ASAN_TIMEOUT_MULTIPLIER = isASAN ? 3 : 1;

const isDebugBuild = Bun.version.includes("debug");

const verboseSynchronization = process.env.BUN_DEV_SERVER_VERBOSE_SYNC
  ? (arg: string) => {
      console.log("\x1b[36m" + arg + "\x1b[0m");
    }
  : () => {};

/**
 * Can be set in fast development environments to improve iteration time.
 * In CI/Windows it appears that sometimes these tests dont wait enough
 * for things to happen, so the extra delay reduces flakiness.
 *
 * Needs much more investigation.
 */
const fastBatches = !!process.env.BUN_DEV_SERVER_FAST_BATCHES;

/**
 * Set to `ALL` to run all stress tests for 10 minutes each.
 * Set to a filter to run a specific filter for 10 minutes.
 */
const stressTestSelect = process.env.DEV_SERVER_STRESS;

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

export const imageFixtures = {
  bun: imageFixture("test/integration/sharp/bun.png"),
  bun2: imageFixture("test/bundler/fixtures/with-assets/img.png"),
};

function imageFixture(relative: string) {
  const buf: any = readFileSync(path.join(import.meta.dir, "../../", relative));
  buf.sourcePath = relative;
  return buf;
}

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

export interface DevServerTest {
  /** Execute the test */
  test: (dev: Dev) => Promise<void>;

  /** Starting files */
  files?: FileObject;
  /** Manually specify which html files to serve */
  htmlFiles?: string[];
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
  /**
   * Copy all files from test/bake/fixtures/<name>
   * This directory must contain `bun.app.ts` or `index.html` to allow hacking on fixtures manually via `bun run .`
   */
  fixture?: string;
  /**
   * Multiply the timeout by this number.
   */
  timeoutMultiplier?: number;
  /**
   * Directory to write the bootstrap files into.
   * Avoid if possible, this is to reproduce specific bugs.
   */
  mainDir?: string;

  skip?: ("win32" | "darwin" | "linux" | "ci")[];
  /**
   * Only run this test.
   */
  only?: boolean;
}

let interactive = false;
let activeClient: Client | null = null;
const interactive_timeout = 24 * 60 * 60 * 1000; // 24 hours

async function maybeWaitInteractive(message: string) {
  if (interactive) {
    while (activeClient) {
      const input = prompt("\x1b[36mPress return to " + message + "; JS>\x1b[0m");
      if (input === "q" || input === "exit") {
        process.exit(0);
        return;
      }
      if (input === "" || input == null) return;
      const result = await activeClient.jsInteractive(input);
      console.log(result);
    }
    console.log("\x1b[36mPress return to " + message + "\x1b[0m");
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

type FileObject = Record<string, string | Buffer | BunFile>;

enum WatchSynchronization {
  // Callback for starting a batch
  Started = 0,
  // During a batch, files were seen. Batch is still running.
  SeenFiles = 1,
  // Batch no longer running, files seen!
  ResultDidNotBundle = 2,
  // Sent on every build finished:
  AnyBuildFinished = 3,
  // Sent on every build finished, you must wait for web sockets:
  AnyBuildFinishedWaitForWebSockets = 4,
}

export class Dev extends EventEmitter {
  rootDir: string;
  port: number;
  baseUrl: string;
  panicked = false;
  connectedClients: Set<Client> = new Set();
  options: { files: Record<string, string> };
  nodeEnv: "development" | "production";
  batchingChanges: { write?: () => void } | null = null;
  stressTestEndurance = false;

  socket?: WebSocket;

  // These properties are not owned by this class
  devProcess: Subprocess<"pipe", "pipe", "pipe">;
  output: OutputLineStream;

  constructor(
    root: string,
    port: number,
    process: Subprocess<"pipe", "pipe", "pipe">,
    stream: OutputLineStream,
    nodeEnv: "development" | "production",
    options: DevServerTest,
  ) {
    super();
    this.rootDir = realpathSync(root);
    this.port = port;
    this.baseUrl = `http://localhost:${port}`;
    this.devProcess = process;
    this.output = stream;
    this.options = options as any;
    this.output.on("panic", () => {
      this.panicked = true;
    });
    this.nodeEnv = nodeEnv;
  }

  connectSocket() {
    const connected = Promise.withResolvers<void>();
    this.socket = new WebSocket(this.baseUrl + "/_bun/hmr");
    this.socket.onmessage = event => {
      const data = new Uint8Array(event.data as any);
      if (data[0] === "V".charCodeAt(0)) {
        this.socket!.send("sr");
        connected.resolve();
      }
      if (data[0] === "r".charCodeAt(0)) {
        verboseSynchronization("watch_synchronization: " + WatchSynchronization[data[1]]);
        this.emit("watch_synchronization", data[1]);
      }
      this.emit("hmr", data);
    };
    return connected.promise;
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

  #waitForSyncEvent(event: WatchSynchronization) {
    return new Promise<void>((resolve, reject) => {
      let dev = this;
      function handle(kind: WatchSynchronization) {
        if (kind === event) {
          dev.off("watch_synchronization", handle);
          resolve();
        }
      }
      dev.on("watch_synchronization", handle);
    });
  }

  async batchChanges(options: { errors?: null | ErrorSpec[]; snapshot?: string } = {}) {
    if (this.batchingChanges) {
      this.batchingChanges.write?.();
      return null;
    }
    this.batchingChanges = {};

    let dev = this;
    const initWait = this.#waitForSyncEvent(WatchSynchronization.Started);
    this.socket!.send("H");
    await initWait;

    let hasSeenFiles = true;
    let seenFiles: PromiseWithResolvers<void>;
    function onSeenFiles(ev: WatchSynchronization) {
      if (ev === WatchSynchronization.SeenFiles) {
        hasSeenFiles = true;
        seenFiles.resolve();
        dev.off("watch_synchronization", onSeenFiles);
      }
    }
    function resetSeenFilesWithResolvers() {
      if (!hasSeenFiles) return;
      seenFiles = Promise.withResolvers<void>();
      dev.on("watch_synchronization", onSeenFiles);
    }
    resetSeenFilesWithResolvers();

    let wantsHmrEvent = true;
    for (const client of dev.connectedClients) {
      if (!client.webSocketMessagesAllowed) {
        wantsHmrEvent = false;
        break;
      }
    }

    const wait = this.waitForHotReload(wantsHmrEvent);
    const b = {
      write: resetSeenFilesWithResolvers,
      [Symbol.asyncDispose]: async () => {
        if (wantsHmrEvent && interactive) {
          await seenFiles.promise;
        } else if (wantsHmrEvent) {
          await Promise.race([seenFiles.promise]);
        }
        if (!fastBatches) {
          // Wait an extra delay to avoid double-triggering events.
          await Bun.sleep(300);
        }

        dev.off("watch_synchronization", onSeenFiles);

        this.socket!.send("H");
        await wait;

        let errors = options.errors;
        if (errors !== null) {
          errors ??= [];
          for (const client of this.connectedClients) {
            await client.expectErrorOverlay(errors, options.snapshot);
          }
        }
        this.batchingChanges = null;
      },
    };
    this.batchingChanges = b;
    return b;
  }

  write(file: string, contents: string, options: { errors?: null | ErrorSpec[]; dedent?: boolean } = {}) {
    const snapshot = snapshotCallerLocation();
    return withAnnotatedStack(snapshot, async () => {
      await maybeWaitInteractive("write " + file);
      const isDev = this.nodeEnv === "development";
      await using _wait = isDev
        ? await this.batchChanges({
            errors: options.errors,
            snapshot: snapshot,
          })
        : null;

      await Bun.write(
        this.join(file),
        ((typeof contents === "string" && options.dedent) ?? true) ? dedent(contents) : contents,
      );
    });
  }

  read(file: string): string {
    return fs.readFileSync(path.join(this.rootDir, file), "utf8");
  }

  /**
   * Writes the file back without any changes
   * This is useful for triggering file watchers without modifying content
   */
  async writeNoChanges(file: string): Promise<void> {
    const content = this.read(file);
    await this.write(file, content, { dedent: false });
  }

  /**
   * Deletes a file and waits for hot reload if in development mode
   * @param file Path to the file to delete, relative to the root directory
   * @param options Options for handling errors after deletion
   * @returns Promise that resolves when the file is deleted and hot reload is complete (if applicable)
   */
  delete(file: string, options: { errors?: null | ErrorSpec[] } = {}) {
    const snapshot = snapshotCallerLocation();
    return withAnnotatedStack(snapshot, async () => {
      await maybeWaitInteractive("delete " + file);
      const isDev = this.nodeEnv === "development";
      await using _wait = isDev
        ? await this.batchChanges({
            errors: options.errors,
            snapshot: snapshot,
          })
        : null;

      const filePath = this.join(file);
      if (!fs.existsSync(filePath)) {
        throw new Error(`File ${file} does not exist`);
      }

      fs.unlinkSync(filePath);
    });
  }

  patch(
    file: string,
    {
      find,
      replace,
      errors,
      dedent: shouldDedent = true,
    }: { find: string; replace: string; errors?: null | ErrorSpec[]; dedent?: boolean },
  ) {
    const snapshot = snapshotCallerLocation();
    return withAnnotatedStack(snapshot, async () => {
      await maybeWaitInteractive("patch " + file);
      const isDev = this.nodeEnv === "development";
      await using _wait = isDev
        ? await this.batchChanges({
            errors: errors,
            snapshot: snapshot,
          })
        : null;

      const filename = this.join(file);
      const source = fs.readFileSync(filename, "utf8");
      const contents = source.replace(find, replace);
      if (contents === source) {
        throw new Error(`Couldn't find and replace ${JSON.stringify(find)} in ${file}`);
      }
      await Bun.write(filename, typeof contents === "string" && shouldDedent ? dedent(contents) : contents);
    });
  }

  join(file: string) {
    return path.join(this.rootDir, file);
  }

  waitForHotReload(wantsHmrEvent: boolean) {
    if (this.nodeEnv !== "development") return Promise.resolve();
    let dev = this;
    return new Promise<void>((resolve, reject) => {
      let timer: NodeJS.Timer | null = null;
      let clientWaits = 0;
      let seenMainEvent = false;
      function cleanupAndResolve() {
        verboseSynchronization("Cleaning up and resolving");
        timer !== null && clearTimeout(timer);
        dev.off("watch_synchronization", onEvent);
        for (const dispose of disposes) {
          dispose();
        }
        if (fastBatches) resolve();
        else setTimeout(resolve, 250);
      }
      const disposes = new Set<() => void>();
      for (const client of dev.connectedClients) {
        const socketEventHandler = () => {
          verboseSynchronization("Client received event");
          clientWaits++;
          if (seenMainEvent && clientWaits === dev.connectedClients.size) {
            client.off("received-hmr-event", socketEventHandler);
            cleanupAndResolve();
          }
        };
        client.on("received-hmr-event", socketEventHandler);
        disposes.add(() => {
          client.off("received-hmr-event", socketEventHandler);
        });
      }
      async function onEvent(kind: WatchSynchronization) {
        assert(kind !== WatchSynchronization.Started, "WatchSynchronization.Started should not be emitted");
        if (kind === WatchSynchronization.AnyBuildFinished) {
          seenMainEvent = true;
          cleanupAndResolve();
        } else if (kind === WatchSynchronization.AnyBuildFinishedWaitForWebSockets) {
          verboseSynchronization("Need to wait for (" + clientWaits + "/" + dev.connectedClients.size + ") clients");
          seenMainEvent = true;
          if (clientWaits === dev.connectedClients.size) {
            cleanupAndResolve();
          }
        } else if (kind === WatchSynchronization.ResultDidNotBundle) {
          if (wantsHmrEvent) {
            await Bun.sleep(500);
            if (seenMainEvent) return;
            console.warn(
              "\x1b[33mWARN: Dev Server did not pick up any changed files. Consider wrapping this call in expectNoWebSocketActivity\x1b[35m",
            );
          }
          cleanupAndResolve();
        }
      }
      dev.on("watch_synchronization", onEvent);
    });
  }

  async client(
    url = "/",
    options: {
      errors?: ErrorSpec[];
      /** Allow using `getMostRecentHmrChunk` */
      storeHotChunks?: boolean;
      /** Disable the logic that fails a test from a reload */
      allowUnlimitedReloads?: boolean;
    } = {},
  ) {
    await maybeWaitInteractive("open client " + url);
    const client = new Client(new URL(url, this.baseUrl).href, {
      storeHotChunks: options.storeHotChunks,
      hmr: this.nodeEnv === "development",
      expectErrors: !!options.errors,
      allowUnlimitedReloads: options.allowUnlimitedReloads,
    });
    const onPanic = () => client.output.emit("panic");
    this.output.on("panic", onPanic);
    if (this.nodeEnv === "development") {
      try {
        await client.output.waitForLine(hmrClientInitRegex);
      } catch (e) {
        client[Symbol.asyncDispose]();
        throw e;
      }
      await client.expectErrorOverlay(options.errors ?? []);
    }
    this.connectedClients.add(client);
    client.on("exit", () => {
      this.output.off("panic", onPanic);
      this.connectedClients.delete(client);
    });
    return client;
  }

  async gracefulExit() {
    await this.fetch("/_dev_server_test_set");
    const hasAlreadyExited = this.devProcess.exitCode !== null || this.devProcess.signalCode !== null;
    if (!hasAlreadyExited) {
      this.devProcess.send({ type: "graceful-exit" });
    }
    // Leak sanitizer takes forever to exit the process
    const timeout = isASAN ? 30 * 1000 : 2000;
    await Promise.race([
      this.devProcess.exited,
      new Promise(resolve => setTimeout(resolve, interactive ? interactive_timeout : timeout)),
    ]);
    if (this.output.panicked) {
      await this.devProcess.exited;
      throw new Error("DevServer panicked");
    }
    if (this.devProcess.exitCode === null) {
      throw new Error("Timed out while waiting for dev server process to close");
    }
    if (this.devProcess.exitCode !== 0) {
      const code =
        " with " +
        (this.devProcess.exitCode ? `code ${this.devProcess.exitCode}` : `signal ${this.devProcess.signalCode}`);
      throw new Error(`DevServer exited${code}`);
    }
  }

  mkdir(dir: string) {
    return fs.mkdirSync(path.join(this.rootDir, dir), { recursive: true });
  }

  /**
   * Run a stress test. The function should perform I/O in a loop, for about a
   * couple of seconds. In CI, this round is run once. In development, this can
   * be run forever using `DEV_SERVER_STRESS=FILTER`.
   *
   * Tests using this should go in `stress.test.ts`
   */
  async stressTest(round: () => Promise<void> | void) {
    if (!this.stressTestEndurance) {
      await round();
      await Bun.sleep(250);
      if (this.output.panicked) {
        throw new Error("DevServer panicked in stress test");
      }
      return;
    }

    const endTime = Date.now() + 10 * 60 * 1000;
    let iteration = 0;

    using log = new TrailingLog();
    while (Date.now() < endTime) {
      const timeRemaining = endTime - Date.now();
      const minutes = Math.floor(timeRemaining / 60000);
      const seconds = Math.floor((timeRemaining % 60000) / 1000);
      log.setMessage(
        `[STRESS] Time remaining: ${minutes}:${seconds.toString().padStart(2, "0")}. Iteration ${++iteration}`,
      );

      await round();

      if (this.output.panicked) {
        throw new Error("DevServer panicked in stress test");
      }
    }

    await Bun.sleep(250);
    if (this.output.panicked) {
      throw new Error("DevServer panicked in stress test");
    }
  }
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

  async arrayBuffer() {
    return (await this).arrayBuffer();
  }

  async blob() {
    return (await this).blob();
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

  expectFile(expected: Buffer) {
    return withAnnotatedStack(snapshotCallerLocation(), async () => {
      const res = await this;
      expect(res.status).toBe(200);
      let actual: any = new Uint8Array(await res.arrayBuffer());
      try {
        expect(actual).toEqual(expected);
      } catch (e) {
        // better printing
        display_as_string: {
          for (let i = 0; i < actual.byteLength; i++) {
            if (actual[i] > 127 || actual[i] < 20) {
              break display_as_string;
            }
          }
          actual = new TextDecoder("utf8").decode(actual);
          if ((expected as any).sourcePath) {
            expected[Bun.inspect.custom] = () => `[File] ${(expected as any).sourcePath}`;
          }
          expect(actual).toEqual(expected);
        }
        throw e;
      }
    });
  }
}

class StylePromise extends Promise<Record<string, string>> {
  selector: string;
  capturedStack: string;

  constructor(
    executor: (
      resolve: (value: Record<string, string> | PromiseLike<Record<string, string>>) => void,
      reject: (reason?: any) => void,
    ) => void,
    selector: string,
    capturedStack: string,
  ) {
    super(executor);
    this.selector = selector;
    this.capturedStack = capturedStack;
  }

  notFound() {
    const snapshot = snapshotCallerLocation();
    return withAnnotatedStack(snapshot, () => {
      return new Promise<void>((done, reject) => {
        this.then(style => {
          if (style === undefined) {
            done();
          } else {
            reject(new Error(`Selector '${this.selector}' was found: ${JSON.stringify(style)}`));
          }
        });
      });
    });
  }
}

const node = process.env.BUN_DEV_SERVER_CLIENT_EXECUTABLE ?? Bun.which("node");
expect(node, "test will fail if this is not node").not.toBe(process.execPath);

const danglingProcesses = new Set<Subprocess>();

/**
 * Controls a subprocess that uses happy-dom as a lightweight browser. It is
 * sandboxed in a separate process because happy-dom is a terrible mess to work
 * with, and has some compatibility issues with Bun.
 */
export class Client extends EventEmitter {
  #proc: Subprocess;
  output: OutputLineStream;
  exited = false;
  exitCode: string | number | null = null;
  messages: any[] = [];
  #hmrChunk: string | null = null;
  suppressInteractivePrompt: boolean = false;
  expectingReload = false;
  hmr = false;
  webSocketMessagesAllowed = true;

  constructor(
    url: string,
    options: { storeHotChunks?: boolean; hmr: boolean; expectErrors?: boolean; allowUnlimitedReloads?: boolean },
  ) {
    super();
    activeClient = this;
    const proc = Bun.spawn({
      cmd: [
        node,
        "--no-warnings",
        "--experimental-websocket", // support node 20
        path.join(import.meta.dir, "client-fixture.mjs"),
        url,
        options.storeHotChunks ? "--store-hot-chunks" : "",
        options.expectErrors ? "--expect-errors" : "",
        options.allowUnlimitedReloads ? "--allow-unlimited-reloads" : "",
      ].filter(Boolean) as string[],
      env: bunEnv,
      serialization: "json",
      ipc: (message, subprocess) => {
        this.emit(message.type, ...message.args);
      },
      onExit: (subprocess, exitCode, signalCode, error) => {
        danglingProcesses.delete(subprocess);
        if (exitCode !== null) {
          this.exitCode = exitCode;
        } else if (signalCode !== null) {
          console.log("THE SIGNAL CODE IS", signalCode);
          this.exitCode = `${signalCode}`;
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
    danglingProcesses.add(proc);
    this.on("message", (message: any) => {
      this.messages.push(message);
    });
    this.on("hmr-chunk", (chunk: string) => {
      this.#hmrChunk = chunk;
    });
    this.#proc = proc;
    this.hmr = options.hmr;
    this.output = new OutputLineStream("web", proc.stdout, proc.stderr);
  }

  hardReload(options: { errors?: ErrorSpec[] } = {}) {
    return withAnnotatedStack(snapshotCallerLocation(), async () => {
      await maybeWaitInteractive("hard-reload");
      if (this.exited) throw new Error("Client is not running.");
      this.#proc.send({ type: "hard-reload" });

      if (this.hmr) {
        await this.output.waitForLine(hmrClientInitRegex);
        await this.expectErrorOverlay(options.errors ?? []);
      }
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

  elemsText(selector: string): Promise<string[]> {
    return withAnnotatedStack(snapshotCallerLocation(), async () => {
      const elems = await this.js<
        string[]
      >`Array.from(document.querySelectorAll(${selector})).map(elem => elem.innerHTML)`;
      return elems;
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
      let code;
      if (exitCodeMapStrings[this.exitCode]) {
        code = ": " + JSON.stringify(exitCodeMapStrings[this.exitCode]);
      } else {
        code = " with " + (typeof this.exitCode === "number" ? `code ${this.exitCode}` : `signal ${this.exitCode}`);
      }
      throw new Error(`Client exited${code}`);
    }
    if (this.messages.length > 0) {
      throw new Error(`Client sent ${this.messages.length} unread messages: ${JSON.stringify(this.messages, null, 2)}`);
    }
    this.output[Symbol.dispose]();
  }

  expectReload(cb: () => Promise<void>) {
    return withAnnotatedStack(snapshotCallerLocation(), async () => {
      this.expectingReload = true;
      if (this.exited) throw new Error("Client exited while waiting for reload");
      let emitted = false;
      const resolver = Promise.withResolvers();
      this.#proc.send({ type: "expect-reload" });
      const onEvent = () => {
        emitted = true;
        resolver.resolve();
        this.expectingReload = false;
      };
      this.once("reload", onEvent);
      this.once("exit", onEvent);
      let t: any = setTimeout(
        () => {
          t = null;
          resolver.resolve();
          this.expectingReload = false;
        },
        interactive ? interactive_timeout : 1000,
      );
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
    return this.#expectMessageImpl(true, x);
  }

  expectMessageInAnyOrder(...x: any) {
    return this.#expectMessageImpl(false, x);
  }

  #expectMessageImpl(strictOrdering: boolean, x: any[]) {
    return withAnnotatedStack(snapshotCallerLocation(), async () => {
      if (this.exited) throw new Error("Client exited while waiting for message");
      if (this.messages.length !== x.length) {
        if (interactive) {
          console.log("Waiting for messages (have", this.messages.length, "expected", x.length, ")");
        }
        const dev = this;
        // Wait up to a threshold before giving up
        function cleanup() {
          dev.off("message", onMessage);
          dev.off("exit", onExit);
        }
        const resolver = Promise.withResolvers();
        function onMessage(message: any) {
          process.nextTick(() => {
            if (dev.messages.length === x.length) resolver.resolve();
          });
        }
        function onExit() {
          resolver.resolve();
        }
        this.on("message", onMessage);
        this.on("exit", onExit);
        let t: any = setTimeout(
          () => {
            t = null;
            resolver.resolve();
          },
          interactive ? interactive_timeout : 1000,
        );
        await resolver.promise;
        if (t) clearTimeout(t);
        cleanup();
      }
      if (this.exited) throw new Error("Client exited while waiting for message");
      let m = this.messages;
      this.messages = [];
      if (!strictOrdering) {
        m = m.sort();
        x = x.sort();
      }
      expect(m).toEqual(x);
    });
  }

  /**
   * Expect the page to have errors. Empty array asserts the modal is not
   * visible.
   * @example
   * ```ts
   * errors: [
   *   "index.ts:1:21: error: Could not resolve: "./second"",
   * ],
   * ```
   */
  expectErrorOverlay(errors: ErrorSpec[], caller: string | null = null) {
    return withAnnotatedStack(caller ?? snapshotCallerLocationMayFail(), async () => {
      this.suppressInteractivePrompt = true;
      let retries = 0;
      let hasVisibleModal = false;
      while (retries < 5) {
        hasVisibleModal = await this.js`document.querySelector("bun-hmr")?.style.display === "block"`;
        if (hasVisibleModal) break;
        await Bun.sleep(200);
        retries++;
      }
      this.suppressInteractivePrompt = false;
      if (errors && errors.length > 0) {
        if (!hasVisibleModal) {
          await maybeWaitInteractive("expectErrorOverlay");
          throw new Error("Expected errors, but none found");
        }

        // Create unique message ID for this evaluation
        const messageId = Math.random().toString(36).slice(2);

        // Send the evaluation request and wait for response
        this.#proc.send({
          type: "get-errors",
          args: [messageId],
        });

        const [result] = await EventEmitter.once(this, `get-errors-result-${messageId}`);

        if (result.error) {
          throw new Error(result.error);
        }
        const actualErrors = result.value;
        const expectedErrors = [...errors].sort();
        expect(actualErrors).toEqual(expectedErrors);
      } else {
        if (hasVisibleModal) {
          // Create unique message ID for this evaluation
          const messageId = Math.random().toString(36).slice(2);

          // Send the evaluation request and wait for response
          this.#proc.send({
            type: "get-errors",
            args: [messageId],
          });

          const [result] = await EventEmitter.once(this, `get-errors-result-${messageId}`);

          if (result.error) {
            throw new Error(result.error);
          }
          const actualErrors = result.value;
          expect(actualErrors).toEqual([]);
        }
      }
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
      if (!this.suppressInteractivePrompt) await maybeWaitInteractive("js");
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

  async click(selector: string) {
    await maybeWaitInteractive("click " + selector);
    this.suppressInteractivePrompt = true;
    await this.js`
      const elem = document.querySelector(${selector});
      if (!elem) throw new Error("Element not found: " + ${selector});
      elem.click();
    `;
    this.suppressInteractivePrompt = false;
  }

  async getMostRecentHmrChunk() {
    if (!this.#hmrChunk) {
      // Wait up to a threshold before giving up
      const resolver = Promise.withResolvers();
      this.once("hmr-chunk", () => resolver.resolve());
      this.once("exit", () => resolver.reject(new Error("Client exited while waiting for HMR chunk")));
      let t: any = setTimeout(
        () => {
          t = null;
          resolver.reject(new Error("Timeout waiting for HMR chunk"));
        },
        interactive ? interactive_timeout : 1000,
      );
      await resolver.promise;
      if (t) clearTimeout(t);
    }
    if (!this.#hmrChunk) {
      throw new Error("No HMR chunks received. Make sure storeHotChunks is true");
    }
    const chunk = this.#hmrChunk;
    this.#hmrChunk = null;
    return chunk;
  }

  /**
   * Looks through loaded stylesheets to find a rule with this EXACT selector,
   * then it returns the values in it.
   */
  style(selector: string): LazyStyle {
    return new Proxy(
      new StylePromise(
        (resolve, reject) => {
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

          this.once(`get-style-result-${messageId}`, handler);

          // Send the evaluation request
          this.#proc.send({
            type: "get-style",
            args: [messageId, selector],
          });
        },
        selector,
        snapshotCallerLocation(),
      ),
      styleProxyHandler,
    );
  }

  async expectNoWebSocketActivity(cb: () => Promise<void>) {
    return withAnnotatedStack(snapshotCallerLocation(), async () => {
      if (this.exited) throw new Error("Client exited while waiting for no WebSocket activity");

      // Block WebSocket messages
      this.#proc.send({ type: "set-allow-websocket-messages", args: [false] });
      this.webSocketMessagesAllowed = false;

      try {
        await cb();
      } finally {
        // Re-enable WebSocket messages
        this.#proc.send({ type: "set-allow-websocket-messages", args: [true] });
        this.webSocketMessagesAllowed = true;
      }
    });
  }

  async reactRefreshComponentHash(file: string, name: string): Promise<string> {
    return withAnnotatedStack(snapshotCallerLocation(), async () => {
      const component = await this.js<any>`
        const k = ${file} + ":" + ${name};
        const entry = globalThis.components.get(k);
        if (!entry) throw new Error("Component not found: " + k);
        globalThis.components.delete(k);
        globalThis.functionToComponent.delete(entry.fn);
        return entry.hash;
      `;
      return component;
    });
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
      return expectProxy(target.text, target.chain.concat(prop), Reflect.get(target.expect, prop, target.expect));
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

type CssPropertyName = keyof React.CSSProperties;
type LazyStyle = {
  [K in CssPropertyName]: LazyStyleProp;
} & {
  /** Assert that the selector was not found */
  notFound(): Promise<void>;
};
interface LazyStyleProp extends Promise<string | undefined> {
  expect: Matchers<string | undefined>;
}

const styleProxyHandler: ProxyHandler<any> = {
  get(target, prop, receiver) {
    if (prop === "then") {
      return Promise.prototype.then.bind(target);
    }
    const existing = Reflect.get(target, prop, receiver);
    if (existing !== undefined) {
      return existing;
    }
    const subpromise = target.then(style => {
      if (style === undefined) {
        throw new Error(`Selector '${target.selector}' was not found`);
      }
      return style[prop];
    });
    Object.defineProperty(subpromise, "expect", {
      get: expectOnPromise,
    });
    return subpromise;
  },
};

function expectOnPromise(this: Promise<any>) {
  return expectProxy(this, [], expect(""));
}
function snapshotCallerLocation(): string {
  const stack = new Error().stack!;
  const lines = stack.replaceAll("\r\n", "\n").split("\n");
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i].replaceAll("\\", "/");
    if (line.includes(import.meta.dir.replaceAll("\\", "/")) && !line.includes(import.meta.file)) {
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
    stackLine = stackLine.replace("<anonymous>", "test");
    const oldStack = err.stack;
    const newError = new Error(err?.message ?? oldStack.slice(0, oldStack.indexOf("\n    at ")));
    (newError as any).stackLine = stackLine;
    newError.stack = `${newError.message}\n${stackLine}`;
    throw newError;
  }
}

const tempDir =
  process.env.BUN_DEV_SERVER_TEST_TEMP ||
  fs.mkdtempSync(path.join(process.platform === "darwin" && !process.env.CI ? "/tmp" : os.tmpdir(), "bun-dev-test-"));

// Ensure temp directory exists
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Create a cache directory for React dependencies
const reactCacheDir = path.join(tempDir, ".react-cache");
if (!fs.existsSync(reactCacheDir)) {
  fs.mkdirSync(reactCacheDir, { recursive: true });
}

function cleanTestDir(dir: string) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    fs.rmSync(filePath, { recursive: true, force: true });
  }
}

async function installReactWithCache(root: string) {
  const cacheFiles = ["node_modules", "package.json", "bun.lock"];
  const cacheValid = cacheFiles.every(file => fs.existsSync(path.join(reactCacheDir, file)));

  if (cacheValid) {
    // Copy from cache
    for (const file of cacheFiles) {
      const src = path.join(reactCacheDir, file);
      const dest = path.join(root, file);
      if (fs.statSync(src).isDirectory()) {
        fs.cpSync(src, dest, { recursive: true });
      } else {
        fs.copyFileSync(src, dest);
      }
    }
  } else {
    // Install fresh and populate cache
    await Bun.$`${bunExe()} i --linker=hoisted react@experimental react-dom@experimental react-server-dom-bun react-refresh@experimental && ${bunExe()} install --linker=hoisted`
      .cwd(root)
      .env({ ...bunEnv })
      .throws(true);

    // Copy to cache for future use
    for (const file of cacheFiles) {
      const src = path.join(root, file);
      const dest = path.join(reactCacheDir, file);
      if (fs.existsSync(src)) {
        if (fs.statSync(src).isDirectory()) {
          fs.cpSync(src, dest, { recursive: true, force: true });
        } else {
          fs.copyFileSync(src, dest);
        }
      }
    }
  }
}

// Global React cache management
let reactCachePromise: Promise<void> | null = null;

/**
 * Ensures the React cache is populated. This is a global operation that
 * only happens once per test run.
 */
export async function ensureReactCache(): Promise<void> {
  if (!reactCachePromise) {
    reactCachePromise = (async () => {
      const cacheFiles = ["node_modules", "package.json", "bun.lock"];
      const cacheValid = cacheFiles.every(file => fs.existsSync(path.join(reactCacheDir, file)));

      if (!cacheValid) {
        // Create a temporary directory for installation
        const tempInstallDir = fs.mkdtempSync(path.join(tempDir, "react-install-"));

        // Create a minimal package.json
        fs.writeFileSync(
          path.join(tempInstallDir, "package.json"),
          JSON.stringify({
            name: "react-cache-install",
            version: "1.0.0",
            private: true,
          }),
        );

        try {
          // Install React packages
          await Bun.$`${bunExe()} i --linker=hoisted react@experimental react-dom@experimental react-server-dom-bun react-refresh@experimental && ${bunExe()} install --linker=hoisted`
            .cwd(tempInstallDir)
            .env({ ...bunEnv })
            .throws(true);

          // Copy to cache
          for (const file of cacheFiles) {
            const src = path.join(tempInstallDir, file);
            const dest = path.join(reactCacheDir, file);
            if (fs.existsSync(src)) {
              if (fs.statSync(src).isDirectory()) {
                fs.cpSync(src, dest, { recursive: true, force: true });
              } else {
                fs.copyFileSync(src, dest);
              }
            }
          }
        } finally {
          // Clean up temp directory
          fs.rmSync(tempInstallDir, { recursive: true, force: true });
        }
      }
    })();
  }

  return reactCachePromise;
}

/**
 * Copies cached React dependencies to the specified directory.
 * This ensures React is available without running install.
 */
export async function copyCachedReactDeps(root: string): Promise<void> {
  // Ensure cache is populated
  await ensureReactCache();

  // Copy node_modules from cache to target directory
  const src = path.join(reactCacheDir, "node_modules");
  const dest = path.join(root, "node_modules");

  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true, force: true });
  }
}

/**
 * Creates a temporary directory with files and React dependencies pre-installed.
 * This is a convenience wrapper that combines tempDirWithFiles with copyCachedReactDeps.
 */
export async function tempDirWithBakeDeps(name: string, files: Record<string, string>): Promise<string> {
  const dir = tempDirWithFiles(name, files);
  await copyCachedReactDeps(dir);
  return dir;
}

const devTestRoot = path.join(import.meta.dir, "dev").replaceAll("\\", "/");
const prodTestRoot = path.join(import.meta.dir, "dev").replaceAll("\\", "/");
const counts: Record<string, number> = {};

console.log("Dev server testing directory:", tempDir);

async function writeAll(root: string, files: FileObject) {
  const promises: Promise<any>[] = [];
  for (const [file, contents] of Object.entries(files)) {
    const filename = path.join(root, file);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const formattedContents =
      typeof contents === "string" ? dedent(contents).replaceAll("{{root}}", root.replaceAll("\\", "\\\\")) : contents;
    // @ts-expect-error the type of Bun.write is too strict
    promises.push(Bun.write(filename, formattedContents));
  }
  await Promise.all(promises);
}

class OutputLineStream extends EventEmitter {
  reader1: ReadableStreamDefaultReader;
  reader2: ReadableStreamDefaultReader;

  name: string;
  lines: string[] = [];
  cursor: number = 0;
  disposed = false;
  closes = 0;
  panicked = false;
  exitCode: number | string | null = null;

  constructor(name: string, readable1: ReadableStream, readable2: ReadableStream) {
    super();

    this.setMaxListeners(10000); // TODO

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
          const text =
            last +
            td
              .decode(value, { stream: true })
              .replace(clearScreenCode, "") // no screen clears
              .replaceAll("\r", "") // windows hell
              .replaceAll("\x1b[31m", "\x1b[39m"); // remove red because it looks like an error
          const lines = text.split("\n");
          last = lines.pop()!;
          for (const line of lines) {
            this.lines.push(line);
            if (
              line.includes("============================================================") ||
              line.includes("Allocation scope leaked") ||
              line.includes("collection first used here") ||
              line.includes("allocator mismatch") ||
              line.includes("assertion failure") ||
              line.includes("race condition")
            ) {
              // Tell consumers to wait for the process to exit
              this.panicked = true;
              this.emit("panic");
            }
            // These can be noisy due to symlinks.
            if (isWindows && line.includes("is not in the project directory and will not be watched")) continue;
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

  waitForLine(
    regex: RegExp,
    timeout = interactive ? interactive_timeout : (isWindows ? 5000 : 1000) * (Bun.version.includes("debug") ? 3 : 1),
  ): Promise<RegExpMatchArray> {
    if (this.panicked) {
      return new Promise((_, reject) => {
        this.on("close", () => {
          reject(new Error("Panicked while waiting for line " + JSON.stringify(regex.toString())));
        });
      });
    }
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
        if (exitCodeMapStrings[this.exitCode]) {
          reject(new Error(exitCodeMapStrings[this.exitCode]));
        } else {
          reject(new Error("Process exited before line " + JSON.stringify(regex.toString()) + " was found"));
        }
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

export function indexHtmlScript(htmlFiles: string[]) {
  return [
    ...htmlFiles.map((file, i) => `import html${i} from ${JSON.stringify("./" + file.replaceAll(path.sep, "/"))};`),
    "export default {",
    "  static: {",
    ...(htmlFiles.length === 1
      ? [`    '/*': html0,`]
      : htmlFiles.map(
          (file, i) =>
            `    ${JSON.stringify(
              "/" +
                file
                  .replace(/\.html$/, "")
                  .replace("/index", "")
                  .replace(/\/$/, ""),
            )}: html${i},`,
        )),
    "  },",
    "  fetch(req) {",
    "    return new Response('Not Found', { status: 404 });",
    "  },",
    "};",
  ].join("\n");
}

const skipTargets = [process.platform, isCI ? "ci" : null].filter(Boolean);

function testImpl<T extends DevServerTest>(
  description: string,
  options: T,
  NODE_ENV: "development" | "production",
  caller: string,
): T {
  if (interactive) return options;

  const jest = (Bun as any).jest(caller);

  const basename = path.basename(caller, ".test" + path.extname(caller));
  const count = (counts[basename] = (counts[basename] ?? 0) + 1);

  const name = `${
    NODE_ENV === "development" //
      ? Bun.enableANSIColors
        ? " \x1b[35mDEV\x1b[0m"
        : " DEV"
      : Bun.enableANSIColors
        ? "\x1b[36mPROD\x1b[0m"
        : "PROD"
  }:${basename}-${count}: ${description}`;

  const isStressTest = stressTestSelect === "ALL" || (stressTestSelect && name.includes(stressTestSelect));

  async function run() {
    const root = path.join(tempDir, basename + count);

    // Clean the test directory if it exists
    cleanTestDir(root);

    const mainDir = path.resolve(root, options.mainDir ?? ".");
    if (options.files) {
      const htmlFiles = (options.htmlFiles ?? Object.keys(options.files).filter(file => file.endsWith(".html"))).map(
        x => path.join(root, x),
      );
      await writeAll(root, options.files);
      const runInstall = options.framework === "react";
      if (runInstall) {
        // await copyCachedReactDeps(root);
        await installReactWithCache(root);
      }
      if (options.files["bun.app.ts"] == undefined && htmlFiles.length === 0) {
        if (!options.framework) {
          throw new Error("Must specify one of: `options.framework`, `*.html`, or `bun.app.ts`");
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
      } else if (htmlFiles.length > 0) {
        if (options.files["bun.app.ts"]) {
          throw new Error("Cannot provide both bun.app.ts and index.html");
        }
        await Bun.write(
          path.join(mainDir, "bun.app.ts"),
          indexHtmlScript(htmlFiles.map(file => path.relative(mainDir, file))),
        );
      }
    } else {
      if (!options.fixture) {
        throw new Error("Must provide either `fixture` or `files`");
      }
      const fixture = path.join(devTestRoot, "../fixtures", options.fixture);
      fs.cpSync(fixture, root, { recursive: true });

      if (!fs.existsSync(path.join(mainDir, "bun.app.ts"))) {
        if (!fs.existsSync(path.join(mainDir, "index.html"))) {
          throw new Error(`Fixture ${fixture} must contain a bun.app.ts or index.html file.`);
        } else {
          await Bun.write(path.join(root, "bun.app.ts"), indexHtmlScript(["index.html"]));
        }
      }
      if (!fs.existsSync(path.join(root, "node_modules"))) {
        if (fs.existsSync(path.join(root, "bun.lock"))) {
          // run bun install
          Bun.spawnSync({
            cmd: [process.execPath, "install", "--linker=hoisted"],
            cwd: root,
            stdio: ["inherit", "inherit", "inherit"],
            env: bunEnv,
          });
        } else {
          // link the node_modules directory from test/node_modules to the temp directory
          fs.symlinkSync(path.join(devTestRoot, "../../node_modules"), path.join(root, "node_modules"), "junction");
        }
      }
    }
    fs.writeFileSync(
      path.join(root, "harness_start.ts"),
      dedent`
        import appConfig from ${JSON.stringify(path.join(mainDir, "bun.app.ts"))};
        import { fullGC } from "bun:jsc";

        const routes = appConfig.static ?? (appConfig.routes ??= {});
        if (!routes) throw new Error("No routes found in bun.app.ts");
        let extractedServer = null;
        routes['/_dev_server_test_set'] = async (req, server) => (extractedServer = server, new Response(""));
        
        export default {
          ...appConfig,
          port: ${interactive ? 3000 : 0},
        };

        process.on("message", async(message) => {
          if (message.type === "graceful-exit") {
            if (!extractedServer) {
              throw new Error("Server not found");
            }
            const { getDevServerDeinitCount } = require("bun:internal-for-testing")
            const before = getDevServerDeinitCount();
            if (!extractedServer.development) {
              extractedServer.stop(true);
              process.exit(0);
              return;
            }
            extractedServer.stop(true);
            extractedServer = null!;
            let attempts = 0;
            while (getDevServerDeinitCount() === before) {
              Bun.gc(true);
              await new Promise(resolve => setTimeout(resolve, 1));
              fullGC();
              attempts++;
              if (attempts > 100) {
                throw new Error("Failed to trigger deinit. Check with BUN_DEBUG_Server=1 and see why it does not free itself.");
              }
            }
            process.exit(0); 
          }
        });
      `,
    );

    using _ = {
      [Symbol.dispose]: () => {
        for (const proc of danglingProcesses) {
          proc.kill("SIGKILL");
        }
      },
    };

    await using devProcess = Bun.spawn({
      cwd: root,
      cmd: [process.execPath, "./harness_start.ts"],
      env: mergeWindowEnvs([
        bunEnv,
        {
          FORCE_COLOR: "1",
          BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
          BUN_DEV_SERVER_TEST_RUNNER: "1",
          BUN_DUMP_STATE_ON_CRASH: "1",
          NODE_ENV,
          // BUN_DEBUG_QUIET_LOGS: "0",
          // BUN_DEBUG_DEVSERVER: isDebugBuild && interactive ? "1" : undefined,
          // BUN_DEBUG_INCREMENTALGRAPH: isDebugBuild && interactive ? "1" : undefined,
          // BUN_DEBUG_WATCHER: isDebugBuild && interactive ? "1" : undefined,
          BUN_ASSUME_PERFECT_INCREMENTAL: "0",
        },
      ]),
      stdio: ["pipe", "pipe", "pipe"],
      onExit: (subprocess, exitCode, signalCode, error) => {
        danglingProcesses.delete(subprocess);
      },
      ipc(message, subprocess) {},
    });
    danglingProcesses.add(devProcess);
    if (interactive) {
      console.log("\x1b[35mDev Server PID: " + devProcess.pid + "\x1b[0m");
    }
    using stream = new OutputLineStream("dev", devProcess.stdout, devProcess.stderr);
    devProcess.exited.then(exitCode => (stream.exitCode = exitCode));
    const port = parseInt((await stream.waitForLine(/localhost:(\d+)/))[1], 10);
    const dev = new Dev(root, port, devProcess, stream, NODE_ENV, options);
    if (dev.nodeEnv === "development") {
      await dev.connectSocket();
    }
    if (isStressTest) {
      dev.stressTestEndurance = true;
    }

    await maybeWaitInteractive("start");

    try {
      await options.test(dev);
    } catch (err: any) {
      while (err instanceof SuppressedError) {
        logErr(err.suppressed);
        err = err.error;
      }
      if (interactive) {
        logErr(err);
        await maybeWaitInteractive("exit");
        process.exit(1);
      }
      logErr(err);
      console.log("\x1b[31mFailed\x1b[0;2m. Files in " + root + "\x1b[0m\r");
      throw "\r\x1b[K\x1b[A";
    }

    if (interactive) {
      console.log("\x1b[32mPASS\x1b[0m");
      await maybeWaitInteractive("exit");
      await dev.gracefulExit();
      process.exit(0);
    }

    await dev.gracefulExit();
  }

  try {
    if (options.skip && options.skip.some(x => skipTargets.includes(x))) {
      jest.test.todo(name, run);
      return options;
    }

    // asan makes everything slower
    const asanTimeoutMultiplier = isASAN ? 3 : 1;

    (options.only ? jest.test.only : jest.test)(
      name,
      run,
      isStressTest
        ? 11 * 60 * 1000
        : interactive
          ? interactive_timeout
          : (options.timeoutMultiplier ?? 1) *
            (isWindows ? 15_000 : 10_000) *
            (Bun.version.includes("debug") ? 2 : 1) *
            asanTimeoutMultiplier,
    );
    return options;
  } catch {
    // not in bun test. allow interactive use
    let arg = process.argv.slice(2).join(" ").trim();
    if (arg.startsWith("-t")) {
      arg = arg.slice(2).trim();
    }
    if (!arg) {
      const mainFile = Bun.$.escape(path.relative(process.cwd(), process.argv[1]));
      console.error("Options for running Dev Server tests:");
      console.error(" - automated:   bun test " + mainFile);
      console.error(" - interactive: bun " + mainFile + " [-t] <filter or number for test>");
      process.exit(1);
    }
    if (name.includes(arg)) {
      interactive = true;
      console.log("\x1b[32;1m" + name + " (Interactive)\x1b[0m");
      run();
      return options;
    }
  }
  return options;
}

function logErr(err: any) {
  console.error();
  if (err.stackLine) {
    console.error(`error\x1b[0;2m:\x1b[0m`, err.message);
    console.error(err.stackLine);
  } else {
    console.error(err);
  }
}

// Loosely modelled after the widget system in @paperclover/console
// Only works with a single log
let hasTrailingLog = false;
class TrailingLog {
  lines = 0;
  message = "";
  realConsole;

  constructor() {
    if (hasTrailingLog) throw new Error("Only one trailing log is allowed");
    hasTrailingLog = true;
    this.realConsole = {};
    console.log = this.#wrapLog("log");
    console.error = this.#wrapLog("error");
    console.warn = this.#wrapLog("warn");
    console.info = this.#wrapLog("info");
    console.debug = this.#wrapLog("debug");
  }

  #wrapLog(method: keyof Console) {
    const m: Function = (this.realConsole[method] = console[method]);
    return (...args: any[]) => {
      if (this.lines > 0) {
        process.stderr.write("\u001B[?2026h" + this.#clear());
        this.realConsole[method](...args);
        process.stderr.write(this.message + "\u001B[?2026l");
      } else {
        m.apply(console, args);
      }
    };
  }

  #clear() {
    return "\x1b[2K" + "\x1b[1A\x1b[2K".repeat(this.lines) + "\r";
  }

  [Symbol.dispose] = () => {
    if (this.lines > 0) {
      process.stderr.write(this.#clear());
    }
    hasTrailingLog = false;
    console.log = this.realConsole.log;
    console.error = this.realConsole.error;
    console.warn = this.realConsole.warn;
    console.info = this.realConsole.info;
    console.debug = this.realConsole.debug;
  };

  setMessage(message: string) {
    this.message = message.trim() + "\n";
    this.lines = this.message.split("\n").length - 1;
    process.stderr.write("\u001B[?2026h" + this.#clear() + this.message + "\u001B[?2026l");
  }
}

process.on("exit", () => {
  for (const proc of danglingProcesses) {
    proc.kill("SIGKILL");
  }
});

export function devTest<T extends DevServerTest>(description: string, options: T): T {
  // Capture the caller name as part of the test tempdir
  const callerLocation = snapshotCallerLocation();
  const caller = stackTraceFileName(callerLocation);
  assert(
    caller.startsWith(devTestRoot) || caller.includes("dev-and-prod"),
    "dev server tests must be in test/bake/dev, not " + caller,
  );

  return testImpl(description, options, "development", caller);
}

devTest.only = function (description: string, options: DevServerTest) {
  // Capture the caller name as part of the test tempdir
  const callerLocation = snapshotCallerLocation();
  const caller = stackTraceFileName(callerLocation);
  assert(
    caller.startsWith(devTestRoot) || caller.includes("dev-and-prod"),
    "dev server tests must be in test/bake/dev, not " + caller,
  );
  return testImpl(description, { ...options, only: true }, "development", caller);
};

export function prodTest<T extends DevServerTest>(description: string, options: T): T {
  const callerLocation = snapshotCallerLocation();
  const caller = stackTraceFileName(callerLocation);
  assert(
    caller.startsWith(prodTestRoot) || caller.includes("dev-and-prod"),
    "prod server tests must be in test/bake/prod, not " + caller,
  );

  return testImpl(description, options, "production", caller);
}

export function devAndProductionTest(description: string, options: DevServerTest) {
  const callerLocation = snapshotCallerLocation();
  const caller = stackTraceFileName(callerLocation);
  assert(
    caller.includes("dev-and-prod"),
    'dev+prod tests should be in "test/bake/dev-and-prod.test.ts", not ' + caller,
  );

  testImpl(description, options, "development", caller);
  testImpl(description, options, "production", caller);
  return options;
}
