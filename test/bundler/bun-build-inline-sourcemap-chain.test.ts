import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// Regression coverage for https://github.com/oven-sh/bun/issues/30536 and
// https://github.com/oven-sh/bun/issues/6173: the bundler must chain inline
// `//# sourceMappingURL=` comments on input files. A `.vue` / `.svelte` /
// `.ts` file compiled to an intermediate `.js` with an inline sourcemap
// should have its authored sources surface in the final bundle's map.
//
// Kept in a dedicated file (rather than bun-build-api.test.ts) so the suite
// stays fast and deterministic: bun-build-api.test.ts carries a ~160s
// repeated-build stress test whose runtime sits close to its timeout under
// load, which is unrelated to this feature.
describe.concurrent("Bun.build chains inline input sourcemaps", () => {
  // Build a tiny intermediate `.js` that carries an inline base64 sourcemap
  // pointing at a fake "authored" source, then bundle an entry that imports
  // it. The output map's `sources[]` should include the authored source,
  // and `sourcesContent[]` should include the inner content verbatim
  // (without the trailing `//# sourceMappingURL=` comment).
  test("inline data: URL — authored source surfaces in bundled map", async () => {
    const authoredSrc = "export const x = 5;\nthrow new Error('authored');\n";
    const innerMap = {
      version: 3,
      sources: ["authored.ts"],
      sourcesContent: [authoredSrc],
      names: [],
      mappings: "AAAA;AACA;",
    };
    const inline = `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(innerMap)).toString("base64")}\n`;

    const dir = tempDirWithFiles("bun-build-chained-sourcemap", {
      "intermediate.js": authoredSrc + inline,
      "entry.ts": `import { x } from './intermediate.js';\nconsole.log(x);\n`,
    });

    const result = await Bun.build({
      entrypoints: [join(dir, "entry.ts")],
      outdir: join(dir, "out"),
      format: "esm",
      target: "bun",
      sourcemap: "inline",
    });
    expect(result.success).toBe(true);

    const text = await Bun.file(result.outputs[0].path).text();
    const m = text.match(/\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-?8)?;base64,(.+)/);
    expect(m).not.toBeNull();
    const parsed = JSON.parse(Buffer.from(m![1], "base64").toString("utf-8"));

    // The authored source name must appear somewhere in `sources[]`.
    const sourcesJoined = parsed.sources.join("|");
    expect(sourcesJoined).toMatch(/authored\.ts/);

    // `sourcesContent` length must equal `sources` length (spec).
    expect(parsed.sourcesContent).toHaveLength(parsed.sources.length);

    // The slot for `authored.ts` must hold the clean authored content, no
    // trailing `//# sourceMappingURL=` comment.
    const authoredIdx = parsed.sources.findIndex((s: string) => s.endsWith("authored.ts"));
    expect(authoredIdx).toBeGreaterThanOrEqual(0);
    expect(parsed.sourcesContent[authoredIdx]).toBe(authoredSrc);
    expect(parsed.sourcesContent[authoredIdx]).not.toMatch(/sourceMappingURL/);
  });

  // Non-base64 `data:application/json,<json>` must work too — some
  // toolchains emit the comment in that form.
  test("inline data: URL without base64 — authored source surfaces", async () => {
    const authoredSrc = "export const y = 1;\n";
    const innerMap = {
      version: 3,
      sources: ["authored.ts"],
      sourcesContent: [authoredSrc],
      names: [],
      mappings: "AAAA;",
    };

    const dir = tempDirWithFiles("bun-build-chained-sourcemap-raw", {
      "intermediate.js": authoredSrc + `\n//# sourceMappingURL=data:application/json,${JSON.stringify(innerMap)}\n`,
      "entry.ts": `import { y } from './intermediate.js';\nconsole.log(y);\n`,
    });

    const result = await Bun.build({
      entrypoints: [join(dir, "entry.ts")],
      outdir: join(dir, "out"),
      format: "esm",
      target: "bun",
      sourcemap: "inline",
    });
    expect(result.success).toBe(true);

    const text = await Bun.file(result.outputs[0].path).text();
    const m = text.match(/\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-?8)?;base64,(.+)/);
    expect(m).not.toBeNull();
    const parsed = JSON.parse(Buffer.from(m![1], "base64").toString("utf-8"));
    expect(parsed.sources.some((s: string) => s.endsWith("authored.ts"))).toBe(true);
  });

  // Inner map with multiple sources (e.g. a `.vue` compiler splitting
  // template vs script into two virtual sources) — each must round-trip.
  test("inline map with multiple inner sources — all surface", async () => {
    const scriptSrc = "export const x = 5;\n";
    const templateSrc = "// template part\n";
    const innerMap = {
      version: 3,
      sources: ["component.vue?script", "component.vue?template"],
      sourcesContent: [scriptSrc, templateSrc],
      names: [],
      mappings: "AAAA;ACAA;",
    };
    const intermediate = scriptSrc + templateSrc;
    const inline = `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(innerMap)).toString("base64")}\n`;

    const dir = tempDirWithFiles("bun-build-chained-sourcemap-multi", {
      "intermediate.js": intermediate + inline,
      "entry.ts": `import { x } from './intermediate.js';\nconsole.log(x);\n`,
    });

    const result = await Bun.build({
      entrypoints: [join(dir, "entry.ts")],
      outdir: join(dir, "out"),
      format: "esm",
      target: "bun",
      sourcemap: "inline",
    });
    expect(result.success).toBe(true);

    const text = await Bun.file(result.outputs[0].path).text();
    const m = text.match(/\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-?8)?;base64,(.+)/);
    expect(m).not.toBeNull();
    const parsed = JSON.parse(Buffer.from(m![1], "base64").toString("utf-8"));
    expect(parsed.sources.some((s: string) => s.endsWith("component.vue?script"))).toBe(true);
    expect(parsed.sources.some((s: string) => s.endsWith("component.vue?template"))).toBe(true);
    expect(parsed.sourcesContent).toHaveLength(parsed.sources.length);
  });

  // A malformed inline map must not break the build — we silently fall
  // back to the intermediate as the deepest source.
  test("malformed inline map — build succeeds and falls back", async () => {
    const dir = tempDirWithFiles("bun-build-chained-sourcemap-bad", {
      "intermediate.js": "export const z = 2;\n//# sourceMappingURL=data:application/json;base64,!!!not-valid!!!\n",
      "entry.ts": `import { z } from './intermediate.js';\nconsole.log(z);\n`,
    });

    const result = await Bun.build({
      entrypoints: [join(dir, "entry.ts")],
      outdir: join(dir, "out"),
      format: "esm",
      target: "bun",
      sourcemap: "inline",
    });
    expect(result.success).toBe(true);

    // Regression guard for the "parse failure kills the whole build"
    // path: a valid output map must still be produced, and the deepest
    // source must be the intermediate (no spurious chained source from
    // the malformed payload).
    const text = await Bun.file(result.outputs[0].path).text();
    const m = text.match(/\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-?8)?;base64,(.+)/);
    expect(m).not.toBeNull();
    const parsed = JSON.parse(Buffer.from(m![1], "base64").toString("utf-8"));
    expect(parsed.sources.some((s: string) => s.endsWith("intermediate.js"))).toBe(true);
  });

  // Inner map whose VLQ references `source_index >= sources.len` is
  // malformed per the spec. Accepting it would alias the next input
  // file's slot in the output `sources[]` (Chunk.Builder emits
  // `1 + inner.source_index` unclamped; LinkerContext reserves exactly
  // `1 + external_source_names.len` slots per file). Pass the real
  // source count to `Mapping.parse` so the map gets rejected and we
  // fall back to the intermediate.
  test("inline map with out-of-range inner source_index is rejected", async () => {
    // VLQ "AAAA;ACAA" = line 0: (0, 0, 0, 0); line 1: (0, +1, 0, 0)
    // → second mapping references source_index = 1, but sources has
    // only one entry.
    const innerMap = {
      version: 3,
      sources: ["authored.ts"],
      sourcesContent: ["// authored\n"],
      names: [],
      mappings: "AAAA;ACAA",
    };
    const inline = `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(innerMap)).toString("base64")}\n`;

    const dir = tempDirWithFiles("bun-build-chained-sourcemap-oob", {
      "intermediate.js": "export const x = 1;\nexport const y = 2;\n" + inline,
      "entry.ts": `import { x } from './intermediate.js';\nconsole.log(x);\n`,
    });

    const result = await Bun.build({
      entrypoints: [join(dir, "entry.ts")],
      outdir: join(dir, "out"),
      format: "esm",
      target: "bun",
      sourcemap: "inline",
    });
    expect(result.success).toBe(true);

    const text = await Bun.file(result.outputs[0].path).text();
    const m = text.match(/\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-?8)?;base64,(.+)/);
    expect(m).not.toBeNull();
    const parsed = JSON.parse(Buffer.from(m![1], "base64").toString("utf-8"));
    // The malformed map must be rejected — no `authored.ts` slot
    // appears in the output, and no neighboring file's slot got
    // aliased away.
    expect(parsed.sources.some((s: string) => s.endsWith("authored.ts"))).toBe(false);
    expect(parsed.sources.some((s: string) => s.endsWith("intermediate.js"))).toBe(true);
  });

  // An inner `sources[i]` longer than MAX_PATH_BYTES is resolved against
  // the intermediate's directory via fixed-size path buffers; an
  // adversarial inline map with such a source name must be rejected at
  // parse time (clean fallback to the intermediate) rather than panicking
  // the build in the path normalizer. MAX_PATH_BYTES is platform-dependent
  // (4096 on Linux, ~96 KB on Windows), so use a name past the largest.
  test("oversized inner source name — map rejected, build falls back", async () => {
    const hugeName = Buffer.alloc(128 * 1024, "a").toString() + ".ts";
    const innerMap = {
      version: 3,
      sources: [hugeName],
      sourcesContent: ["// authored\n"],
      names: [],
      mappings: "AAAA;",
    };
    const inline = `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(innerMap)).toString("base64")}\n`;

    const dir = tempDirWithFiles("bun-build-chained-sourcemap-huge", {
      "intermediate.js": "export const x = 7;\n" + inline,
      "entry.ts": `import { x } from './intermediate.js';\nconsole.log(x);\n`,
    });

    // Spawn so an abort in the path normalizer would surface as a nonzero
    // exit rather than a thrown JS error.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const r = await Bun.build({ entrypoints: [${JSON.stringify(join(dir, "entry.ts"))}], outdir: ${JSON.stringify(join(dir, "out"))}, format: "esm", target: "bun", sourcemap: "inline" });
         if (!r.success) { console.error("build failed"); process.exit(2); }
         const text = await Bun.file(r.outputs[0].path).text();
         const m = text.match(/\\/\\/# sourceMappingURL=data:application\\/json(?:;charset=utf-?8)?;base64,(.+)/);
         const parsed = JSON.parse(Buffer.from(m[1], "base64").toString("utf-8"));
         console.log(JSON.stringify({ hasHuge: parsed.sources.some(s => s.length > 4096), hasIntermediate: parsed.sources.some(s => s.endsWith("intermediate.js")) }));`,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // A crash in the path normalizer aborts the child: empty stdout and a
    // nonzero exit. Surfacing stderr here gives a useful message on failure
    // (it is not asserted empty — debug/ASAN builds emit warnings).
    expect(stdout.trim() === "" ? stderr : "ok").toBe("ok");
    expect(exitCode).toBe(0);
    // The oversized map is rejected: no multi-KB source surfaces, and the
    // intermediate remains as the deepest source.
    expect(JSON.parse(stdout.trim())).toEqual({ hasHuge: false, hasIntermediate: true });
  });

  // Guard the last-line anchoring — a file that has a fully-valid
  // `//# sourceMappingURL=` marker embedded EARLIER in the body (inside
  // a template literal / multi-line string) but NO trailing comment must
  // not get mis-chained off that in-body text. Without last-line
  // anchoring, `lastIndexOf("\n//# sourceMappingURL=")` finds the
  // embedded marker and chains through the fake payload — the authored
  // "hijack.ts" would show up in the output sources.
  test("sourceMappingURL marker in body is ignored (only trailing line counts)", async () => {
    const hijackMap = {
      version: 3,
      sources: ["hijack.ts"],
      sourcesContent: ["// i should not appear\n"],
      names: [],
      mappings: "AAAA;",
    };
    const hijackInline = `//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(hijackMap)).toString("base64")}`;
    // Embed the full valid inline comment inside a template literal so
    // the file parses as JS, but the real trailing line is the plain
    // `export` — no sourcemap comment at end-of-file.
    const intermediate = ["export const doc = `", hijackInline, "`;", "export const val = 99;", ""].join("\n");

    const dir = tempDirWithFiles("bun-build-chained-sourcemap-nohijack", {
      "intermediate.js": intermediate,
      "entry.ts": `import { val } from './intermediate.js';\nconsole.log(val);\n`,
    });

    const result = await Bun.build({
      entrypoints: [join(dir, "entry.ts")],
      outdir: join(dir, "out"),
      format: "esm",
      target: "bun",
      sourcemap: "inline",
    });
    expect(result.success).toBe(true);

    const text = await Bun.file(result.outputs[0].path).text();
    const m = text.match(/\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-?8)?;base64,(.+)/);
    expect(m).not.toBeNull();
    const parsed = JSON.parse(Buffer.from(m![1], "base64").toString("utf-8"));
    // The in-body marker must not hijack the chain — `hijack.ts` must
    // NOT appear as a source in the final map.
    expect(parsed.sources.some((s: string) => s.endsWith("hijack.ts"))).toBe(false);
    expect(parsed.sources.some((s: string) => s.endsWith("intermediate.js"))).toBe(true);
  });

  // Non-inline `sourceMappingURL=foo.js.map` references aren't chained
  // (external map resolution is out of scope for this change). The build
  // must behave exactly as before — the intermediate ends up as the
  // deepest source, not a spurious crash.
  test("external .map reference — unchanged behavior", async () => {
    const dir = tempDirWithFiles("bun-build-chained-sourcemap-external", {
      "intermediate.js": "export const q = 3;\n//# sourceMappingURL=intermediate.js.map\n",
      "entry.ts": `import { q } from './intermediate.js';\nconsole.log(q);\n`,
    });

    const result = await Bun.build({
      entrypoints: [join(dir, "entry.ts")],
      outdir: join(dir, "out"),
      format: "esm",
      target: "bun",
      sourcemap: "inline",
    });
    expect(result.success).toBe(true);
    const text = await Bun.file(result.outputs[0].path).text();
    const m = text.match(/\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-?8)?;base64,(.+)/);
    expect(m).not.toBeNull();
    const parsed = JSON.parse(Buffer.from(m![1], "base64").toString("utf-8"));
    // No inner chain. The intermediate should be in sources[], not some
    // phantom "authored.ts".
    expect(parsed.sources.some((s: string) => s.endsWith("intermediate.js"))).toBe(true);
  });

  // https://github.com/oven-sh/bun/issues/6173 — a plugin `onLoad` that
  // transpiles and returns JS with an inline sourcemap comment should
  // have the pre-transform authored source surface in the final map.
  // The scanner runs on `source.contents` regardless of origin, so the
  // plugin case rides on the same pipeline as the file case.
  test("onLoad plugin returning JS with inline sourcemap — authored source surfaces", async () => {
    const dir = tempDirWithFiles("bun-build-plugin-chained-sourcemap", {
      "src.custom": "export const x = 42;\n",
      "entry.ts": `import { x } from './src.custom';\nconsole.log(x);\n`,
    });

    // Use a distinct inner-source name so we can tell which `sources[]`
    // slot is the plugin intermediate vs. which is the chained inner.
    const authoredContent = "const x_authored_marker = 42;\nexport { x_authored_marker as x };\n";
    const innerMap = {
      version: 3,
      sources: ["original-authored.custom"],
      sourcesContent: [authoredContent],
      names: [],
      mappings: "AAAA;",
    };
    const inlineComment = `\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(innerMap)).toString("base64")}\n`;

    const result = await Bun.build({
      entrypoints: [join(dir, "entry.ts")],
      outdir: join(dir, "out"),
      format: "esm",
      target: "bun",
      sourcemap: "inline",
      plugins: [
        {
          name: "custom-transpiler",
          setup(build) {
            build.onLoad({ filter: /\.custom$/ }, () => ({
              // Emit transformed JS carrying its own inline sourcemap
              // pointing back at the authored `.custom` source.
              contents: "export const x = 42;\n" + inlineComment,
              loader: "js",
            }));
          },
        },
      ],
    });
    expect(result.success).toBe(true);

    const text = await Bun.file(result.outputs[0].path).text();
    const m = text.match(/\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-?8)?;base64,(.+)/);
    expect(m).not.toBeNull();
    const parsed = JSON.parse(Buffer.from(m![1], "base64").toString("utf-8"));

    // The authored-source slot (distinct filename) must be present and
    // carry the pre-transform content verbatim.
    expect(parsed.sources.some((s: string) => s.endsWith("original-authored.custom"))).toBe(true);
    expect(parsed.sourcesContent).toHaveLength(parsed.sources.length);

    const authoredIdx = parsed.sources.findIndex((s: string) => s.endsWith("original-authored.custom"));
    expect(parsed.sourcesContent[authoredIdx]).toBe(authoredContent);
  });
});
