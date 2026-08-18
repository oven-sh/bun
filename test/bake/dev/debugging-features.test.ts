// DevServer debugging features (canary and debug builds): the visualizer pages under `/_bun/`, the incremental graph feed behind them, and the `.bake-debug` source dumps.
import { describe, expect } from "bun:test";
import { isDebug } from "harness";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { Dev, devTest, emptyHtmlFile, minimalFramework, WAIT_MULTIPLIER } from "../bake-harness";

// `feature_flags::BAKE_DEBUGGING_FEATURES` is `IS_CANARY || IS_DEBUG`.
const hasBakeDebuggingFeatures = isDebug || Bun.version_with_sha.includes("-canary.");

interface VisualizerFile {
  name: string;
  isStale: boolean;
  isServer: boolean;
  isSSR: boolean;
  isRoute: boolean;
  isFramework: boolean;
  isBoundary: boolean;
}

interface VisualizerGraph {
  client: (VisualizerFile | { deleted: true })[];
  server: (VisualizerFile | { deleted: true })[];
  /** `[importer, imported]` pairs, by file name. */
  clientEdges: [string, string][];
  serverEdges: [string, string][];
}

/** Decodes a `v` (MessageId.visualizer) frame the way `incremental_visualizer.html` does. */
function decodeVisualizerFrame(buffer: Uint8Array): VisualizerGraph {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 1; // MessageId byte
  const u32 = () => {
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  };
  const files = () => {
    const count = u32();
    const list: VisualizerGraph["client"] = [];
    for (let i = 0; i < count; i++) {
      const nameLength = u32();
      if (nameLength === 0) {
        list.push({ deleted: true });
        continue;
      }
      const name = new TextDecoder().decode(buffer.subarray(offset, offset + nameLength));
      offset += nameLength;
      list.push({
        name,
        isStale: buffer[offset++] === 1,
        isServer: buffer[offset++] === 1,
        isSSR: buffer[offset++] === 1,
        isRoute: buffer[offset++] === 1,
        isFramework: buffer[offset++] === 1,
        isBoundary: buffer[offset++] === 1,
      });
    }
    return list;
  };
  const fileName = (list: VisualizerGraph["client"], index: number) => {
    const file = list[index];
    if (file === undefined || "deleted" in file)
      throw new Error(`edge references file #${index}, which does not exist`);
    return file.name;
  };
  const edges = (list: VisualizerGraph["client"]) => {
    const count = u32();
    const pairs: [string, string][] = [];
    for (let i = 0; i < count; i++) {
      const dependency = u32();
      const imported = u32();
      pairs.push([fileName(list, dependency), fileName(list, imported)]);
    }
    return pairs;
  };
  const client = files();
  const server = files();
  const clientEdges = edges(client);
  const serverEdges = edges(server);
  if (offset !== buffer.byteLength) {
    throw new Error(`visualizer frame has ${buffer.byteLength - offset} trailing bytes`);
  }
  // Files and edges come in the graph's internal slot order; sort so the assertions do not depend on it.
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const byName = (a: VisualizerGraph["client"][number], b: VisualizerGraph["client"][number]) =>
    compare("name" in a ? a.name : "", "name" in b ? b.name : "");
  const byPair = (a: [string, string], b: [string, string]) => compare(a.join("\0"), b.join("\0"));
  return {
    client: client.sort(byName),
    server: server.sort(byName),
    clientEdges: clientEdges.sort(byPair),
    serverEdges: serverEdges.sort(byPair),
  };
}

function file(name: string, flags: Partial<VisualizerFile> = {}): VisualizerFile {
  return {
    name,
    isStale: false,
    isServer: false,
    isSSR: false,
    isRoute: false,
    isFramework: false,
    isBoundary: false,
    ...flags,
  };
}

