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
        ::view-transition-group-children(hero.big) { overflow: clip }
        ::view-transition-group-children(*.big.slow) { overflow: clip }
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
      [
        "::view-transition-group-children(hero){overflow:clip}",
        "::view-transition-group-children(.big){overflow:clip}",
        "::view-transition-group-children(hero.big){overflow:clip}",
        "::view-transition-group-children(*.big.slow){overflow:clip}",
        "::view-transition-group-children(*){overflow:visible}",
        "::view-transition-group-children(hero):only-child{overflow:visible}",
      ].join(""),
    );
  });

  // `:active-view-transition`, `:active-view-transition-type()` and the
  // `@view-transition` rule are in css-view-transitions-2. They must not warn.
  // A CSS module prints the same text: it does not hash a view transition type.
  // https://github.com/oven-sh/bun/issues/42777
  describe.each(["in.css", "in.module.css"])("%s", name => {
    test(":active-view-transition-type() and @view-transition do not warn (#42777)", async () => {
      using dir = tempDir("css-42777-types", {
        [name]: `
          :root:active-view-transition { color: blue }
          :root:active-view-transition-type(slide-in, reverse) { color: red }
          :root:ACTIVE-VIEW-TRANSITION-TYPE( Forwards ) { color: green }
          :root:active-view-transition-type(default, initial) { color: teal }
          @view-transition { navigation: auto; types: slide-in reverse }
          @VIEW-TRANSITION { NAVIGATION: NONE; TYPES: NONE }
          @media (prefers-reduced-motion: no-preference) {
            @view-transition { navigation: auto }
          }
        `,
      });
      const result = await Bun.build({
        entrypoints: [path.join(String(dir), name)],
        minify: true,
        throw: true,
      });
      expect(result.logs.map(String)).toEqual([]);
      const out = await result.outputs[0].text();
      expect(out.trim()).toBe(
        ":root:active-view-transition{color:#00f}" +
          ":root:active-view-transition-type(slide-in,reverse){color:red}" +
          ":root:active-view-transition-type(Forwards){color:green}" +
          ":root:active-view-transition-type(default,initial){color:teal}" +
          "@view-transition{navigation:auto;types:slide-in reverse}" +
          "@view-transition{navigation:none;types:none}" +
          "@media (prefers-reduced-motion:no-preference){@view-transition{navigation:auto}}",
      );

      // The printed text parses back to the same rules.
      const printed = path.join(String(dir), "printed-" + name);
      await Bun.write(printed, out);
      const again = await Bun.build({ entrypoints: [printed], minify: true, throw: true });
      expect(again.logs.map(String)).toEqual([]);
      expect(await again.outputs[0].text()).toBe(out);
    });
  });

  itBundled("css/view-transition-rule-and-types", {
    files: {
      "index.css": /* css */ `
        :root:active-view-transition-type(slide-in, reverse) {
          color: red;
        }

        @view-transition { navigation: auto; types: slide-in reverse }
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        "/* index.css */
        :root:active-view-transition-type(slide-in, reverse) {
          color: red;
        }

        @view-transition {
          navigation: auto;
          types: slide-in reverse;
        }
        "
      `);
    },
  });

  // A descriptor that the grammar does not know, or a value that it rejects,
  // is printed as written. This is the output the rule had before it was parsed.
  test("@view-transition keeps descriptors that it cannot parse", async () => {
    using dir = tempDir("css-view-transition-unparsed", {
      "in.css": `
        @view-transition { navigation: sideways; types: a, b; future-descriptor: 1 2 }
        @view-transition { navigation: auto none; types: none a; types: a none; types: default }
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
      "@view-transition{navigation:sideways;types:a,b;future-descriptor:1 2}" +
        "@view-transition{navigation:auto none;types:none a;types:a none;types:default}",
    );
  });

  // No browser takes these. The build fails, as it does for `:dir(sideways)`
  // or for `@font-face` in a style rule.
  describe.each([
    ["a:active-view-transition-type() { color: red }", "Unexpected end of input"],
    ["a:active-view-transition-type(a b) { color: red }", "Unexpected token: b"],
    ["a:active-view-transition-type(a,) { color: red }", "Unexpected end of input"],
    ["a:active-view-transition-type(*) { color: red }", "Unexpected token: *"],
    ['a:active-view-transition-type("a") { color: red }', 'Unexpected token: "a"'],
    ["a { @view-transition { navigation: auto } }", "Unknown at-rule @view-transition"],
    ["@view-transition foo { navigation: auto }", "Unexpected token: foo"],
    ["@view-transition;", "Unexpected token: ;"],
  ])("%s", (source, message) => {
    test("is an error", async () => {
      using dir = tempDir("css-view-transition-invalid", { "in.css": source });
      const result = await Bun.build({
        entrypoints: [path.join(String(dir), "in.css")],
        throw: false,
      });
      expect(result.logs.map(log => [log.level, log.message])).toEqual([["error", message]]);
      expect(result.success).toBe(false);
    });
  });
});
