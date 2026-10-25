// Source maps are non-trivial to test because the tests shouldn't rely on any
// hardcodings of the generated line/column numbers. Hardcoding wouldn't even
// work because hmr-runtime is minified in release builds, which would affect
// the generated line/column numbers across different build configurations.
import { expect } from "bun:test";
import { BasicSourceMapConsumer, IndexedSourceMapConsumer, SourceMapConsumer } from "source-map";
import { Dev, devTest, emptyHtmlFile } from "../bake-harness";

devTest("source map emitted for primary chunk", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import other from "./❤️.js";
      console.log("Hello, " + other + "!");
    `,
    "❤️.ts": `
      // hello
      export default "♠️";
    `,
  },
  async test(dev) {
    const html = await dev.fetch("/").text();
    using sourceMap = await extractSourceMapHtml(dev, html);
    expect(sourceMap.sources.slice(1).map(Bun.fileURLToPath)) //
      .toEqual([dev.join("index.html"), dev.join("index.ts"), dev.join("❤️.ts")]);

    const generated = indexOfLineColumn(sourceMap.script, "♠️");
    const original = sourceMap.originalPositionFor(generated);
    expect(original).toEqual({
      source: sourceMap.sources[3],
      name: null,
      line: 2,
      column: "export default ".length,
    });
  },
});
devTest("source map emitted for hmr chunk", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import other from "./App";
      console.log("Hello, " + other + "!");
      import.meta.hot.accept();
    `,
    "App.tsx": `
      console.log("some text here");
      export default "world";
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", { storeHotChunks: true });
    await dev.write("App.tsx", "// yay\nconsole.log('magic');\nimport.meta.hot.accept();");
    const chunk = await c.getMostRecentHmrChunk();
    using sourceMap = await extractSourceMap(dev, chunk);
    expect(sourceMap.sources.slice(1).map(Bun.fileURLToPath)) //
      .toEqual([dev.join("App.tsx")]);
    const generated = indexOfLineColumn(sourceMap.script, "magic");
    const original = sourceMap.originalPositionFor(generated);
    expect(original).toEqual({
      source: sourceMap.sources[1],
      name: null,
      line: 2,
      column: "console.log(".length,
    });
    await c.expectMessage("some text here", "Hello, world!", "magic");
  },
});
devTest("browser error report is remapped through the primary chunk's source map", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { thrower } from "./thrower";
      function caller() {
        thrower("caller-marker");
      }
      caller("top-level-marker");
    `,
    "thrower.ts": `
      // one
      // two
      // three
      export function thrower(text: string) {
        throw new Error("thrower-marker" + text);
      }
      // seven
    `,
  },
  async test(dev) {
    const { scriptUrl, frameAt } = await fetchClientScript(dev, "/");
    const runtimeFrames = [
      { fn: "runtimeFirstLine", file: scriptUrl, line: 1, col: 1 },
      { fn: "runtimeSecondLine", file: scriptUrl, line: 2, col: 1 },
    ];

    expect(
      await reportError(dev, "remapped-report-message", [
        frameAt("thrower", `new Error("thrower-marker"`),
        runtimeFrames[0],
        frameAt("caller", `thrower("caller-marker")`),
        // A browser names a module's top-level function after its key in the bundle.
        frameAt("index.ts", `caller("top-level-marker")`),
        ...runtimeFrames,
      ]),
    ).toEqual({
      frames: [
        { fn: "thrower", file: "thrower.ts", line: 5, col: "  throw ".length + 1 },
        { fn: "caller", file: "index.ts", line: 3, col: "  ".length + 1 },
        { fn: "", file: "index.ts", line: 5, col: 1 },
      ],
      code: {
        lineOfInterest: 2,
        firstLine: 3,
        column: "  throw ".length + 1,
        lines: [
          "// three",
          "export function thrower(text: string) {",
          `  throw new Error("thrower-marker" + text);`,
          "}",
          "// seven",
        ],
      },
    });
    expect(await printedReport(dev, "remapped-report-message")).toEqual([
      `      at thrower (${dev.join("thrower.ts")}:5:9)`,
      `      at caller (${dev.join("index.ts")}:3:3)`,
      `      at ${dev.join("index.ts")}:5:1`,
    ]);

    // The excerpt spans the whole file, from its first line to its last.
    expect(await reportError(dev, "whole-file-message", [frameAt("caller", `thrower("caller-marker")`)])).toEqual({
      frames: [{ fn: "caller", file: "index.ts", line: 3, col: "  ".length + 1 }],
      code: {
        lineOfInterest: 2,
        firstLine: 1,
        column: "  ".length + 1,
        lines: [
          `import { thrower } from "./thrower";`,
          "function caller() {",
          `  thrower("caller-marker");`,
          "}",
          `caller("top-level-marker");`,
        ],
      },
    });

    // A trace made of nothing but runtime frames keeps them.
    expect(await reportError(dev, "runtime-only-message", runtimeFrames)).toEqual({
      frames: runtimeFrames.map(({ fn }) => ({ fn, file: "Bun HMR Runtime", line: 0, col: 0 })),
      code: null,
    });
  },
});
devTest("browser error report is remapped for every html route", {
  files: {
    "first.html": emptyHtmlFile({
      scripts: ["first.ts"],
    }),
    "first.ts": `
      // first
      console.log("first-marker");
    `,
    "second.html": emptyHtmlFile({
      scripts: ["second.ts"],
    }),
    "second.ts": `
      // second
      //
      console.log("second-marker");
    `,
  },
  async test(dev) {
    const first = await fetchClientScript(dev, "/first");
    const second = await fetchClientScript(dev, "/second");
    const { frames } = await reportError(dev, "two-routes-message", [
      first.frameAt("first.ts", `log("first-marker")`),
      second.frameAt("second.ts", `log("second-marker")`),
    ]);
    expect(frames).toEqual([
      { fn: "", file: "first.ts", line: 2, col: "console.".length + 1 },
      { fn: "", file: "second.ts", line: 3, col: "console.".length + 1 },
    ]);
  },
});
devTest("browser error report is remapped through an hmr chunk's source map", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import "./App";
      import.meta.hot.accept();
    `,
    "App.tsx": `
      console.log("some text here");
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", { storeHotChunks: true });
    await dev.write("App.tsx", "// yay\nconsole.log('magic');\nimport.meta.hot.accept();");
    const chunk = await c.getMostRecentHmrChunk();
    // `remapFileName` in stack-trace.ts gives a frame of a hot chunk this URL.
    const id = chunk.match(/\n\/\/# sourceMappingURL=\/_bun\/client\/([0-9a-f]+)\.js\.map/)![1];
    const file = `${dev.baseUrl}/_bun/client/hmr-${id}.js`;
    const { line, column } = indexOfLineColumn(chunk, `log("magic")`);

    expect(
      await reportError(dev, "hmr-report-message", [
        { fn: "App.tsx", file, line, col: column + 1 },
        { fn: "chunkPrefix", file, line: 1, col: 1 },
      ]),
    ).toEqual({
      frames: [{ fn: "", file: "App.tsx", line: 2, col: "console.".length + 1 }],
      code: {
        lineOfInterest: 1,
        firstLine: 1,
        column: "console.".length + 1,
        lines: ["// yay", "console.log('magic');", "import.meta.hot.accept();"],
      },
    });
    await c.expectMessage("some text here", "magic");
  },
});