/** Opens a second `/_bun/hmr` socket that decodes `v` frames, exactly like the page at `/_bun/incremental_visualizer` does. */
async function subscribeIncrementalVisualizer(dev: Dev) {
  const ws = new WebSocket(dev.baseUrl + "/_bun/hmr");
  ws.binaryType = "arraybuffer";
  // Frames are buffered as they arrive; each `waitForFrame` consumes from `cursor`.
  const frames: VisualizerGraph[] = [];
  let cursor = 0;
  let failure: Error | null = null;
  // Called whenever a frame arrives or the socket fails; set by whoever is waiting.
  let onProgress = () => {};
  const fail = (reason: string) => {
    failure ??= new Error(`${reason} (received ${frames.length} visualizer frames)`);
    onProgress();
  };
  ws.onerror = () => fail("hmr socket errored");
  ws.onclose = event => fail(`hmr socket closed with code ${event.code}`);
  ws.onmessage = event => {
    const data = new Uint8Array(event.data as ArrayBuffer);
    if (data[0] !== "v".charCodeAt(0)) return;
    try {
      frames.push(decodeVisualizerFrame(data));
    } catch (err) {
      fail(String(err));
      return;
    }
    onProgress();
  };

  const opened = Promise.withResolvers<void>();
  ws.onopen = () => opened.resolve();
  onProgress = () => {
    if (failure) opened.reject(failure);
  };
  await opened.promise;

  return {
    subscribe() {
      ws.send("sv");
    },
    /** Resolves with the next frame (after the one the previous wait returned) that satisfies `matches`. */
    waitForFrame(what: string, matches: (graph: VisualizerGraph) => boolean) {
      return new Promise<VisualizerGraph>((resolve, reject) => {
        const deadline = setTimeout(() => fail(`timed out waiting for ${what}`), 10_000 * WAIT_MULTIPLIER);
        const settle = () => {
          clearTimeout(deadline);
          onProgress = () => {};
        };
        onProgress = () => {
          if (failure) {
            settle();
            reject(failure);
            return;
          }
          while (cursor < frames.length) {
            const frame = frames[cursor++];
            if (matches(frame)) {
              settle();
              resolve(frame);
              return;
            }
          }
        };
        onProgress();
      });
    },
    [Symbol.dispose]() {
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
    },
  };
}

