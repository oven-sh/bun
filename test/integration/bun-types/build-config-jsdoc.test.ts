// The API reference for `Bun.build` is generated from the JSDoc in bun.d.ts.
// Each test runs a documented option, then checks that the JSDoc of that
// option describes what the build did.
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
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

describe.concurrent("BuildConfig JSDoc matches the runtime", () => {
  test("sourcemap: what `true` is an alias for", async () => {
    using dir = tempDir("jsdoc-sourcemap-true", { "index.js": `console.log("hello");` });
    const entrypoints = [join(String(dir), "index.js")];

    const withOutdir = await Bun.build({ entrypoints, sourcemap: true, outdir: join(String(dir), "out") });
    const withoutOutdir = await Bun.build({ entrypoints, sourcemap: true });
    const observed = [
      sourcemapCommentKind(await withOutdir.outputs.find(o => o.kind === "entry-point")!.text()),
      sourcemapCommentKind(await withoutOutdir.outputs.find(o => o.kind === "entry-point")!.text()),
    ];
    expect(observed).toEqual(["linked", "inline"]);

    const sentences = jsdocOf("sourcemap")
      .split(/(?<=\.)\s+/)
      .filter(sentence => sentence.includes("`true`"));
    const documented = sentences.flatMap(sentence =>
      [...sentence.matchAll(/`"(none|linked|inline|external)"`/g)].map(match => match[1]),
    );
    expect(documented).toEqual(expect.arrayContaining(observed));
  });

  test('sourcemap: "linked" and "external" without outdir', async () => {
    using dir = tempDir("jsdoc-sourcemap-no-outdir", { "index.js": `console.log("hello");` });
    const entrypoints = [join(String(dir), "index.js")];

    for (const sourcemap of ["linked", "external"] as const) {
      const build = await Bun.build({ entrypoints, sourcemap });
      const entry = build.outputs.find(o => o.kind === "entry-point")!;
      const map = build.outputs.find(o => o.kind === "sourcemap")!;
      expect({ sourcemap, success: build.success, kinds: build.outputs.map(o => o.kind) }).toEqual({
        sourcemap,
        success: true,
        kinds: ["entry-point", "sourcemap"],
      });
      expect(entry.sourcemap).toBe(map);
    }

    const doc = jsdocOf("sourcemap");
    expect(doc).not.toMatch(/requires? `outdir`|outdir\}? (is )?required/i);
    expect(doc).toContain('`kind: "sourcemap"`');
  });

  test("banner and footer: JavaScript outputs only", async () => {
    using dir = tempDir("jsdoc-banner-footer", {
      "index.js": `import("./lazy.js").then(m => console.log(m.default));`,
      "lazy.js": `export default "lazy";`,
      "style.css": `a { color: red; }`,
    });
    const build = await Bun.build({
      entrypoints: [join(String(dir), "index.js"), join(String(dir), "style.css")],
      splitting: true,
      banner: "/* BANNER */",
      footer: "/* FOOTER */",
    });
    expect(build.success).toBe(true);

    const observed = await Promise.all(
      build.outputs.map(async output => {
        const text = await output.text();
        return {
          ext: output.path.slice(output.path.lastIndexOf(".")),
          kind: output.kind,
          banner: text.includes("/* BANNER */"),
          footer: text.includes("/* FOOTER */"),
        };
      }),
    );
    observed.sort((a, b) => (a.ext + a.kind).localeCompare(b.ext + b.kind));
    expect(observed).toEqual([
      { ext: ".css", kind: "asset", banner: false, footer: false },
      { ext: ".js", kind: "chunk", banner: true, footer: true },
      { ext: ".js", kind: "entry-point", banner: true, footer: true },
    ]);

    for (const member of ["banner", "footer"]) {
      expect({ member, doc: jsdocOf(member) }).toEqual({ member, doc: expect.stringContaining("CSS") });
    }
  });
});