type SourceMap = (BasicSourceMapConsumer | IndexedSourceMapConsumer) & {
  /** Original script generated */
  script: string;
  [Symbol.dispose](): void;
};

async function extractSourceMapHtml(dev: Dev, html: string) {
  const scriptUrls = [...html.matchAll(/src="([^"]+.js)"/g)];
  if (scriptUrls.length !== 1) {
    throw new Error("Expected 1 source file, got " + scriptUrls.length);
  }
  const scriptUrl = scriptUrls[0][1];
  const scriptSource = await dev.fetch(scriptUrl).text();
  return extractSourceMap(dev, scriptSource);
}

async function extractSourceMap(dev: Dev, scriptSource: string) {
  const sourceMapUrl = scriptSource.match(/\n\/\/# sourceMappingURL=([^"]+)/);
  if (!sourceMapUrl) {
    throw new Error("Source map URL not found in " + scriptSource);
  }
  const sourceMap = await dev.fetch(sourceMapUrl[1]).text();
  if (!sourceMap.startsWith("{")) {
    throw new Error("Source map is not valid JSON: " + sourceMap);
  }
  console.log(sourceMap);
  return new Promise<SourceMap>((resolve, reject) => {
    try {
      SourceMapConsumer.with(sourceMap, null, async (consumer: any) => {
        const { promise, resolve: release } = Promise.withResolvers();
        consumer[Symbol.dispose] = () => release();
        consumer.script = scriptSource;
        resolve(consumer as SourceMap);
        await promise;
      });
    } catch (error) {
      reject(error);
    }
  });
}

function indexOfLineColumn(text: string, search: string) {
  const index = text.indexOf(search);
  if (index === -1) {
    throw new Error("Search not found");
  }
  return charOffsetToLineColumn(text, index);
}

function charOffsetToLineColumn(text: string, offset: number) {
  // sourcemap lines are 0-based.
  // > If present, the **zero-based** starting line in the original source. This
  // > field contains a base64 VLQ relative to the previous occurrence of this
  // > field, unless it is the first occurrence of this field, in which case the
  // > whole value is represented. Shall be present if there is a source field.
  let line = 0;
  let i = 0;
  let prevI = 0;
  while (i < offset) {
    const nextIndex = text.indexOf("\n", i);
    if (nextIndex === -1) {
      break;
    }
    prevI = i;
    i = nextIndex + 1;
    line++;
  }
  return { line: line, column: offset - prevI };
}

type ReportFrame = { fn: string; file: string; line: number; col: number };

/** The URL of an html route's client script, and a way to point a report's frame into that script. */
async function fetchClientScript(dev: Dev, route: string) {
  const html = await dev.fetch(route).text();
  const scriptUrl = dev.baseUrl + html.match(/src="([^"]+.js)"/)![1];
  const script = await dev.fetch(scriptUrl).text();
  return {
    scriptUrl,
    frameAt(fn: string, search: string): ReportFrame {
      const { line, column } = indexOfLineColumn(script, search);
      return { fn, file: scriptUrl, line, col: column + 1 };
    },
  };
}