describe.skipIf(!hasBakeDebuggingFeatures)("visualizers", () => {
  devTest("the visualizer pages are served under /_bun/", {
    files: {
      // A single HTML file is mounted at `/*`, so the pages must win over the app's catch-all.
      "index.html": emptyHtmlFile({}),
    },
    async test(dev) {
      // The pages are served verbatim from the source tree (embedded at build time in release builds).
      const visualizerHtml = path.join(import.meta.dir, "../../../src/runtime/bake");
      for (const name of ["incremental_visualizer", "memory_visualizer"]) {
        const response = await dev.fetch(`/_bun/${name}`);
        expect({ status: response.status, contentType: response.headers.get("content-type") }).toStrictEqual({
          status: 200,
          contentType: "text/html;charset=utf-8",
        });
        expect(await response.text()).toBe(readFileSync(path.join(visualizerHtml, `${name}.html`), "utf8"));
      }

      for (const [shortcut, target] of [
        ["iv", "incremental_visualizer"],
        ["mv", "memory_visualizer"],
      ]) {
        const response = await dev.fetch(`/_bun/${shortcut}`, { redirect: "manual" });
        expect({ status: response.status, location: response.headers.get("location") }).toStrictEqual({
          status: 302,
          location: `/_bun/${target}`,
        });
      }
    },
  });

  devTest("subscribing to the incremental visualizer topic streams the incremental graph", {
    files: {
      "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
      "index.ts": `
        import { value } from "./dep";
        console.log(value);
      `,
      "dep.ts": `export const value = "dep";`,
      "extra.ts": `export const extra = "extra";`,
    },
    async test(dev) {
      using visualizer = await subscribeIncrementalVisualizer(dev);
      visualizer.subscribe();

      // Subscribing answers with the current graph right away; nothing has been requested yet.
      expect(await visualizer.waitForFrame("the frame sent on subscribe", () => true)).toStrictEqual({
        client: [],
        server: [],
        clientEdges: [],
        serverEdges: [],
      });

      // Every finished bundle publishes the graph it produced.
      await dev.fetch("/").expect.toInclude("<script");
      const bundled = await visualizer.waitForFrame("the frame published after bundling /", graph =>
        graph.client.some(file => "name" in file && file.name === "dep.ts"),
      );
      expect(bundled).toStrictEqual({
        client: [file("dep.ts"), file("index.html", { isRoute: true }), file("index.ts")],
        server: [],
        clientEdges: [
          ["index.html", "index.ts"],
          ["index.ts", "dep.ts"],
        ],
        serverEdges: [],
      });

      await dev.write(
        "index.ts",
        `
          import { extra } from "./extra";
          console.log(extra);
        `,
      );
      const updated = await visualizer.waitForFrame("the frame published after the hot update", graph =>
        graph.client.some(file => "name" in file && file.name === "extra.ts"),
      );
      // dep.ts stays in the graph without importers; only its edge is gone.
      expect(updated).toStrictEqual({
        client: [file("dep.ts"), file("extra.ts"), file("index.html", { isRoute: true }), file("index.ts")],
        server: [],
        clientEdges: [
          ["index.html", "index.ts"],
          ["index.ts", "extra.ts"],
        ],
        serverEdges: [],
      });

      await dev.delete("dep.ts");
      const deleted = await visualizer.waitForFrame("the frame published after deleting dep.ts", graph =>
        graph.client.some(file => "name" in file && file.name === "dep.ts" && file.isStale),
      );
      expect(deleted.client).toStrictEqual([
        file("dep.ts", { isStale: true }),
        file("extra.ts"),
        file("index.html", { isRoute: true }),
        file("index.ts"),
      ]);
    },
  });

  devTest("the incremental visualizer frame covers the server graph", {
    framework: minimalFramework,
    files: {
      "routes/index.ts": `
        import { marker } from "../components/Comp";
        export default function (req, meta) {
          return new Response("page: " + typeof marker);
        }
      `,
      "components/Comp.ts": `
        "use client";
        export const marker = "client";
      `,
    },
    async test(dev) {
      // Paths are sent relative to the project root, so the framework's entry point shows up as a `../` path.
      const frameworkEntry = path
        .relative(dev.rootDir, realpathSync(minimalFramework.fileSystemRouterTypes[0].serverEntryPoint!))
        .replaceAll(path.sep, "/");
      expect(frameworkEntry.startsWith("../")).toBe(true);

      using visualizer = await subscribeIncrementalVisualizer(dev);
      visualizer.subscribe();

      // Scanning the routes at startup registers the route files and the framework entry point as stale server files.
      const serverFlags = { isServer: true };
      expect(await visualizer.waitForFrame("the frame sent on subscribe", () => true)).toStrictEqual({
        client: [],
        server: [
          file(frameworkEntry, { ...serverFlags, isRoute: true, isStale: true }),
          file("routes/index.ts", { ...serverFlags, isRoute: true, isStale: true }),
        ],
        clientEdges: [],
        serverEdges: [],
      });

      // A "use client" component is a boundary in the server graph and an HMR root (same flag byte) in the client graph; its stub imports the framework entry point.
      await dev.fetch("/").expect.toInclude("page: ");
      const bundled = await visualizer.waitForFrame("the frame published after bundling /", graph =>
        graph.server.some(file => "name" in file && file.name === "components/Comp.ts"),
      );
      expect(bundled).toStrictEqual({
        client: [file("components/Comp.ts", { isBoundary: true })],
        server: [
          file(frameworkEntry, { ...serverFlags, isRoute: true }),
          file("components/Comp.ts", { ...serverFlags, isBoundary: true }),
          file("routes/index.ts", { ...serverFlags, isRoute: true }),
        ],
        clientEdges: [],
        serverEdges: [
          ["components/Comp.ts", frameworkEntry],
          ["routes/index.ts", "components/Comp.ts"],
        ],
      });

      // Demoting the boundary deletes the component from the client graph; a deleted file keeps its slot and is sent as an empty name.
      await dev.write("components/Comp.ts", `export const marker = "server";`);
      const demoted = await visualizer.waitForFrame("the frame published after demoting Comp.ts", graph =>
        graph.client.some(file => "deleted" in file),
      );
      expect(demoted).toStrictEqual({
        client: [{ deleted: true }],
        server: [
          file(frameworkEntry, { ...serverFlags, isRoute: true }),
          file("components/Comp.ts", serverFlags),
          file("routes/index.ts", { ...serverFlags, isRoute: true }),
        ],
        clientEdges: [],
        serverEdges: [["routes/index.ts", "components/Comp.ts"]],
      });
    },
  });
});

