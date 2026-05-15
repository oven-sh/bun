import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

// Exercises the three `SmallList::set_len` call sites in the CSS parser, all
// of which are shrink-only today:
//
//   1. `src/css/selectors/parser.rs` `small_list_into_box`: drains a
//      `SmallList<T,N>` into a `Box<[T]>` via `ptr::read` + `set_len(0)`
//      to suppress the source's `Drop`. Hit by any selector containing a
//      nested selector list (`:is(...)`, `:where(...)`, `:not(...)`).
//
//   2. `src/css/selectors/builder.rs` `build_with_specificity_and_flags`:
//      `set_len(0)` after draining `simple_selectors` and `combinators`
//      into the owned selector. Hit by every single rule parsed — but
//      complex compound selectors with multiple combinators and trailing
//      pseudo-class arguments stress it hardest.
//
//   3. `src/css/css_parser.rs` `reset_enclosing_layer`: `set_len(old_len)`
//      after parsing a nested `@layer` block, restoring the layer name
//      segment list to its length before the push. Hit by nested `@layer`
//      blocks whose inner rule pushes a name onto the enclosing layer.
//
// The fix in PR #30773 changes the callee signature from safe to `unsafe fn`
// — no runtime behaviour change. This test is a smoke-screen against a
// future refactor silently breaking one of the three call sites (e.g.
// `set_len` with the wrong length, or an accidental grow). Under `bun bd`'s
// ASAN, the `ptr::read` + `set_len(0)` pattern would catch a double-free
// or use-after-free on the moved-out payload.

test("nested @layer blocks with complex selectors parse and round-trip through the bundler", async () => {
  // Build nested @layer rules that exercise the `reset_enclosing_layer`
  // path: each inner `@layer` push appends a name segment, then shrinks
  // back via `set_len(old_len)` when the block closes.
  //
  // Each innermost rule uses a compound selector with `:is()`, `:where()`,
  // `:not()`, multiple combinators, and trailing pseudo-classes so the
  // selector builder drains into `components: Vec` via the `set_len(0)`
  // path on every rule.
  const layers = 32;
  const rulesPerLayer = 16;

  let css = "";
  for (let i = 0; i < layers; i++) {
    css += `@layer l${i} {\n`;
    for (let r = 0; r < rulesPerLayer; r++) {
      // Compound selector shape: `.a-0 > :is(.b-0, .b-1, .b-2) + .c-0 :where(.d-0, .d-1):not(.e-0):hover`
      // exercises selector list drain (`:is`, `:where`, `:not`),
      // combinators (`>`, `+`, descendant), and a trailing pseudo-class.
      const sel = `.a-l${i}-r${r} > :is(.b-0, .b-1, .b-2)` + ` + .c-${r} :where(.d-0, .d-1):not(.e-${r}):hover`;
      css += `  ${sel} { color: hsl(${r * 7}, 80%, 50%); }\n`;
      // Also emit a plain rule so the selector builder runs on the simple
      // path each iteration too.
      css += `  .simple-l${i}-r${r} { padding: ${r}px; }\n`;
    }
  }
  // Close all the `@layer` blocks.
  css += "}\n".repeat(layers);

  using dir = tempDir("css-small-list-set-len", {
    "nested-layers.css": css,
  });

  const fixture =
    `const result = await Bun.build({\n` +
    `  entrypoints: [${JSON.stringify(path.join(String(dir), "nested-layers.css"))}],\n` +
    `});\n` +
    `if (!result.success) {\n` +
    `  console.error(result.logs.join("\\n"));\n` +
    `  process.exit(2);\n` +
    `}\n` +
    `const out = await result.outputs[0].text();\n` +
    `// Characteristic fragments from different depths confirm the whole\n` +
    `// nest survived parsing — including selectors from layer 0, the\n` +
    `// middle, and the last layer (where reset_enclosing_layer was hit\n` +
    `// the most times).\n` +
    `console.log(JSON.stringify({\n` +
    `  firstRule: out.includes(".a-l0-r0"),\n` +
    `  midRule: out.includes(".a-l${layers >> 1}-r0"),\n` +
    `  lastRule: out.includes(".a-l${layers - 1}-r${rulesPerLayer - 1}"),\n` +
    `  // Selector-list payloads from :is/:where/:not survived the drain.\n` +
    `  hasIsPayload: out.includes(".b-0") && out.includes(".b-2"),\n` +
    `  hasWherePayload: out.includes(".d-0") && out.includes(".d-1"),\n` +
    `  hasSimpleRules: out.includes(".simple-l0-r0") && out.includes(".simple-l${layers - 1}-r${rulesPerLayer - 1}"),\n` +
    `}));\n`;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ exitCode, stderr: stderr.slice(-800) }).toMatchObject({ exitCode: 0 });

  expect(JSON.parse(stdout.trim())).toEqual({
    firstRule: true,
    midRule: true,
    lastRule: true,
    hasIsPayload: true,
    hasWherePayload: true,
    hasSimpleRules: true,
  });
});

test("selector list drain survives repeated :is() / :where() / :not() payloads", async () => {
  // `small_list_into_box` in `src/css/selectors/parser.rs` is the drain
  // path for selector-list pseudo-classes. Each `:is(a, b, c, ...)` in
  // the input builds a `SmallList<Selector, N>`, reads every element out
  // via `ptr::read`, then `set_len(0)`s to suppress the source's `Drop`.
  //
  // If `set_len` ever grew or skipped elements, ASAN would trip on the
  // moved-out slot being read back (during the `into_box` output) or on
  // `Drop` running twice (the suppressed source + the box).
  //
  // Keep payloads small so no list spills to the heap — the inline case
  // is what most rules hit in practice.
  const rules = 500;
  let css = "";
  for (let r = 0; r < rules; r++) {
    css += `.r${r} :is(.a-${r}, .b-${r}) :where(.c-${r}, .d-${r})` + ` :not(.e-${r}, .f-${r}) { --v-${r}: ${r}; }\n`;
  }

  using dir = tempDir("css-small-list-drain", {
    "drain.css": css,
  });

  const fixture =
    `const result = await Bun.build({\n` +
    `  entrypoints: [${JSON.stringify(path.join(String(dir), "drain.css"))}],\n` +
    `});\n` +
    `if (!result.success) {\n` +
    `  console.error(result.logs.join("\\n"));\n` +
    `  process.exit(2);\n` +
    `}\n` +
    `const out = await result.outputs[0].text();\n` +
    `console.log(JSON.stringify({\n` +
    `  firstDrain: out.includes(".a-0") && out.includes(".b-0"),\n` +
    `  lastDrain: out.includes(".a-${rules - 1}") && out.includes(".b-${rules - 1}"),\n` +
    `  // --v-* custom props come from the declaration block, i.e. the\n` +
    `  // rule was fully parsed after the selector list drain.\n` +
    `  firstDecl: out.includes("--v-0"),\n` +
    `  lastDecl: out.includes("--v-${rules - 1}"),\n` +
    `}));\n`;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ exitCode, stderr: stderr.slice(-800) }).toMatchObject({ exitCode: 0 });

  expect(JSON.parse(stdout.trim())).toEqual({
    firstDrain: true,
    lastDrain: true,
    firstDecl: true,
    lastDecl: true,
  });
});
