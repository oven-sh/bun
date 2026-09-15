import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import path from "node:path";
import { itBundled } from "../expectBundled";

describe("css", () => {
  itBundled("css/view-transition-class-selector-23600", {
    files: {
      "index.css": /* css */ `
        @keyframes slide-out {
          from {
            opacity: 1;
            transform: translateX(0);
          }
          to {
            opacity: 0;
            transform: translateX(-100%);
          }
        }

        ::view-transition-old(.slide-out) {
          animation-name: slide-out;
          animation-timing-function: ease-in-out;
        }

        ::view-transition-new(.fade-in) {
          animation-name: fade-in;
        }

        ::view-transition-group(.card) {
          animation-duration: 1s;
        }

        ::view-transition-image-pair(.hero) {
          isolation: isolate;
        }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        "/* index.css */
        @keyframes slide-out {
          from {
            opacity: 1;
            transform: translateX(0);
          }

          to {
            opacity: 0;
            transform: translateX(-100%);
          }
        }

        ::view-transition-old(.slide-out) {
          animation-name: slide-out;
          animation-timing-function: ease-in-out;
        }

        ::view-transition-new(.fade-in) {
          animation-name: fade-in;
        }

        ::view-transition-group(.card) {
          animation-duration: 1s;
        }

        ::view-transition-image-pair(.hero) {
          isolation: isolate;
        }
        "
      `);
    },
  });

  // css-view-transitions-2: the argument is a name or `*` followed by
  // classes, or classes alone, with no white space between the parts.
  // <pt-name-and-class-selector> = <pt-name-selector> <pt-class-selector>? | <pt-class-selector>
  itBundled("css/view-transition-name-and-class-selector", {
    files: {
      "index.css": /* css */ `
        ::view-transition-group(hero.big) {
          top: 0;
        }

        ::view-transition-old(*.fade) {
          opacity: 0;
        }

        ::view-transition-new(.a.b) {
          opacity: 1;
        }

        ::view-transition-image-pair( card.wide.tall ) {
          isolation: isolate;
        }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        "/* index.css */
        ::view-transition-group(hero.big) {
          top: 0;
        }

        ::view-transition-old(*.fade) {
          opacity: 0;
        }

        ::view-transition-new(.a.b) {
          opacity: 1;
        }

        ::view-transition-image-pair(card.wide.tall) {
          isolation: isolate;
        }
        "
      `);
    },
  });

  itBundled("css/view-transition-name-and-class-selector-whitespace", {
    files: {
      "index.css": /* css */ `
        ::view-transition-group(hero .big) {
          top: 0;
        }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    bundleErrors: {
      "/index.css": ["Unexpected token: ."],
    },
  });

  // Outside CSS modules the view transition names are printed as written.
  itBundled("css/view-transition-declarations", {
    files: {
      "index.css": /* css */ `
        .card {
          view-transition-name: hero;
          view-transition-class: slide fade;
          view-transition-group: hero;
        }

        .page {
          view-transition-name: NONE;
          view-transition-class: none;
          view-transition-group: NEAREST;
        }

        .root {
          view-transition-name: match-element;
          view-transition-group: contain;
        }

        .invalid {
          view-transition-name: 1px;
          view-transition-class: slide none;
          view-transition-group: var(--group);
        }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        "/* index.css */
        .card {
          view-transition-name: hero;
          view-transition-class: slide fade;
          view-transition-group: hero;
        }

        .page {
          view-transition-name: none;
          view-transition-class: none;
          view-transition-group: nearest;
        }

        .root {
          view-transition-name: match-element;
          view-transition-group: contain;
        }

        .invalid {
          view-transition-name: 1px;
          view-transition-class: slide none;
          view-transition-group: var(--group);
        }
        "
      `);
    },
  });

  // `::view-transition-group-children()` (css-view-transitions-2) takes the
  // same argument as `::view-transition-group()`. It must not warn.
  // https://github.com/oven-sh/bun/issues/42777
  test("::view-transition-group-children() is a known pseudo-element (#42777)", async () => {
    using dir = tempDir("css-42777", {
      "in.css": `
        ::view-transition-group-children(hero) { overflow: clip }
        ::view-transition-group-children(.big) { overflow: clip }
        ::view-transition-group-children(*) { overflow: visible }
        ::view-transition-group-children(hero):only-child { overflow: visible }
      `,
    });
    const result = await Bun.build({
      entrypoints: [path.join(String(dir), "in.css")],
      minify: true,
      throw: true,
    });
    expect(result.logs.map(String)).toEqual([]);
    const out = await result.outputs[0].text();
    expect(out.trim()).toBe(
      "::view-transition-group-children(hero){overflow:clip}::view-transition-group-children(.big){overflow:clip}::view-transition-group-children(*){overflow:visible}::view-transition-group-children(hero):only-child{overflow:visible}",
    );
  });
});
