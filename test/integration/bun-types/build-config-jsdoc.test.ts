// The API reference for `Bun.build` is generated from the JSDoc in bun.d.ts.
// Each test runs a documented option, then checks that the JSDoc of that
// option describes what the build did.
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dts = readFileSync(join(import.meta.dir, "../../../packages/bun-types/bun.d.ts"), "utf8");

/** The JSDoc block directly above `member?:` in bun.d.ts, as one line of prose. */
function jsdocOf(member: string): string {
  const decl = dts.search(new RegExp(`^ +${member}\\?: `, "m"));
  expect(decl).toBeGreaterThan(-1);
  const start = dts.lastIndexOf("/**", decl);
  const end = dts.indexOf("*/", start);
  expect(dts.slice(end + 2, decl).trim()).toBe("");
  return dts
    .slice(start + 3, end)
    .replace(/^\s*\* ?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Which `sourcemap` mode the `//# sourceMappingURL` comment of an output is. */
function sourcemapCommentKind(text: string): "inline" | "linked" | "none" {
  if (text.includes("//# sourceMappingURL=data:")) return "inline";
  if (text.includes("//# sourceMappingURL=")) return "linked";
  return "none";
}

const extensionOf = (path: string) => path.slice(path.lastIndexOf("."));

// With `splitting`, this page builds to one output of each type: a JavaScript
// entry point, a JavaScript chunk, a CSS file and an HTML file.
const page = {
  "index.html": `<!doctype html><html><head><link rel="stylesheet" href="./style.css"><script type="module" src="./index.js"></script></head><body></body></html>`,
  "index.js": `import("./lazy.js").then(m => console.log(m.default));`,
  "lazy.js": `export default "lazy";`,
  "style.css": `a { color: red; }`,
};
const outputTypes = ["CSS", "HTML", "JavaScript"];

describe.concurrent("BuildConfig JSDoc matches the runtime", () => {
  test("sourcemap: what `true` is an alias for", async () => {
    using dir = tempDir("jsdoc-sourcemap-true", page);
    const config = { entrypoints: [join(String(dir), "index.html")], splitting: true, sourcemap: true };

    const observed: string[] = [];
    for (const build of [await Bun.build({ ...config, outdir: join(String(dir), "out") }), await Bun.build(config)]) {
      const scripts = build.outputs.filter(output => extensionOf(output.path) === ".js");
      expect(scripts.map(output => output.kind).sort()).toEqual(["chunk", "entry-point"]);
      const kinds = await Promise.all(scripts.map(async output => sourcemapCommentKind(await output.text())));
      observed.push(...new Set(kinds));
    }
    expect(observed).toEqual(["linked", "inline"]);

    const sentences = jsdocOf("sourcemap")
      .split(/(?<=\.)\s+/)
      .filter(sentence => sentence.includes("`true`"));
    const documented = sentences.flatMap(sentence =>
      [...sentence.matchAll(/`"(none|linked|inline|external)"`/g)].map(match => match[1]),
    );
    expect(documented).toEqual(expect.arrayContaining(observed));
    // The two builds differ only in `outdir`, so the JSDoc has to say that it decides.
    expect(sentences.join(" ")).toContain("`outdir`");
  });

  test('sourcemap: "linked" and "external" without outdir', async () => {
    using dir = tempDir("jsdoc-sourcemap-no-outdir", page);
    const sources = readdirSync(String(dir)).sort();

    for (const sourcemap of ["linked", "external"] as const) {
      const build = await Bun.build({ entrypoints: [join(String(dir), "index.html")], splitting: true, sourcemap });
      expect(build.success).toBe(true);

      const maps = build.outputs.filter(output => output.kind === "sourcemap").map(output => output.path);
      const observed = build.outputs
        .filter(output => output.kind !== "sourcemap")
        .map(output => ({
          ext: extensionOf(output.path),
          kind: output.kind,
          map: maps.includes(output.path + ".map"),
        }))
        .sort((a, b) => (a.ext + a.kind).localeCompare(b.ext + b.kind));
      expect({ sourcemap, maps: maps.length, observed }).toEqual({
        sourcemap,
        maps: 2,
        observed: [
          { ext: ".css", kind: "asset", map: false },
          { ext: ".html", kind: "entry-point", map: false },
          { ext: ".js", kind: "chunk", map: true },
          { ext: ".js", kind: "entry-point", map: true },
        ],
      });
    }
    expect(readdirSync(String(dir)).sort()).toEqual(sources);

    const doc = jsdocOf("sourcemap");
    expect(doc).not.toMatch(/requires? `outdir`|outdir\}? (is )?required/i);
    expect(doc).toContain('`kind: "sourcemap"`');
    // Only one of the three types of output file got a map, so the JSDoc has
    // to name all three.
    expect(outputTypes.filter(type => doc.includes(type))).toEqual(outputTypes);
  });

  test("banner and footer: JavaScript outputs only", async () => {
    using dir = tempDir("jsdoc-banner-footer", page);
    const build = await Bun.build({
      entrypoints: [join(String(dir), "index.html")],
      splitting: true,
      banner: "/* BANNER */",
      footer: "/* FOOTER */",
    });
    expect(build.success).toBe(true);

    const observed = await Promise.all(
      build.outputs.map(async output => {
        const text = await output.text();
        return {
          ext: extensionOf(output.path),
          kind: output.kind,
          banner: text.includes("/* BANNER */"),
          footer: text.includes("/* FOOTER */"),
        };
      }),
    );
    observed.sort((a, b) => (a.ext + a.kind).localeCompare(b.ext + b.kind));
    expect(observed).toEqual([
      { ext: ".css", kind: "asset", banner: false, footer: false },
      { ext: ".html", kind: "entry-point", banner: false, footer: false },
      { ext: ".js", kind: "chunk", banner: true, footer: true },
      { ext: ".js", kind: "entry-point", banner: true, footer: true },
    ]);

    // The build made three types of output file and treated them differently,
    // so the JSDoc has to name all three.
    for (const member of ["banner", "footer"]) {
      const doc = jsdocOf(member);
      expect({ member, named: outputTypes.filter(type => doc.includes(type)) }).toEqual({ member, named: outputTypes });
    }
  });
});
