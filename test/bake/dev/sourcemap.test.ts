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

devTest("source content changes receive a new immutable HMR map", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["snapshot.ts"] }),
    "snapshot.ts": 'console.log("snapshot-body");\nimport.meta.hot.accept();\n// alpha',
  },
  async test(dev) {
    const body = 'console.log("snapshot-body");\nimport.meta.hot.accept();\n';
    const mapUrl = (script: string) => {
      const match = script.match(/\n\/\/# sourceMappingURL=([^\n]+)/);
      expect(match).not.toBeNull();
      return match![1];
    };
    const code = (script: string) => {
      const end = script.lastIndexOf('}, "');
      expect(end).toBeGreaterThan(0);
      return script.slice(0, end);
    };
    await using client = await dev.client("/", { storeHotChunks: true });
    await client.expectMessage("snapshot-body");

    await dev.write("snapshot.ts", body + "// bravo");
    await client.expectMessage("snapshot-body");
    const firstScript = await client.getMostRecentHmrChunk();
    using first = await extractSourceMap(dev, firstScript);
    const firstUrl = mapUrl(firstScript);
    const firstJson = await dev.fetch(firstUrl).json();
    const source = Bun.pathToFileURL(dev.join("snapshot.ts")).href;
    expect(first.sourceContentFor(source)).toBe(body + "// bravo");

    await dev.write("snapshot.ts", body + "// cello");
    await client.expectMessage("snapshot-body");
    const secondScript = await client.getMostRecentHmrChunk();
    using second = await extractSourceMap(dev, secondScript);
    const secondUrl = mapUrl(secondScript);
    const secondJson = await dev.fetch(secondUrl).json();
    expect(code(firstScript)).toBe(code(secondScript));
    expect(firstJson.mappings).toBe(secondJson.mappings);
    expect(firstJson.sources).toEqual(secondJson.sources);
    expect(second.sourceContentFor(source)).toBe(body + "// cello");
    expect(secondUrl).not.toBe(firstUrl);

    using retained = await extractSourceMap(dev, firstScript);
    expect(retained.sourceContentFor(source)).toBe(body + "// bravo");
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
