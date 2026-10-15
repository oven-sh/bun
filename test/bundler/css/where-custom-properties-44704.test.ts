import { itBundled } from "../expectBundled";

// https://github.com/oven-sh/bun/issues/44704
// Two rules with the same selector that hold custom properties of different
// names are not duplicates. The minifier must keep both.
describe("css", () => {
  itBundled("css/where-custom-properties-different-names", {
    files: {
      "index.css": /* css */ `
        :where(.x){--a:1}:where(.x){--b:2}
        :where(.x) .y{--c:1}:where(.x) .y{--d:2}
        .p{--e:1}.q{color:red}.p{--f:2}
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    minifySyntax: true,
    minifyWhitespace: true,
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        ":where(.x){--a:1}:where(.x){--b:2}:where(.x) .y{--c:1}:where(.x) .y{--d:2}.p{--e:1}.q{color:red}.p{--f:2}
        "
      `);
    },
  });

  itBundled("css/where-custom-properties-same-names", {
    files: {
      "index.css": /* css */ `
        :where(.x){--a:1}:where(.x){--a:2}
        .p{--e:1}.q{color:red}.p{--e:2}
      `,
    },
    outdir: "/out",
    entryPoints: ["/index.css"],
    minifySyntax: true,
    minifyWhitespace: true,
    onAfterBundle(api) {
      api.expectFile("/out/index.css").toMatchInlineSnapshot(`
        ":where(.x){--a:2}.q{color:red}.p{--e:2}
        "
      `);
    },
  });
});
