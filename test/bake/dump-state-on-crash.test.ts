// BUN_DUMP_STATE_ON_CRASH=1 (bake-harness.ts sets it for every dev server it
// spawns) makes a crashing DevServer write its incremental graph to
// `incremental-graph-crash-dump.<timestamp>.html` in the working directory: a
// self-contained copy of `src/runtime/bake/incremental_visualizer.html`.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// DevServer debugging features only exist in canary and debug builds
// (`bun_core::feature_flags::BAKE_DEBUGGING_FEATURES`). Canary builds report
// themselves as e.g. "v1.4.0-canary.1 (b7a04310)".
const hasBakeDebuggingFeatures = isDebug || Bun.version_with_sha.includes("-canary.");

// Enough files, with long enough names, that the serialized graph is several
// KiB and its base64 is written to the dump in more than one chunk.
const padding = Buffer.alloc(40, "x").toString();
const leaves = Array.from({ length: 48 }, (_, i) => `modules/leaf-${String(i).padStart(2, "0")}-${padding}.ts`);

const fixture = {
  "index.html": `<!DOCTYPE html><html><head><script type="module" src="./entry.ts"></script></head><body></body></html>`,
  "entry.ts":
    leaves.map((leaf, i) => `import { v as v${i} } from "./${leaf}";`).join("\n") +
    `\nconsole.log(${leaves.map((_, i) => `v${i}`).join(" + ")});\n`,
  ...Object.fromEntries(leaves.map((leaf, i) => [leaf, `export const v = ${i};\n`])),
  "fixture.ts": `
    import { crash_handler, getDevServerDeinitCount } from "bun:internal-for-testing";
    import html from "./index.html";

    const mode = process.argv[2];
    const deinitsBefore = getDevServerDeinitCount();
    let server: ReturnType<typeof Bun.serve> | null = Bun.serve({
      port: 0,
      development: true,
      routes: { "/": html },
    });

    // Bundling the route is what populates the incremental graph.
    const response = await fetch(server.url);
    if (response.status !== 200) throw new Error("unexpected status " + response.status);
    await response.text();

    if (mode === "after-deinit") {
      server.stop(true);
      server = null;
      for (let attempts = 0; getDevServerDeinitCount() === deinitsBefore; attempts++) {
        if (attempts > 200) throw new Error("DevServer was not deinitialized");
        Bun.gc(true);
        await Bun.sleep(10);
      }
    } else if (mode === "two-servers") {
      // A second DevServer that never bundled anything, so its dump is
      // distinguishable from the first one's.
      Bun.serve({ port: 0, development: true, routes: { "/": html } });
    }

    if (mode === "rust-panic") {
      crash_handler.rustPanic();
    } else {
      crash_handler.panic();
    }
    throw new Error("unreachable: the crash handler returned");
  `,
};

// The second and later dumps written in the same second get a counter suffix.
const dumpFileName = /^incremental-graph-crash-dump\.\d+(\.\d+)?\.html$/;

