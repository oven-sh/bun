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

devTest("hmr chunk source map follows the source when mappings do not change", {
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
      export default "AAA";
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", { storeHotChunks: true });
    await c.expectMessage("Hello, AAA!");
    // Each edit changes only a string literal. The VLQ mappings stay the
    // same, so the source map must be keyed by the source content too.
    const mapUrls = new Set<string>();
    for (const word of ["BBB", "CCC", "DDD"]) {
      const source = `export default "${word}";\nimport.meta.hot.accept();`;
      await dev.write("App.tsx", source);
      const chunk = await c.getMostRecentHmrChunk();
      expect(chunk).toContain(`"${word}"`);
      const sourceMapUrl = chunk.match(/\n\/\/# sourceMappingURL=(\S+)/)?.[1];
      expect(sourceMapUrl).toBeString();
      mapUrls.add(sourceMapUrl!);
      const sourceMap = await dev.fetch(sourceMapUrl!).json();
      expect(sourceMap.sources.slice(1).map(Bun.fileURLToPath)).toEqual([dev.join("App.tsx")]);
      expect(sourceMap.sourcesContent[1]).toBe(source);
    }
    expect(mapUrls.size).toBe(3);

    // A re-save with the same bytes produces the same source map, so it
    // reuses the same key.
    await dev.writeNoChanges("App.tsx");
    const chunk = await c.getMostRecentHmrChunk();
    expect(chunk).toContain(`"DDD"`);
    const sourceMapUrl = chunk.match(/\n\/\/# sourceMappingURL=(\S+)/)?.[1];
    expect(mapUrls.has(sourceMapUrl!)).toBe(true);
  },
});

devTest("hmr chunk source map follows the line count of a part without mappings", {
  files: {
    "index.html": emptyHtmlFile({
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import other from "./App";
      import text from "./data.txt";
      console.log("Hello, " + other + "! " + text.length);
      import.meta.hot.accept();
    `,
    "App.tsx": `
      export default "AAA";
      import.meta.hot.accept();
    `,
    "data.txt": "x",
  },
  async test(dev) {
    await using c = await dev.client("/", { storeHotChunks: true });
    await c.expectMessage("Hello, AAA! 1");
    // A text file prints no mappings, so the store keeps only its line
    // count. The line count offsets every part after it in the chunk. Each
    // save changes only that count, so each save needs its own map.
    const mapUrls = new Set<string>();
    const mappings = new Set<string>();
    for (const text of ["BBB\n", "BBB\n\n", "BBB\n\n\n"]) {
      {
        await using _batch = await dev.batchChanges({ errors: null });
        await dev.write("data.txt", text, { dedent: false });
        await dev.writeNoChanges("App.tsx");
      }
      const chunk = await c.getMostRecentHmrChunk();
      const sourceMapUrl = chunk.match(/\n\/\/# sourceMappingURL=(\S+)/)?.[1];
      expect(sourceMapUrl).toBeString();
      mapUrls.add(sourceMapUrl!);
      const sourceMap = await dev.fetch(sourceMapUrl!).json();
      // The bundler does not order the parts of the chunk.
      expect(sourceMap.sources.slice(1).map(Bun.fileURLToPath).sort()).toEqual(
        [dev.join("index.ts"), dev.join("data.txt"), dev.join("App.tsx")].sort(),
      );
      mappings.add(sourceMap.mappings);
      // index.ts re-runs on each update. Its output is not under test.
      c.messages.length = 0;
    }
    expect(mapUrls.size).toBe(3);
    expect(mappings.size).toBe(3);
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
