import { describe, expect } from "bun:test";
import { itBundled } from "../expectBundled";

// Regression coverage for the CSS parser's generic closure trampolines
// `parse_nested_block` / `parse_until_before` / `parse_until_after` in
// src/css/css_parser.zig. These are monomorphized per call-site closure and
// share non-generic prologue/epilogue helpers to keep binary size down; this
// test exercises a representative spread of those call sites (nested at-rules,
// functional pseudo-classes, supports(), var(), calc(), env(), gradients,
// comma lists) so that a regression in the shared helpers surfaces as an
// output diff.
describe("css", () => {
  itBundled("css/nested-block-trampolines", {
    files: {
      "index.css": /* css */ `
        @layer base, components;

        @layer base {
          @supports (display: grid) and (not (display: inline-grid)) {
            @media screen and (min-width: 300px), (orientation: landscape) {
              @container sidebar (width > 200px) {
                .grid:is(.a, .b):not(:nth-child(2n + 1 of .item)) {
                  --x: var(--y, calc(1px + 2%));
                  color: color-mix(in srgb, red 20%, blue);
                  background: linear-gradient(to right, rgb(0 0 0 / 0.5), hsl(120 50% 50%));
                  grid-template-columns: repeat(3, minmax(0, 1fr));
                  transition: color 1s, opacity 2s !important;
                }
                .grid > [data-x="y"] { content: attr(data-x); }
              }
            }
          }
        }

        @scope (.light) to (.dark) {
          @media (prefers-color-scheme: dark) {
            :scope { color: env(safe-area-inset-top, 0px); }
          }
        }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        "/* index.css */
        @layer base, components;

        @layer base {
          @supports (display: grid) and ( not (display: inline-grid)) {
            @media screen and (min-width: 300px), (orientation: landscape) {
              @container sidebar (width > 200px) {
                .grid:is(.a, .b):not(:nth-child(odd of .item)) {
                  --x: var(--y, calc(1px + 2%));
                  color: #30c;
                  background: linear-gradient(to right, #00000080, #40bf40);
                  grid-template-columns: repeat(3, minmax(0, 1fr));
                  transition: color 1s, opacity 2s !important;
                }

                .grid > [data-x="y"] {
                  content: attr(data-x);
                }
              }
            }
          }
        }

        @scope (.light) to (.dark) {
          @media (prefers-color-scheme: dark) {
            :scope {
              color: env(safe-area-inset-top, 0px);
            }
          }
        }
        "
      `);
    },
  });

  // Moderately deep at-rule nesting. The refactored closure trampolines keep
  // each generic body `noinline` so the nested `Parser` stack slot stays in a
  // leaf frame during recursion; without that, LLVM can inline the tiny
  // generic body into `parse_at_rule` and push the per-level stack footprint
  // high enough to overflow well before this depth. The only existing coverage
  // for this in `css-fuzz.test.ts` is gated behind `!isCI`.
  const depth = 40;
  itBundled("css/nested-at-rule-recursion", {
    files: {
      "index.css": `${"@media screen{".repeat(depth)}.x{color:red}${"}".repeat(depth)}`,
    },
    outdir: "/out",
    minifyWhitespace: true,
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      expect(api.readFile("/out/index.css")).toBe(
        `${"@media screen{".repeat(depth)}.x{color:red}${"}".repeat(depth)}\n`,
      );
    },
  });
});