async function crash(
  mode: "crash-handler" | "rust-panic" | "after-deinit" | "two-servers",
  dumpStateOnCrash: "0" | "1",
) {
  using dir = tempDir("dump-state-on-crash", fixture);
  await using proc = Bun.spawn({
    // The flag makes debug builds print the trace string instead of spawning a symbolizer.
    cmd: [bunExe(), "fixture.ts", mode, "--debug-crash-handler-use-trace-string"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_DUMP_STATE_ON_CRASH: dumpStateOnCrash,
      // These crashes are deliberate; never report them.
      BUN_CRASH_REPORT_URL: "",
      BUN_ENABLE_CRASH_REPORTING: "0",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toContain(
    mode === "rust-panic" ? "invoked crashByRustPanic() handler" : "invoked crashByPanic() handler",
  );
  expect(exitCode).not.toBe(0);

  const dumps = readdirSync(String(dir)).filter(name => dumpFileName.test(name));
  return {
    stderr,
    dumps,
    contents: dumps.map(name => readFileSync(join(String(dir), name), "utf8")),
  };
}

interface DumpedFile {
  name: string;
  stale: boolean;
  route: boolean;
}

type Edge = [dependency: number, imported: number];

/** Reads the payload the way the `decodeAndUpdate` function in incremental_visualizer.html does. */
function decodeDump(html: string) {
  const inlined = /\nlet inlinedData = Uint8Array\.from\(atob\("([^"]*)"\), c => c\.charCodeAt\(0\)\);\n/.exec(html);
  if (!inlined) throw new Error("the dump does not inline a graph payload");
  // Like the browser, `atob` rejects base64 with padding in the middle of the string.
  const bytes = Uint8Array.from(atob(inlined[1]), c => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  let offset = 1;
  const u32 = () => {
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  };
  const readFiles = () => {
    const count = u32();
    const files: (DumpedFile | null)[] = [];
    for (let i = 0; i < count; i++) {
      const nameLength = u32();
      if (nameLength === 0) {
        files.push(null); // deleted file
        continue;
      }
      const name = new TextDecoder().decode(bytes.subarray(offset, offset + nameLength));
      offset += nameLength;
      // stale, server (rsc), ssr, route, framework, boundary
      const [stale, , , route] = bytes.subarray(offset, offset + 6);
      offset += 6;
      files.push({ name, stale: stale === 1, route: route === 1 });
    }
    return files;
  };
  const readEdges = () => {
    const count = u32();
    const edges: Edge[] = [];
    for (let i = 0; i < count; i++) edges.push([u32(), u32()]);
    return edges;
  };

  expect(bytes[0]).toBe("v".charCodeAt(0));
  const clientFiles = readFiles();
  const serverFiles = readFiles();
  const clientEdges = readEdges();
  const serverEdges = readEdges();
  expect(offset).toBe(bytes.length);
  return {
    client: { files: clientFiles, edges: clientEdges },
    server: { files: serverFiles, edges: serverEdges },
  };
}

const byIndex = (a: Edge, b: Edge) => a[0] - b[0] || a[1] - b[1];

function expectDumpToDescribeTheFixture(html: string) {
  expect(html).toStartWith("<!doctype html>");
  expect(html).toContain("<title>IncrementalGraph Visualization</title>");
  expect(html.trimEnd()).toEndWith("</html>");

  const { client, server } = decodeDump(html);
  expect(server).toEqual({ files: [], edges: [] });

  // Names are relative to the DevServer root.
  const fileIndex = (relativePath: string) => {
    const index = client.files.findIndex(
      file => file?.name === relativePath || file?.name.endsWith("/" + relativePath),
    );
    if (index === -1) throw new Error(`${relativePath} is missing from the dump`);
    return index;
  };
  const flags = (relativePath: string) => {
    const { stale, route } = client.files[fileIndex(relativePath)]!;
    return { stale, route };
  };

  expect(flags("index.html")).toEqual({ stale: false, route: true });
  expect(flags("entry.ts")).toEqual({ stale: false, route: false });
  expect(leaves.map(flags)).toEqual(leaves.map(() => ({ stale: false, route: false })));

  const entry = fileIndex("entry.ts");
  const expectedEdges: Edge[] = [
    [fileIndex("index.html"), entry],
    ...leaves.map((leaf): Edge => [entry, fileIndex(leaf)]),
  ];
  expect(client.edges.sort(byIndex)).toEqual(expectedEdges.sort(byIndex));
}

// Not concurrent: in debug builds each child spends about two seconds just
// loading bun:internal-for-testing, and running these side by side made each
// of them take over four seconds, close to the default per-test timeout.
describe.skipIf(!hasBakeDebuggingFeatures)("BUN_DUMP_STATE_ON_CRASH", () => {
  test("dumps the incremental graph when the crash goes through the crash handler", async () => {
    const { stderr, dumps, contents } = await crash("crash-handler", "1");
    expect(dumps).toHaveLength(1);
    expect(stderr).toContain(`Dumped incremental bundler graph to "${dumps[0]}"`);
    expectDumpToDescribeTheFixture(contents[0]);
  });

  test("dumps the incremental graph when the crash is a Rust panic", async () => {
    const { stderr, dumps, contents } = await crash("rust-panic", "1");
    expect(dumps).toHaveLength(1);
    expect(stderr).toContain(`Dumped incremental bundler graph to "${dumps[0]}"`);
    expectDumpToDescribeTheFixture(contents[0]);
  });

  test("every DevServer in the process gets its own dump", async () => {
    const { stderr, dumps, contents } = await crash("two-servers", "1");
    expect(dumps).toHaveLength(2);
    for (const dump of dumps) {
      expect(stderr).toContain(`Dumped incremental bundler graph to "${dump}"`);
    }
    const [bundled, untouched] = contents.sort(
      (a, b) => decodeDump(b).client.files.length - decodeDump(a).client.files.length,
    );
    expectDumpToDescribeTheFixture(bundled);
    expect(decodeDump(untouched)).toEqual({ client: { files: [], edges: [] }, server: { files: [], edges: [] } });
  });

  test("does nothing unless the variable is set", async () => {
    const { stderr, dumps } = await crash("crash-handler", "0");
    expect(stderr).not.toContain("Dumped incremental bundler graph");
    expect(dumps).toEqual([]);
  });

  test("does not dump a DevServer that was already freed", async () => {
    const { stderr, dumps } = await crash("after-deinit", "1");
    expect(stderr).not.toContain("Dumped incremental bundler graph");
    expect(dumps).toEqual([]);
  });
});