/** Posts what `onRuntimeError` in overlay.ts posts, and decodes the reply the way it does. */
async function reportError(dev: Dev, message: string, frames: ReportFrame[]) {
  const i32 = (n: number) => {
    const b = Buffer.alloc(4);
    b.writeInt32LE(n);
    return b;
  };
  const str32 = (s: string) => Buffer.concat([i32(Buffer.byteLength(s)), Buffer.from(s)]);
  const res = await dev.fetch("/_bun/report_error", {
    method: "POST",
    body: Buffer.concat([
      str32("Error"),
      str32(message),
      str32(dev.baseUrl + "/"),
      i32(frames.length),
      ...frames.flatMap(f => [i32(f.line), i32(f.col), str32(f.fn), str32(f.file)]),
    ]),
  });
  const reply = Buffer.from(await res.arrayBuffer());
  expect(res.status).toBe(200);

  let offset = 0;
  const readI32 = () => reply.readInt32LE((offset += 4) - 4);
  const readStr32 = () => {
    const length = readI32();
    return reply.toString("utf8", offset, (offset += length));
  };
  const remapped = Array.from({ length: readI32() }, (): ReportFrame => {
    const line = readI32();
    const col = readI32();
    return { fn: readStr32(), file: readStr32(), line, col };
  });
  const lineCount = reply[offset++];
  const code =
    lineCount > 0
      ? {
          lineOfInterest: readI32(),
          firstLine: readI32(),
          column: readI32(),
          lines: Array.from({ length: lineCount }, readStr32),
        }
      : null;
  expect(offset).toBe(reply.length);
  return { frames: remapped, code };
}

/** The stack frame lines that the dev server printed for the report with this message. */
async function printedReport(dev: Dev, message: string) {
  await dev.output.waitForLine(new RegExp(message));
  await dev.output.waitForLine(/browser tab/);
  const lines = dev.output.lines.map(line => Bun.stripANSI(line));
  const start = lines.findLastIndex(line => line.includes(message));
  return lines.slice(start + 1, lines.indexOf(`    from browser tab ${dev.baseUrl}/`, start));
}