// The dev server is spawned with the project root as its cwd, which is where `.bake-debug` is created.
function readDump(dev: Dev, file: string) {
  return readFileSync(path.join(dev.rootDir, ".bake-debug", file), "utf8");
}

/** Asserts the two comment lines every non-source-map dump starts with and returns what follows them. */
function stripDumpHeader(dump: string, fileName: string, graph: "client" | "server") {
  const header = dump.match(/^\/\/ (".*") bundled for (\w+)\n\/\/ Bundled at \d+, Bun (\S+)\n/);
  // The dump's version suffix (`-canary.1`) and Bun.version's (`-debug`) differ; compare the numeric part.
  expect(header && { fileName: header[1], graph: header[2], version: header[3].split("-")[0] }).toStrictEqual({
    fileName: `"${fileName}"`,
    graph,
    version: Bun.version.split("-")[0],
  });
  return dump.slice(header![0].length);
}

describe.skipIf(!hasBakeDebuggingFeatures)(".bake-debug dumps", () => {
  devTest("client bundles are dumped to .bake-debug", {
    env: { BUN_BAKE_DUMP_SOURCES: "1" },
    files: {
      "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
      "index.ts": `
        import { value } from "./dep";
        console.log("index says", value);
      `,
      "dep.ts": `export const value = "dump me";`,
    },
    async test(dev) {
      const dumpDir = path.join(dev.rootDir, ".bake-debug");
      // Created when the dev server starts; populated as things get bundled.
      expect({ dumpDir: existsSync(dumpDir), client: existsSync(path.join(dumpDir, "client")) }).toStrictEqual({
        dumpDir: true,
        client: false,
      });

      const html = await dev.fetch("/").text();

      // Every module is written as it is bundled, wrapped so that the file parses on its own.
      const dep = stripDumpHeader(readDump(dev, "client/dep.ts"), "dep.ts", "client");
      expect(dep).toMatch(/^\(\{\n[^]*"dump me"[^]*\}\);\n$/);
      stripDumpHeader(readDump(dev, "client/index.ts"), "index.ts", "client");

      // The chunk and the source map handed to the browser are dumped as the latest ones, byte for byte.
      const scriptUrl = html.match(/src="([^"]+\.js)"/)![1];
      const script = await dev.fetch(scriptUrl).text();
      expect(stripDumpHeader(readDump(dev, "client/latest_chunk.js"), "latest_chunk.js", "client")).toBe(script);

      const sourceMapUrl = script.match(/\n\/\/# sourceMappingURL=(\S+)/)![1];
      const sourceMap = await dev.fetch(sourceMapUrl).text();
      expect(readDump(dev, "client/latest_chunk.js.map")).toBe(sourceMap);
    },
  });

  devTest("server bundles are dumped to .bake-debug", {
    env: { BUN_BAKE_DUMP_SOURCES: "1" },
    framework: minimalFramework,
    files: {
      "db.ts": `export const abc = "server dump";`,
      "routes/index.ts": `
        import { abc } from "../db";
        export default function (req, meta) {
          return new Response(abc);
        }
      `,
    },
    async test(dev) {
      await dev.fetch("/").equals("server dump");

      expect(stripDumpHeader(readDump(dev, "server/db.ts"), "db.ts", "server")).toMatch(
        /^\(\{\n[^]*"server dump"[^]*\}\);\n$/,
      );
      expect(readDump(dev, path.join("server", "routes", "index.ts"))).toContain(" bundled for server\n");

      // Files outside the project root keep their relative path, with each `..` made into a directory name.
      const frameworkEntry = realpathSync(minimalFramework.fileSystemRouterTypes[0].serverEntryPoint!);
      const escaped = path.relative(dev.rootDir, frameworkEntry).replaceAll(".." + path.sep, "_.._" + path.sep);
      expect(escaped.startsWith("_.._" + path.sep)).toBe(true);
      expect(readDump(dev, path.join("server", escaped))).toContain(" bundled for server\n");

      // The server chunk only ever lives in the server VM; the dump is the only way to read it.
      const chunk = stripDumpHeader(readDump(dev, "server/latest_hmr.js"), "latest_hmr.js", "server");
      expect(chunk).toContain("server dump");
      const sourceMap = JSON.parse(readDump(dev, "server/latest_hmr.js.map"));
      expect(sourceMap.sources).toContain(dev.join("db.ts"));
    },
  });
});
