// Bundle tests are tests concerning bundling bugs that only occur in DevServer.
import { expect } from "bun:test";
import { MAX_PATH_BYTES } from "harness";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Dev, devTest, emptyHtmlFile, minimalFramework } from "../bake-harness";

devTest("import identifier doesnt get renamed", {
  framework: minimalFramework,
  files: {
    "db.ts": `export const abc = "123";`,
    "routes/index.ts": `
      import { abc } from '../db';
      export default function (req, meta) {
        let v1 = "";
        const v2 = v1
          ? abc.toFixed(2)
          : abc.toString();
        return new Response('Hello, ' + v2 + '!');
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("Hello, 123!");
    await dev.write("db.ts", `export const abc = "456";`);
    await dev.fetch("/").equals("Hello, 456!");
    await dev.patch("routes/index.ts", {
      find: "Hello",
      replace: "Bun",
    });
    await dev.fetch("/").equals("Bun, 456!");
  },
});
devTest("symbol collision with import identifier", {
  framework: minimalFramework,
  files: {
    "db.ts": `export const abc = "123";`,
    "routes/index.ts": `
      let import_db = 987;
      import { abc } from '../db';
      export default function (req, meta) {
        let v1 = "";
        const v2 = v1
          ? abc.toFixed(2)
          : abc.toString();
        return new Response('Hello, ' + v2 + ', ' + import_db + '!');
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("Hello, 123, 987!");
    await dev.write("db.ts", `export const abc = "456";`);
    await dev.fetch("/").equals("Hello, 456, 987!");
  },
});
devTest('uses "development" condition', {
  framework: minimalFramework,
  files: {
    "node_modules/example/package.json": JSON.stringify({
      name: "example",
      version: "1.0.0",
      exports: {
        ".": {
          development: "./development.js",
          default: "./production.js",
        },
      },
    }),
    "node_modules/example/development.js": `export default "development";`,
    "node_modules/example/production.js": `export default "production";`,
    "routes/index.ts": `
      import environment from 'example';
      export default function (req, meta) {
        return new Response('Environment: ' + environment);
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("Environment: development");
  },
});
devTest("importing a file before it is created", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { abc } from './second';
      console.log('value: ' + abc);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: [`index.ts:1:21: error: Could not resolve: "./second"`],
    });

    await c.expectReload(async () => {
      await dev.write("second.ts", `export const abc = "456";`);
    });

    await c.expectMessage("value: 456");
  },
});
// After a failed resolution, the dev server evicts the specifier's path and its parent from the
// resolver's directory cache. Here one of those two paths ends in a slash.
devTest("recovers from an unresolved import of a path that ends in a slash", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { abc } from './second/';
      console.log('value: ' + abc);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: [`index.ts:1:21: error: Could not resolve: "./second/"`],
    });

    for (const specifier of [
      dev.join("second") + path.sep,
      // This path's parent is `<root>/`.
      dev.rootDir + path.sep + path.sep + "second",
    ]) {
      await dev.write("index.ts", `import ${JSON.stringify(specifier)};`, {
        errors: [`index.ts:1:8: error: Could not resolve: "${specifier}"`],
      });
    }

    await c.expectReload(async () => {
      await dev.write("index.ts", `console.log('value: ' + 789);`);
    });
    await c.expectMessage("value: 789");
  },
});
devTest("default export same-scope handling", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import.meta.hot.accept();
      await import("./fixture1.ts"); 
      console.log((new ((await import("./fixture2.ts")).default)).a); 
      await import("./fixture3.ts"); 
      console.log((new ((await import("./fixture4.ts")).default)).result); 
      console.log((await import("./fixture5.ts")).default);
      console.log((await import("./fixture6.ts")).default);
      console.log((await import("./fixture7.ts")).default());
      console.log((await import("./fixture8.ts")).default());
      console.log((await import("./fixture9.ts")).default(false));
    `,
    "fixture1.ts": `
      const sideEffect = () => "a";
      export default class A {
        [sideEffect()] = "ONE";
      }
      console.log(new A().a);
    `,
    "fixture2.ts": `
      const sideEffect = () => "a";
      export default class A {
        [sideEffect()] = "TWO";
      }
    `,
    "fixture3.ts": `
      export default class A {
        result = "THREE"
      }
      console.log(new A().result);
    `,
    "fixture4.ts": `
      import.meta.hot.accept();
      export default class MOVE {
        result = "FOUR"
      }
    `,
    "fixture5.ts": `
      const default_export = "FIVE";
      export default default_export;
    `,
    "fixture6.ts": `
      const default_export = "S";
      function sideEffect() {
        return default_export + "EVEN";
      }
      export default sideEffect();
      console.log(default_export + "IX");
    `,
    "fixture7.ts": `
      export default function() { return "EIGHT" };
    `,
    "fixture8.ts": `
      import.meta.hot.accept();
      export default function MOVE() { return "NINE" };
    `,
    "fixture9.ts": `
      export default function named(flag = true) { return flag ? "TEN" : "ELEVEN" };
      console.log(named());
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", { storeHotChunks: true });
    c.expectMessage(
      //
      "ONE",
      "TWO",
      "THREE",
      "FOUR",
      "FIVE",
      "SIX",
      "SEVEN",
      "EIGHT",
      "NINE",
      "TEN",
      "ELEVEN",
    );

    const filesExpectingMove = Object.entries(dev.options.files)
      .filter(([, content]) => content.includes("MOVE"))
      .map(([path]) => path);
    for (const file of filesExpectingMove) {
      await dev.writeNoChanges(file);
      const chunk = await c.getMostRecentHmrChunk();
      expect(chunk).toMatch(/default:\s*(function|class)\s*MOVE/);
    }

    await dev.writeNoChanges("fixture7.ts");
    const chunk = await c.getMostRecentHmrChunk();
    expect(chunk).toMatch(/default:\s*function/);

    // Since fixture7.ts is not marked as accepting, it will bubble the update
    // to `index.ts`, re-evaluate it and some of the dependencies.
    c.expectMessage("TWO", "FOUR", "FIVE", "SEVEN", "EIGHT", "NINE", "ELEVEN");
  },
});
// An anonymous `export default class` that cannot be moved into the exports
// object (it has an `extends` clause, a static block, or a computed key) has to
// stay a class statement, which needs a name. It used to crash the dev server
// with `called Option::unwrap() on a None value` while visiting the file.
devTest("anonymous export default class that must stay a statement", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import.meta.hot.accept();
      import { Base } from "./base";
      import Derived from "./derived";
      import StaticBlock from "./static-block";
      import ComputedKey from "./computed-key";
      console.log("extends: " + (new Derived() instanceof Base) + " " + new Derived().tag);
      console.log("static block: " + StaticBlock.initialized);
      console.log("computed key: " + new ComputedKey().computed);
    `,
    "base.ts": `
      export class Base {
        tag = "base";
      }
    `,
    "derived.ts": `
      import { Base } from "./base";
      export default class extends Base {
        tag = "derived";
      }
    `,
    "static-block.ts": `
      export default class {
        static initialized = false;
        static {
          this.initialized = true;
        }
      }
    `,
    "computed-key.ts": `
      const key = "computed";
      export default class {
        [key] = "value";
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("extends: true derived", "static block: true", "computed key: value");

    await dev.patch("derived.ts", { find: '"derived"', replace: '"updated"' });
    await c.expectMessage("extends: true updated", "static block: true", "computed key: value");
  },
});
devTest("directory cache bust case #17576", {
  files: {
    "web/index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "web/index.ts": `
      console.log(123);
      import.meta.hot.accept();
    `,
  },
  mainDir: "server",
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(123);
    await c.expectNoWebSocketActivity(async () => {
      await dev.write(
        "web/Test.ts",
        `
          export const abc = 456;
        `,
      );
    });
    await dev.write(
      "web/index.ts",
      `
        import { abc } from "./Test.ts";
        console.log(abc);
      `,
    );
    await c.expectMessage(456);
  },
});
devTest("deleting imported file shows error then recovers", {
  skip: [
    "win32", // unlinkSync is having weird behavior
  ],
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { value } from "./other";
      console.log(value);
    `,
    "other.ts": `
      export const value = 123;
    `,
    "unrelated.ts": `
      export const value = 123;
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(123);
    await dev.delete("other.ts", {
      errors: ['index.ts:1:23: error: Could not resolve: "./other"'],
    });
    await c.expectReload(async () => {
      await dev.write(
        "other.ts",
        `
          export const value = 456;
        `,
      );
    });
    await c.expectMessage(456);
    await c.expectNoWebSocketActivity(async () => {
      await dev.delete("unrelated.ts");
    });
  },
});
// A parse task can find that its file is gone: the resolver still has the listing of the directory
// from before a delete or a rename, or a plugin gave the path. The build then fails each file that
// imports the file, as for an import that does not resolve.
//
// The build of /index lists src/. The rename is before any build reads the file, so no build sees the
// file go. The dev server watches src/ for the import that failed, and lists it again at the next change.
devTest("importing a file that was renamed before a build read it shows an error then finds the new file", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import "./src/listed";
      console.log("index");
    `,
    "src/listed.ts": `export {};`,
    "src/renamed.ts": `export const value = "ts";`,
    "second.html": emptyHtmlFile({ scripts: ["second.ts"] }),
    "second.ts": `
      import { value } from "./src/renamed";
      console.log("second: " + value);
    `,
  },
  async test(dev) {
    await dev.fetch("/index");
    fs.renameSync(dev.join("src/renamed.ts"), dev.join("src/renamed.tsx"));
    {
      await using c = await dev.client("/second", {
        errors: ['second.ts:1:23: error: Could not resolve: "./src/renamed"'],
      });
    }
    await dev.write("src/renamed.tsx", `export const value = "tsx";`);
    await using c = await dev.client("/second");
    await c.expectMessage("second: tsx");
  },
});
// The dev server does not watch node_modules, so most tests below delete a file there after a build
// listed its directory. Other tests use a plugin. When an onLoad returns nothing, the bundler reads
// the file then, so the onLoad can delete the file first.
const servePlugin = (htmlFiles: string[]) => ({
  "bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
  "bun.app.ts": `
    ${htmlFiles.map((file, i) => `import html${i} from "./${file}.html";`).join("\n    ")}

    globalThis.counts = {};
    export default {
      static: { ${htmlFiles.map((file, i) => `"/${file}": html${i}`).join(", ")} },
      fetch(req) {
        if (new URL(req.url).pathname === "/counts") return Response.json(globalThis.counts);
        return new Response("Not Found", { status: 404 });
      },
    };
  `,
});
{
  // The build of /listing lists node_modules/lib/.
  const listing = {
    "listing.html": emptyHtmlFile({ scripts: ["listing.ts"] }),
    "listing.ts": `
      import "./node_modules/lib/listed";
      console.log("listing");
    `,
    "node_modules/lib/listed.ts": `export {};`,
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
  };
  const deleteListed = async (dev: Dev, file: string) => {
    await dev.fetch("/listing");
    fs.unlinkSync(dev.join(file));
  };
  devTest("importing a file that was deleted after its directory was listed shows an error then recovers", {
    files: {
      ...listing,
      "index.ts": `
        import { value } from "./node_modules/lib/deleted";
        console.log("index: " + value);
      `,
      "node_modules/lib/deleted.ts": `export const value = 1;`,
    },
    async test(dev) {
      await deleteListed(dev, "node_modules/lib/deleted.ts");
      const errors = ['index.ts:1:23: error: Could not resolve: "./node_modules/lib/deleted"'];
      {
        await using c = await dev.client("/index", { errors });
      }
      await dev.output.waitForLine(/File not found ".*deleted\.ts"/);
      await using c = await dev.client("/index", { errors });
      // The dev server watches the directory of an import that failed.
      await c.expectReload(async () => {
        await dev.write("node_modules/lib/deleted.ts", `export const value = 2;`);
      });
      await c.expectMessage("index: 2");
    },
  });
  // TypeScript drops the first import, so its record is not used. The record still gets the source of
  // the stylesheet: it holds the path that the second import resolves to.
  devTest("an import that TypeScript drops adds no error for a deleted stylesheet", {
    files: {
      ...listing,
      "index.ts": `console.log("index");`,
      "node_modules/lib/deleted.css": `body { color: red; }`,
    },
    async test(dev) {
      const deleted = dev.join("node_modules/lib/deleted.css");
      const specifier = JSON.stringify(deleted);
      fs.writeFileSync(
        dev.join("index.ts"),
        `import { NotUsed } from ${specifier};\nimport ${specifier};\nconsole.log("index");\n`,
      );
      await deleteListed(dev, "node_modules/lib/deleted.css");
      await using c = await dev.client("/index", {
        errors: [`index.ts:2:8: error: Could not resolve: "${deleted}"`],
      });
    },
  });
  // The code catches the error of a file that never existed. The import() is of another module: a
  // plugin answers it with the path of the deleted file, as an external module.
  devTest("a require() in a try block of a file that was deleted after its directory was listed is not an error", {
    files: {
      ...servePlugin(["listing", "index"]),
      ...listing,
      "plugin.ts": `
        import path from "node:path";
        export default {
          name: "an external module at the path of the deleted file",
          setup(build) {
            build.onResolve({ filter: /^external-copy$/ }, () => ({
              path: path.join(import.meta.dir, "node_modules/lib/deleted.ts"),
              external: true,
            }));
          },
        };
      `,
      "index.ts": `
        let value;
        try {
          value = require("./node_modules/lib/deleted").value;
        } catch (error) {
          value = error.message;
        }
        export const load = () => import("external-copy");
        console.log("index: " + value);
      `,
      "node_modules/lib/deleted.ts": `export const value = "required";`,
    },
    htmlFiles: [],
    async test(dev) {
      await deleteListed(dev, "node_modules/lib/deleted.ts");
      await using c = await dev.client("/index");
      await c.expectMessage("index: Cannot require module ./node_modules/lib/deleted");
    },
  });
  // The bundler resolves an import that a plugin declines in another place, and gives it a source there.
  devTest("an import that an onResolve plugin declines and that resolves to a deleted file shows an error", {
    files: {
      ...servePlugin(["listing", "index"]),
      ...listing,
      "plugin.ts": `
        export default {
          name: "declines the import",
          setup(build) {
            build.onResolve({ filter: /deleted$/ }, () => {
              globalThis.counts.onResolve = (globalThis.counts.onResolve ?? 0) + 1;
              return undefined;
            });
          },
        };
      `,
      "index.ts": `
        import { value } from "./node_modules/lib/deleted";
        console.log("index: " + value);
      `,
      "node_modules/lib/deleted.ts": `export const value = 1;`,
    },
    htmlFiles: [],
    async test(dev) {
      await deleteListed(dev, "node_modules/lib/deleted.ts");
      {
        await using c = await dev.client("/index", {
          errors: ['index.ts:1:23: error: Could not resolve: "./node_modules/lib/deleted"'],
        });
      }
      expect(await dev.fetch("/counts").json()).toEqual({ onResolve: 1 });
    },
  });
}
// The plugin deletes the file when the bundler has resolved the import and has not read the file.
// As for a file that never existed, the import is an error also when the code never runs it.
devTest("an import() of a file that is deleted before it is read shows an error then recovers", {
  files: {
    ...servePlugin(["index"]),
    "plugin.ts": `
      import fs from "node:fs";
      let deleted = false;
      export default {
        name: "deletes late.ts before the bundler reads it",
        setup(build) {
          build.onLoad({ filter: /[\\\\/]lib[\\\\/]late\\.ts$/ }, args => {
            if (deleted) return;
            deleted = true;
            fs.unlinkSync(args.path);
          });
        },
      };
    `,
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      export const load = () => import("./node_modules/lib/late");
      console.log("index");
    `,
    "node_modules/lib/late.ts": `export const value = 1;`,
  },
  htmlFiles: [],
  async test(dev) {
    await using c = await dev.client("/index", {
      errors: ['index.ts:1:34: error: Could not resolve: "./node_modules/lib/late"'],
    });
    await c.expectReload(async () => {
      await dev.write("node_modules/lib/late.ts", `export const value = 2;`);
    });
    await c.expectMessage("index");
  },
});
devTest("an import that an onResolve plugin resolves to a file that does not exist shows an error", {
  files: {
    ...servePlugin(["index"]),
    "plugin.ts": `
      import path from "node:path";
      export default {
        name: "resolves to a file that does not exist",
        setup(build) {
          build.onResolve({ filter: /^virtual$/ }, () => {
            globalThis.counts.onResolve = (globalThis.counts.onResolve ?? 0) + 1;
            return { path: path.join(import.meta.dir, "does-not-exist.ts") };
          });
        },
      };
    `,
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { value } from "virtual";
      console.log("index: " + value);
    `,
  },
  htmlFiles: [],
  async test(dev) {
    {
      await using c = await dev.client("/index", {
        errors: ['index.ts:1:23: error: Could not resolve: "virtual". Maybe you need to "bun install"?'],
      });
    }
    await dev.output.waitForLine(/File not found ".*does-not-exist\.ts"/);
    expect(await dev.fetch("/counts").json()).toEqual({ onResolve: 1 });
  },
});
// The resolver finds ./data, so a watch for the specifier builds index.ts again at each change in
// its directory. The watch is for the file that the plugin gave.
devTest("an import that a plugin resolves to a missing file is built again when that file is created", {
  files: {
    ...servePlugin(["index"]),
    "plugin.ts": `
      import path from "node:path";
      export default {
        name: "resolves ./data to a generated file",
        setup(build) {
          build.onResolve({ filter: /^\\.\\/data$/ }, () => {
            globalThis.counts.onResolve = (globalThis.counts.onResolve ?? 0) + 1;
            return { path: path.join(import.meta.dir, "generated/data.ts") };
          });
        },
      };
    `,
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { value } from "./data";
      console.log("index: " + value);
    `,
    "data.ts": `export const value = "not generated";`,
    "generated/.keep": ``,
  },
  htmlFiles: [],
  async test(dev) {
    const errors = ['index.ts:1:23: error: Could not resolve: "./data"'];
    await using c = await dev.client("/index", { errors });
    await dev.write("unrelated.txt", "a change in the directory of index.ts", { errors });
    expect(await dev.fetch("/counts").json()).toEqual({ onResolve: 1 });
    await c.expectReload(async () => {
      await dev.write("generated/data.ts", `export const value = "generated";`);
    });
    await c.expectMessage("index: generated");
  },
});
// second.css is new in the build of /second, and its @import is the first to read the deleted
// stylesheet. The dev server then loads first.css again, which imports it from an earlier build.
// Its onLoad writes the stylesheet back, so first.css gets the source that second.css needs.
devTest("a stylesheet that was not there to read and that another stylesheet finds again is bundled", {
  files: {
    ...servePlugin(["first", "second"]),
    "plugin.ts": `
      import fs from "node:fs";
      import path from "node:path";
      const colors = path.join(import.meta.dir, "node_modules/theme/colors.css");
      export default {
        name: "writes the stylesheet back",
        setup(build) {
          build.onLoad({ filter: /first\\.css$/ }, () => {
            if (!fs.existsSync(colors)) fs.writeFileSync(colors, ".theme { color: blue; }");
          });
        },
      };
    `,
    "first.html": emptyHtmlFile({ styles: ["first.css"] }),
    "second.html": emptyHtmlFile({ styles: ["second.css"] }),
    "first.css": `@import "./node_modules/theme/colors.css";\n.first { color: green; }\n`,
    "second.css": `@import "./node_modules/theme/colors.css";\n.second { color: green; }\n`,
    "node_modules/theme/colors.css": `.theme { color: red; }`,
  },
  htmlFiles: [],
  async test(dev) {
    await using first = await dev.client("/first");
    await first.style(".theme").color.expect.toBe("red");
    fs.unlinkSync(dev.join("node_modules/theme/colors.css"));
    await using second = await dev.client("/second");
    await second.style(".theme").color.expect.toBe("#00f");
    await second.style(".second").color.expect.toBe("green");
  },
});
// The build of /first keeps the image. In the build of /second, the script gets the kept image and
// the stylesheet reads the file. Each file that names the image fails, also when it read nothing.
for (const last of ["second.ts", "second.css"]) {
  devTest(`a script and a stylesheet fail for an image that was deleted, and ${last} loads last`, {
    files: {
      ...servePlugin(["first", "second"]),
      "plugin.ts": `
        export default {
          name: "loads one file after every other file",
          setup(build) {
            build.onLoad({ filter: /${last.replace(".", "\\\\.")}$/ }, async args => {
              await args.defer();
            });
          },
        };
      `,
      ...Object.fromEntries(
        ["first", "second"].flatMap(name => [
          [`${name}.html`, emptyHtmlFile({ scripts: [`${name}.ts`], styles: [`${name}.css`] })],
          [`${name}.ts`, `import img from "./node_modules/lib/img.svg";\nconsole.log("${name}: " + typeof img);\n`],
          [`${name}.css`, `body {\n  background: url("./node_modules/lib/img.svg");\n}\n`],
        ]),
      ),
      "node_modules/lib/img.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>`,
    },
    htmlFiles: [],
    async test(dev) {
      await dev.fetch("/first");
      fs.unlinkSync(dev.join("node_modules/lib/img.svg"));
      await using c = await dev.client("/second", {
        errors: [
          'first.css:2:15: error: Could not resolve: "./node_modules/lib/img.svg"',
          'first.ts:1:17: error: Could not resolve: "./node_modules/lib/img.svg"',
          'second.css:2:15: error: Could not resolve: "./node_modules/lib/img.svg"',
          'second.ts:1:17: error: Could not resolve: "./node_modules/lib/img.svg"',
        ],
      });
      await c.expectReload(async () => {
        await dev.write("node_modules/lib/img.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>`);
      });
      await c.expectMessage("second: string");
    },
  });
}
// Without a separate SSR graph, the server bundle keeps a "use client" module
// and the parser wraps its exported values in `registerClientReference(value,
// file, name)`. The parser chose `file` by the JSX development flag. A
// `@jsxRuntime react-jsx` pragma turns that flag off for one file, and the
// parser then aborted the process in a branch that was written for production
// builds.
devTest('a "use client" module with a @jsxRuntime pragma keeps its client references', {
  framework: minimalFramework,
  files: {
    "components/Button.ts": `
      "use client";
      export function Button() {}
      export const label = "label";
      export default class Panel {}
    `,
    "routes/index.ts": `
      import Panel, { Button, label } from '../components/Button';
      export default function (req, meta) {
        return Response.json(
          [Panel, Button, label].map(ref => ({ file: ref.file.replaceAll("\\\\", "/"), uid: ref.uid })),
        );
      }
    `,
  },
  async test(dev) {
    const references = [
      { file: "components/Button.ts", uid: "default" },
      { file: "components/Button.ts", uid: "Button" },
      { file: "components/Button.ts", uid: "label" },
    ];
    await dev.fetch("/").equals(references);

    await dev.write(
      "components/Button.ts",
      `
        "use client";
        /** @jsxRuntime react-jsx */
        export function Button() {}
        export const label = "label";
        export default class Panel {}
      `,
    );
    await dev.fetch("/").equals(references);
  },
});
for (const count of [4, 9]) {
  const ids = Array.from({ length: count }, (_, i) => i);
  devTest(`a page that imports ${count} "use client" modules`, {
    framework: minimalFramework,
    files: {
      ...Object.fromEntries(ids.map(i => [`components/c${i}.ts`, `"use client";\nexport default function C${i}() {}`])),
      "routes/index.ts": `
        ${ids.map(i => `import c${i} from "../components/c${i}";`).join("\n")}
        export default function () {
          return Response.json([${ids.map(i => `c${i}`).join(", ")}].map(ref => ref.file.replaceAll("\\\\", "/")));
        }
      `,
    },
    async test(dev) {
      await dev.fetch("/").equals(ids.map(i => `components/c${i}.ts`));
    },
  });
}
devTest("repairing a missing import in a framework without server components", {
  framework: { fileSystemRouterTypes: minimalFramework.fileSystemRouterTypes },
  files: {
    "routes/index.ts": `
      import "./does-not-exist";
      export default function () {
        return new Response("index");
      }
    `,
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(500);
    await dev.write(
      "routes/index.ts",
      `
        export default function () {
          return new Response("index");
        }
      `,
    );
    await dev.fetch("/").equals("index");
  },
});
// Regression test: DirectoryWatchStore.Dep.source_file_path borrows the key
// string from IncrementalGraph.bundled_files. When a client-component boundary
// is demoted (its "use client" directive is removed) the server graph calls
// client_graph.disconnectAndDeleteFile which frees that key. Previously the
// Dep was left pointing at freed memory, and the next directory-watch event
// that re-resolved that Dep read it (use-after-free, caught by ASAN).
devTest("removing 'use client' from a component with a pending resolution failure", {
  // separateSSRGraph is required so the "use client" file is parsed with the
  // browser target; otherwise the resolution failure is attributed to the
  // server graph and the client-graph key is never borrowed.
  framework: {
    ...minimalFramework,
    serverComponents: {
      ...minimalFramework.serverComponents!,
      separateSSRGraph: true,
    },
  },
  files: {
    "routes/index.ts": `
      import * as Comp from '../components/Comp';
      import '../components/Sibling';
      export default function (req, meta) {
        return new Response('page: ' + (typeof Comp.marker));
      }
    `,
    "components/Comp.ts": `
      "use client";
      export const marker = "initial";
    `,
    // Sibling.ts keeps a second, stable client-graph Dep on the
    // components/ directory watch so the watch survives after the
    // Comp.ts-owned Dep is cleaned up.
    "components/Sibling.ts": `
      "use client";
      import './sibling-missing';
      export const sibling = 1;
    `,
  },
  async test(dev) {
    // Initial bundle: Comp.ts compiles cleanly as a client-component
    // boundary, so the server graph records is_client_component_boundary
    // and the client graph owns the key string for Comp.ts. Sibling.ts
    // fails to resolve './sibling-missing' under the browser target,
    // leaving a client-graph Dep on the components/ directory watch.
    await dev.fetch("/");

    // Re-bundle Comp.ts with a failing import while it is still a CCB.
    // With separateSSRGraph the re-parse runs under the browser target,
    // so trackResolutionFailure inserts a second Dep whose
    // source_file_path is the client graph's key for Comp.ts.
    await dev.write(
      "components/Comp.ts",
      `
        "use client";
        import { value } from './missing';
        export const marker = value;
      `,
      { errors: null },
    );

    // Drop the directive and the failing import so the server parse
    // succeeds. server_graph.receiveChunk now sees scb=false with
    // was_ccb=true and calls client_graph.disconnectAndDeleteFile, which
    // frees the key string that the Comp.ts Dep still references.
    await dev.write(
      "components/Comp.ts",
      `
        export const marker = "no-client";
      `,
      { errors: null },
    );

    // Create the previously-missing file. The components/ directory watch
    // is still alive (Sibling's Dep), so HotReloadEvent.processFileList
    // walks every Dep for components/ and dereferences each
    // source_file_path. Under ASAN the stale Comp.ts client-graph Dep is
    // a heap-use-after-free here and the dev server aborts.
    await dev.write("components/missing.ts", `export const value = "ok";`, { errors: null });

    // The server must still be alive and responding.
    const res = await dev.fetch("/");
    expect(res).toBeInstanceOf(Response);
  },
});
// The bundler has no transform for a module that starts with "use server".
// Bundling one used to abort the process from a bundler thread (the parser
// panics on `registerServerReference`), so saving a server-action file took
// down every route.
const useServerError = (file: string) => `${file}:1:1: error: "use server" is not supported yet`;
devTest('saving a "use server" module is a build error', {
  framework: minimalFramework,
  files: {
    "actions.ts": `
      export async function save() {
        return "saved";
      }
    `,
    "routes/index.ts": `
      import { save } from '../actions';
      export default async function (req, meta) {
        return new Response('Hello, ' + (await save()) + '!');
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("Hello, saved!");

    await dev.write(
      "actions.ts",
      `
        "use server";
        export async function save() {
          return "saved";
        }
      `,
    );
    {
      await using c = await dev.client("/", { errors: [useServerError("actions.ts")] });
    }

    await dev.write(
      "actions.ts",
      `
        export async function save() {
          return "saved again";
        }
      `,
    );
    await dev.fetch("/").equals("Hello, saved again!");
  },
});
devTest('a "use server" module that exists at startup is a build error', {
  framework: minimalFramework,
  files: {
    "actions.ts": `
      "use server";
      export async function save() {
        return "saved";
      }
    `,
    "routes/index.ts": `
      import { save } from '../actions';
      export default async function (req, meta) {
        return new Response('Hello, ' + (await save()) + '!');
      }
    `,
    "routes/other.ts": `
      export default function (req, meta) {
        return new Response('other');
      }
    `,
  },
  async test(dev) {
    {
      await using c = await dev.client("/", { errors: [useServerError("actions.ts")] });
    }
    // A route that does not import the module still works.
    await dev.fetch("/other").equals("other");
  },
});
// With a separate SSR graph, a "use server" module with nothing to wrap got
// past the parser and aborted on the bundler's main thread instead.
devTest('a "use server" module with no exports is a build error', {
  framework: {
    ...minimalFramework,
    serverComponents: {
      ...minimalFramework.serverComponents!,
      separateSSRGraph: true,
    },
  },
  files: {
    "setup.ts": `
      "use server";
      globalThis.didSetup = true;
    `,
    "routes/index.ts": `
      import '../setup';
      export default function (req, meta) {
        return new Response('setup: ' + globalThis.didSetup);
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", { errors: [useServerError("setup.ts")] });
  },
});
// The browser graph and the SSR graph bundle what a client component imports.
// Neither has the stubs that would call the server in place of the module.
devTest('a "use server" module imported by a client component is a build error', {
  framework: {
    ...minimalFramework,
    serverComponents: {
      ...minimalFramework.serverComponents!,
      separateSSRGraph: true,
    },
  },
  files: {
    "actions.ts": `
      "use server";
      export async function save() {
        return "saved";
      }
    `,
    "components/Comp.ts": `
      "use client";
      import { save } from '../actions';
      export function Button() {
        return save;
      }
    `,
    "routes/index.ts": `
      import * as Comp from '../components/Comp';
      export default function (req, meta) {
        return new Response('page: ' + (typeof Comp.Button));
      }
    `,
  },
  async test(dev) {
    {
      // One entry for each graph that bundles the module.
      await using c = await dev.client("/", {
        errors: [useServerError("actions.ts"), useServerError("actions.ts")],
      });
    }

    await dev.write(
      "actions.ts",
      `
        export async function save() {
          return "saved";
        }
      `,
    );
    await dev.fetch("/").equals("page: object");
  },
});
// Every loader got the scan for a use directive. A text file that starts with
// the same bytes hit the "use server" abort, or became a client component
// reference for "use client".
devTest("a file that is not JavaScript does not carry a use directive", {
  framework: {
    ...minimalFramework,
    serverComponents: {
      ...minimalFramework.serverComponents!,
      separateSSRGraph: true,
    },
  },
  files: {
    "actions.ts": `"use server"; export async function save() {}`,
    "server-note.txt": `"use server" marks the exports of a module as server actions.`,
    "client-note.txt": `"use client" marks a module as a client component.`,
    "routes/index.ts": `
      import source from '../actions.ts' with { type: 'text' };
      import serverNote from '../server-note.txt';
      import clientNote from '../client-note.txt';
      export default function (req, meta) {
        return new Response(JSON.stringify({ source, serverNote, clientNote }));
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals({
      source: `"use server"; export async function save() {}`,
      serverNote: `"use server" marks the exports of a module as server actions.`,
      clientNote: `"use client" marks a module as a client component.`,
    });
  },
});
// Counts how often each file matching `filter` is loaded. Loads for the client graph are counted separately.
const countLoads = (filter: string) => `
  import { basename } from "node:path";
  export default [
    {
      name: "count-loads",
      setup(build) {
        build.onLoad({ filter: /${filter}/ }, args => {
          const loads = (globalThis.loads ??= {});
          const file = basename(args.path) + (args.side === "client" ? " (client)" : "");
          loads[file] = (loads[file] ?? 0) + 1;
        });
      },
    },
  ];
`;
// `#name` resolves to `name-rsc.ts` in a graph with the "react-server" condition, and to `name-ssr.ts` otherwise.
const conditionalImport = (name: string) => ({
  "package.json": JSON.stringify({
    imports: { [`#${name}`]: { "react-server": `./${name}-rsc.ts`, "default": `./${name}-ssr.ts` } },
  }),
  [`${name}-rsc.ts`]: `export const which = "rsc";`,
  [`${name}-ssr.ts`]: `export const which = "ssr";`,
});
const oneServerGraph = { ...minimalFramework.serverComponents!, separateSSRGraph: false };
const separateSSRGraph = { ...minimalFramework.serverComponents!, separateSSRGraph: true };
// A failed import belongs to the importing file's graph.
// `#cond` shows which graphs bundle the page.
{
  const page = `
    import { which } from "#cond";
    export default function () {
      return Response.json({ which, loads: globalThis.loads });
    }
  `;
  for (const { name, serverComponents, failedImport, which } of [
    { name: "no server components", serverComponents: undefined, failedImport: `import "./missing";`, which: "ssr" },
    {
      name: "separate SSR graph",
      serverComponents: separateSSRGraph,
      failedImport: `import "./missing";`,
      which: "rsc",
    },
    {
      name: "bunBakeGraph attribute without an SSR graph",
      serverComponents: oneServerGraph,
      failedImport: `import "../other.ts" with { bunBakeGraph: "ssr" };`,
      which: "rsc",
    },
  ]) {
    devTest(`bundles a page once per save after a failed import (${name})`, {
      framework: { fileSystemRouterTypes: minimalFramework.fileSystemRouterTypes, serverComponents },
      pluginFile: countLoads("(routes.index|cond-(rsc|ssr))[.]ts$"),
      files: {
        ...conditionalImport("cond"),
        "other.ts": `export default 1;`,
        "routes/index.ts": failedImport + page,
      },
      async test(dev) {
        expect((await dev.fetch("/")).status).toBe(500);
        await dev.write("routes/index.ts", page);
        expect(await dev.fetch("/").json()).toEqual({ which, loads: { "index.ts": 2, [`cond-${which}.ts`]: 1 } });
        await dev.write("routes/index.ts", page + "// saved again");
        expect(await dev.fetch("/").json()).toEqual({ which, loads: { "index.ts": 3, [`cond-${which}.ts`]: 1 } });
        // The page still depends on the file that its graph resolved.
        await dev.write(`cond-${which}.ts`, `export const which = ;`);
        expect((await dev.fetch("/")).status).toBe(500);
      },
    });
  }
}
// A file must not move to a graph that doesn't bundle it. shared.ts is in the server
// and SSR graphs. ssr-only.ts is only in the SSR graph.
{
  const files = {
    ...conditionalImport("only"),
    "routes/index.ts": `
      import "../shared";
      import "../Comp";
      export default function () {
        return Response.json(globalThis.loads);
      }
    `,
    "Comp.ts": `
      "use client";
      import "./shared";
      import "./ssr-only";
      export const marker = 1;
    `,
  };
  const shared = (n: number) => `export const shared = ${n};`;
  const ssrOnly = (n: number) => `import "#only"; export const ssrOnly = ${n};`;
  const oncePerGraph = { "shared.ts": 2, "shared.ts (client)": 1, "ssr-only.ts": 1, "ssr-only.ts (client)": 1 };
  const difference = (before: Record<string, number>, after: Record<string, number>) =>
    Object.fromEntries(
      Object.keys(after)
        .filter(file => after[file] !== before[file])
        .map(file => [file, after[file] - (before[file] ?? 0)]),
    );
  devTest("bundles a file once per graph per save after its import is deleted and restored", {
    skip: [
      "win32", // unlinkSync is having weird behavior
    ],
    framework: { ...minimalFramework, serverComponents: separateSSRGraph },
    pluginFile: countLoads("(shared|ssr-only|only-rsc|only-ssr)[.]ts$"),
    files: {
      ...files,
      "shared.ts": `import "./leaf"; ${shared(1)}`,
      "ssr-only.ts": `import "./leaf"; ${ssrOnly(1)}`,
      "leaf.ts": `export const leaf = 1;`,
    },
    async test(dev) {
      await dev.fetch("/");
      await dev.delete("leaf.ts", { errors: null });
      await dev.write("leaf.ts", `export const leaf = 2;`);
      const restored = await dev.fetch("/").json();
      expect(restored).toEqual({
        "shared.ts": 6,
        "shared.ts (client)": 3,
        "ssr-only.ts": 3,
        "ssr-only.ts (client)": 3,
        "only-ssr.ts": 1,
        "only-ssr.ts (client)": 1,
      });
      await dev.write("shared.ts", `import "./leaf"; ${shared(2)}`);
      await dev.write("ssr-only.ts", `import "./leaf"; ${ssrOnly(2)}`);
      expect(difference(restored, await dev.fetch("/").json())).toEqual(oncePerGraph);
    },
  });
  devTest("bundles a module with a previously failed import for the SSR graph when a second route imports it", {
    framework: { ...minimalFramework, serverComponents: separateSSRGraph },
    files: {
      "shared.ts": `
        import "./missing";
        export const shared = "shared";
      `,
      "routes/index.ts": `
        import { shared } from "../shared";
        export default function () {
          return new Response("index " + shared);
        }
      `,
      "routes/other.ts": `
        import { shared } from "../shared" with { bunBakeGraph: "ssr" };
        export default function () {
          return new Response("other " + shared);
        }
      `,
    },
    async test(dev) {
      expect((await dev.fetch("/")).status).toBe(500);
      await dev.write("shared.ts", `export const shared = "shared";`);
      await dev.fetch("/").equals("index shared");
      await dev.fetch("/other").equals("other shared");
    },
  });
}
devTest("build error in a file imported by a 'use client' component", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
      import * as Comp from "../Comp";
      export default function (req, meta) {
        return new Response(typeof Comp.Button);
      }
    `,
    "routes/manifest.ts": `
      import { serverManifest } from "bun:bake/server";
      export default function (req, meta) {
        return Response.json(Object.keys(serverManifest).sort());
      }
    `,
    "Comp.ts": `
      "use client";
      export * from "./inner";
      import { save } from "./actions";
      export function Button() { return save; }
    `,
    "inner.ts": `
      export const Inner = 1;
    `,
    "actions.ts": `
      export function save() { return 1 +; }
    `,
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(500);
    // Comp.ts is registered even though it can't be evaluated yet.
    expect(await dev.fetch("/manifest").json()).toEqual(["Comp.ts#Button", "Comp.ts#Inner"]);
    await dev.write("actions.ts", `export function save() { return 1; }`);
    await dev.fetch("/").equals("object");
  },
});
devTest("deinit with a free-list slot in DirectoryWatchStore.dependencies", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    // Import-record order is source order, so trackResolutionFailure is
    // called for ./sub/a first (dep index 0) and ./sub/b second (dep index 1).
    "index.ts": `
      import './sub/a';
      import './sub/b';
      export {};
    `,
    // sub/ must exist for the directory watch to be opened.
    "sub/placeholder.ts": `export {};`,
  },
  async test(dev) {
    // Initial bundle: both imports fail and attach deps to the sub/ watch.
    await dev.fetch("/");

    {
      await using _ = await dev.batchChanges({ errors: null });
      // Rewrite index.ts so the rebuild has no failing imports and therefore
      // does not re-track anything (which would consume the free-list slot).
      await dev.write("index.ts", `export {};`);
      // Creating sub/a.ts fires the sub/ directory watch. Walking the dep
      // chain (LIFO: 1 then 0), dep 1 (./sub/b) still fails and is kept;
      // dep 0 (./sub/a) now resolves, so freeDependencyIndex(0) frees its
      // specifier and, because 0 != len-1, pushes index 0 onto
      // dependencies_free_list.
      await dev.write("sub/a.ts", `export {};`);
    }

    // The server should still respond.
    const res = await dev.fetch("/");
    expect(res).toBeInstanceOf(Response);

    // Test teardown sends graceful-exit, which calls DevServer.deinit.
    // Before the fix, deinit iterated every dependencies.items slot and
    // freed .specifier again for the free-list slot at index 0, tripping
    // AllocationScope's invalid-free panic.
  },
});
// Framework routes that import a file that is not there to read.
{
  const route = (imports: string, body: string) => `
    ${imports}
    export default function () {
      return new Response("index " + ${body});
    }
  `;
  const clientComponent = (imported: string) => ({
    "routes/index.ts": route(`import "../Comp";`, `"Comp"`),
    "Comp.ts": `
      "use client";
      import "./node_modules/lib/${imported}";
      export const marker = 1;
    `,
  });
  // The server graph reads shared.ts. The plugin deletes it before the client graph reads it.
  devTest('a file that only one graph of a "use client" module finds fails the other graph', {
    framework: { ...minimalFramework, serverComponents: oneServerGraph },
    pluginFile: `
      import fs from "node:fs";
      import { basename } from "node:path";
      // Resolves when the server graph has read shared.ts: it then loads what shared.ts imports.
      const serverReadShared = Promise.withResolvers();
      let deleted = false;
      export default [
        {
          name: "deletes shared.ts between the two graphs",
          setup(build) {
            build.onLoad({ filter: /[\\\\/]lib[\\\\/](shared|after)[.]ts$/ }, async args => {
              const file = basename(args.path);
              if (file === "after.ts" && args.side === "server") serverReadShared.resolve();
              if (file === "shared.ts" && args.side === "client" && !deleted) {
                deleted = true;
                await serverReadShared.promise;
                fs.unlinkSync(args.path);
              }
            });
          },
        },
      ];
    `,
    files: {
      ...clientComponent("shared"),
      "node_modules/lib/shared.ts": `import "./after";`,
      "node_modules/lib/after.ts": `export {};`,
    },
    async test(dev) {
      {
        await using c = await dev.client("/", {
          errors: ['Comp.ts:2:8: error: Could not resolve: "./node_modules/lib/shared"'],
        });
      }
      await dev.write("node_modules/lib/shared.ts", `import "./after";`);
      await dev.fetch("/").equals("index Comp");
    },
  });
  // The client graph and the SSR graph have shared.ts from the build of /. The save makes a file of
  // the server graph import it, and that file loads when Comp.ts has its imports.
  devTest("a file that only the server graphs do not find is not an error in the client graph", {
    framework: { ...minimalFramework, serverComponents: separateSSRGraph },
    // A request does not bundle the route again, so the page shows the errors of the build of the save.
    env: { BUN_ASSUME_PERFECT_INCREMENTAL: "1" },
    pluginFile: `
      export default [
        {
          name: "loads server-part.ts after every other file",
          setup(build) {
            build.onLoad({ filter: /server-part[.]ts$/ }, async args => {
              await args.defer();
            });
          },
        },
      ];
    `,
    files: {
      "routes/index.ts": route(`import "../Comp";\n    import "../server-part";`, `"Comp"`),
      "Comp.ts": clientComponent("shared")["Comp.ts"],
      "server-part.ts": `export {};`,
      "node_modules/lib/shared.ts": `export {};`,
    },
    async test(dev) {
      await dev.fetch("/").equals("index Comp");
      fs.unlinkSync(dev.join("node_modules/lib/shared.ts"));
      {
        await using batch = await dev.batchChanges({ errors: null });
        await dev.write(
          "Comp.ts",
          `
            "use client";
            import "./node_modules/lib/shared";
            export const marker = 2;
          `,
        );
        await dev.write("server-part.ts", `import "./node_modules/lib/shared";`);
      }
      await using c = await dev.client("/", {
        errors: [
          'Comp.ts:2:8: error: Could not resolve: "./node_modules/lib/shared"',
          'server-part.ts:1:8: error: Could not resolve: "./node_modules/lib/shared"',
        ],
      });
    },
  });
  // The two graphs have the barrel from the build of /. The build of /two reads it again for both,
  // because the dev server does not keep a barrel. The plugin gives the server graph the source, and
  // deletes the file before the client graph reads it.
  const barrelOfTwoGraphs = (restore: boolean) => ({
    framework: { ...minimalFramework, serverComponents: oneServerGraph },
    pluginFile: `
      import fs from "node:fs";
      let secondBuild = false;
      let serverLoads = 0;
      const serverHasSource = Promise.withResolvers();
      let deleted: string | undefined;
      export default [
        {
          name: "deletes the barrel between the two graphs of the second build",
          setup(build) {
            build.onLoad({ filter: /CompB[.]ts$/ }, () => {
              secondBuild = true;
            });
            build.onLoad({ filter: /[\\/]bar[\\/]index[.]js$/ }, async args => {
              if (args.side === "server") {
                const contents = fs.readFileSync(args.path, "utf8");
                if (++serverLoads === 2) serverHasSource.resolve();
                return { contents, loader: "js" };
              }
              if (!secondBuild || deleted !== undefined) return;
              await serverHasSource.promise;
              deleted = fs.readFileSync(args.path, "utf8");
              fs.unlinkSync(args.path);
            });
            // The dev server loads CompA.ts again, because it imports the file that is gone.
            build.onLoad({ filter: /CompA[.]ts$/ }, args => {
              if (${restore} && deleted !== undefined && args.side === "client") {
                fs.writeFileSync(args.path.replace("CompA.ts", "node_modules/bar/index.js"), deleted);
              }
            });
          },
        },
      ];
    `,
    files: {
      "routes/index.ts": route(`import "../CompA";`, `"A"`),
      "routes/two.ts": `
        import { a } from "bar";
        import "../CompB";
        export default function () {
          return new Response("two " + a);
        }
      `,
      ...Object.fromEntries(
        ["CompA", "CompB"].map(name => [
          `${name}.ts`,
          `"use client";\nimport { a } from "bar";\nexport const marker = a;\n`,
        ]),
      ),
      "node_modules/bar/package.json": JSON.stringify({ name: "bar", main: "./index.js", sideEffects: false }),
      "node_modules/bar/index.js": `export { a } from "./a.js";\nexport { b } from "./b.js";\n`,
      "node_modules/bar/a.js": `export const a = "A";`,
      "node_modules/bar/b.js": `export const b = "B";`,
    },
  });
  devTest('a barrel that only the client graph of a "use client" module does not find fails that graph', {
    ...barrelOfTwoGraphs(false),
    async test(dev) {
      await dev.fetch("/").equals("index A");
      await using c = await dev.client("/two", {
        errors: [
          'CompA.ts:2:19: error: Could not resolve: "bar". Maybe you need to "bun install"?',
          'CompB.ts:2:19: error: Could not resolve: "bar". Maybe you need to "bun install"?',
        ],
      });
    },
  });
  devTest('a barrel that is back when a "use client" module of an earlier build loads again is bundled', {
    ...barrelOfTwoGraphs(true),
    async test(dev) {
      await dev.fetch("/").equals("index A");
      await dev.fetch("/two").equals("two A");
    },
  });
  // The route has the server copy of the barrel when the SSR graph does not find the file.
  devTest("a barrel that only the SSR graph does not find fails the file of that graph", {
    framework: { ...minimalFramework, serverComponents: separateSSRGraph },
    // A request does not bundle the route again, so the page shows the errors of the build of the save.
    env: { BUN_ASSUME_PERFECT_INCREMENTAL: "1" },
    pluginFile: `
      import fs from "node:fs";
      let deleteAtNextLoad = false;
      export default [
        {
          name: "deletes the barrel before the SSR graph of the second build reads it",
          setup(build) {
            build.onLoad({ filter: /ssr-part[.]ts$/ }, async args => {
              if (!fs.readFileSync(args.path, "utf8").includes("saved")) return;
              await args.defer();
              deleteAtNextLoad = true;
            });
            build.onLoad({ filter: /[\\/]bar[\\/]index[.]js$/ }, args => {
              if (!deleteAtNextLoad) return;
              deleteAtNextLoad = false;
              fs.unlinkSync(args.path);
            });
          },
        },
      ];
    `,
    files: {
      "routes/index.ts": `
        import { a } from "bar";
        import { ssr } from "../ssr-part" with { bunBakeGraph: "ssr" };
        export default function () {
          return new Response("index " + a + " " + ssr);
        }
      `,
      "ssr-part.ts": `import { a } from "bar";\nexport const ssr = "ssr " + a;\n`,
      "node_modules/bar/package.json": JSON.stringify({ name: "bar", main: "./index.js", sideEffects: false }),
      "node_modules/bar/index.js": `export { a } from "./a.js";\nexport { b } from "./b.js";\n`,
      "node_modules/bar/a.js": `export const a = "A";`,
      "node_modules/bar/b.js": `export const b = "B";`,
    },
    async test(dev) {
      await dev.fetch("/").equals("index A ssr A");
      {
        await using batch = await dev.batchChanges({ errors: null });
        await dev.write(
          "routes/index.ts",
          `
            import { a } from "bar";
            import { ssr } from "../ssr-part" with { bunBakeGraph: "ssr" };
            export default function () {
              return new Response("saved " + a + " " + ssr);
            }
          `,
        );
        await dev.write("ssr-part.ts", `import { a } from "bar";\nexport const ssr = "ssr saved " + a;\n`);
      }
      await using c = await dev.client("/", {
        errors: ['ssr-part.ts:1:19: error: Could not resolve: "bar". Maybe you need to "bun install"?'],
      });
    },
  });
  // The read of late.ts fails. The onLoad of second.ts continues when every other module is loaded,
  // and writes late.ts back. second.ts then imports it.
  const lateOnce = {
    framework: { ...minimalFramework, serverComponents: separateSSRGraph },
    pluginFile: `
      import fs from "node:fs";
      import { basename } from "node:path";
      let late;
      export default [
        {
          name: "deletes late.ts before the first read and writes it back for the second",
          setup(build) {
            build.onLoad({ filter: /([\\/]lib[\\/]late|second)[.]ts$/ }, async args => {
              if (basename(args.path) === "second.ts") {
                await args.defer();
                fs.writeFileSync(late, 'export const value = "restored";');
              } else if (!late) {
                late = args.path;
                fs.unlinkSync(late);
              }
            });
          },
        },
      ];
    `,
  };
  const ssr = ` with { bunBakeGraph: "ssr" }`;
  const lateFiles = (routeImports: string, second?: string) => ({
    "routes/index.ts": route(routeImports, `value`),
    ...(second === undefined ? {} : { "second.ts": second }),
    "node_modules/lib/late.ts": `export const value = "first";`,
  });
  // The import of the route has a source again, for the same graph. The bundler keeps that source
  // for the graph of second.ts: the server graph, or the SSR graph.
  for (const { graph, second, secondImport } of [
    { graph: "server", second: `import "../second";`, secondImport: ssr },
    { graph: "SSR", second: `import "../second"${ssr};`, secondImport: `` },
  ]) {
    devTest(`a file that is back when a second file of the ${graph} graph imports it in the same build is bundled`, {
      ...lateOnce,
      files: lateFiles(
        `import { value } from "../node_modules/lib/late"${ssr};\n    ${second}`,
        `import "./node_modules/lib/late"${secondImport};`,
      ),
      async test(dev) {
        await dev.fetch("/").equals("index restored");
      },
    });
  }
  // second.ts gets the copy of the other graph. The import of the route still has no module.
  for (const [routeGraph, secondGraph] of [
    ["SSR", "server"],
    ["server", "SSR"],
  ]) {
    devTest(`a file that is back for the ${secondGraph} graph still fails an import for the ${routeGraph} graph`, {
      ...lateOnce,
      files: lateFiles(
        `import { value } from "../node_modules/lib/late"${routeGraph === "SSR" ? ssr : ""};\n    import "../second";`,
        `import "./node_modules/lib/late"${secondGraph === "SSR" ? ssr : ""};`,
      ),
      async test(dev) {
        expect((await dev.fetch("/")).status).toBe(500);
        await dev.fetch("/").equals("index restored");
        expect(dev.output.lines.join("\n")).toContain(`Could not resolve: "../node_modules/lib/late"`);
      },
    });
  }
  // mid.ts is a file of the SSR graph. The dev server bundles it again for that graph.
  devTest("a file of the SSR graph that imports a file that is deleted before it is read fails then recovers", {
    ...lateOnce,
    files: {
      ...lateFiles(`import { value } from "../mid"${ssr};`),
      "mid.ts": `export { value } from "./node_modules/lib/late";`,
    },
    async test(dev) {
      await dev.fetch("/").expect.not.toContain("Failed to load bundled module");
      {
        await using c = await dev.client("/", {
          errors: ['mid.ts:1:23: error: Could not resolve: "./node_modules/lib/late"'],
        });
      }
      await dev.write("node_modules/lib/late.ts", `export const value = "restored";`);
      await dev.fetch("/").equals("index restored");
    },
  });
  // The resolver lists node_modules/linked/ apart from the directory that it links to, so it gives
  // the deleted file a second time. The route already runs: a build that fails must not run it again.
  devTest("a route that imports a deleted file of a symlinked package fails and is not evaluated again", {
    skip: [
      "win32", // unlinkSync is having weird behavior
    ],
    framework: minimalFramework,
    // The link has to be there when the dev server first lists node_modules.
    pluginFile: `
      import { symlinkSync } from "node:fs";
      import { join } from "node:path";
      symlinkSync(join(import.meta.dir, "packages/linked"), join(import.meta.dir, "node_modules/linked"), "junction");
      export default [];
    `,
    files: {
      "packages/linked/package.json": JSON.stringify({ name: "linked", version: "1.0.0", main: "./index.js" }),
      "packages/linked/index.js": `export { value } from "./value.js";`,
      "packages/linked/value.js": `export const value = "linked";`,
      "node_modules/.keep": ``,
      "routes/index.ts": `
        import { value } from "linked";
        globalThis.evaluated = (globalThis.evaluated ?? 0) + 1;
        export default function () {
          return new Response("index " + value);
        }
      `,
      "routes/count.ts": `
        export default function () {
          return new Response("evaluated " + globalThis.evaluated);
        }
      `,
    },
    async test(dev) {
      await dev.fetch("/").equals("index linked");
      await dev.delete("packages/linked/index.js");
      expect((await dev.fetch("/")).status).toBe(500);
      await dev.fetch("/count").equals("evaluated 1");
      await dev.write("packages/linked/index.js", `export const value = "back";`);
      await dev.fetch("/").equals("index back");
      await dev.fetch("/count").equals("evaluated 2");
    },
  });
}
// The dev server skips a router type whose root doesn't exist.
devTest("reports a build error when an earlier router type has a missing root", {
  framework: {
    ...minimalFramework,
    fileSystemRouterTypes: ["missing", "routes"].map(root => ({ ...minimalFramework.fileSystemRouterTypes![0], root })),
  },
  files: {
    "routes/index.ts": "export default () => {",
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(500);
    await dev.write("routes/index.ts", `export default () => new Response("index");`);
    await dev.fetch("/").equals("index");
  },
});
// A file in both the server and SSR graphs shares one server-side record.
for (const [first, second] of [
  ["/", "/other"],
  ["/other", "/"],
]) {
  devTest(`bundles a module for the graph of ${second} after ${first} bundled it for its graph`, {
    framework: { ...minimalFramework, serverComponents: separateSSRGraph },
    files: {
      "shared.ts": `export const shared = "shared";`,
      "routes/index.ts": `
        import { shared } from "../shared";
        export default () => new Response("/ " + shared);
      `,
      "routes/other.ts": `
        import { shared } from "../shared" with { bunBakeGraph: "ssr" };
        export default () => new Response("/other " + shared);
      `,
    },
    async test(dev) {
      await dev.fetch(first).equals(first + " shared");
      await dev.fetch(second).equals(second + " shared");
    },
  });
}
devTest("importing html file", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import html from "./index.html";
      console.log(html);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: ["index.ts:1:18: error: Browser builds cannot import HTML files."],
    });
  },
});
devTest("importing html file with text loader (#18154)", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import html from "./app.html" with { type: "text" };
      console.log(html);
    `,
    "app.html": "<div>hello world</div>",
  },
  htmlFiles: ["index.html"],
  async test(dev) {
    await using c = await dev.client("/", {});
    await c.expectMessage("<div>hello world</div>");
  },
});
devTest("importing bun on the client", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import bun from "bun";
      console.log(bun);
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: ['index.ts:1:17: error: Browser build cannot import Bun builtin: "bun"'],
    });
  },
});
devTest("import.meta.main", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      console.log(import.meta.main);
      import.meta.hot.accept();
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(false); // import.meta.main is always false because there is no single entry point

    await dev.write(
      "index.ts",
      `
        require;
        console.log(import.meta.main);
      `,
    );
    await c.expectMessage(false);
  },
});
devTest("commonjs forms", {
  timeoutMultiplier: 2,
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import cjs from "./cjs.js";
      console.log(cjs);
    `,
    "cjs.js": `
      module.exports.field = {};
    `,
  },
  async test(dev) {
    console.log("Initial");
    await using c = await dev.client("/");
    console.log("  expecting message");
    await c.expectMessage({ field: {} });
    console.log("  expecting reload");
    await c.expectReload(async () => {
      console.log("  writing");
      await dev.write("cjs.js", `exports.field = "1";`);
      console.log("  now reloading");
    });
    console.log("  expecting message");
    await c.expectMessage({ field: "1" });
    console.log("Second");
    console.log("  expecting reload");
    await c.expectReload(async () => {
      console.log("  writing");
      await dev.write("cjs.js", `let theExports = exports; theExports.field = "2";`);
    });
    console.log("  expecting message");
    await c.expectMessage({ field: "2" });
    console.log("Third");
    console.log("  expecting reload");
    await c.expectReload(async () => {
      console.log("  writing");
      await dev.write("cjs.js", `let theModule = module; theModule.exports.field = "3";`);
    });
    console.log("  expecting message");
    await c.expectMessage({ field: "3" });
    console.log("Fourth");
    await c.expectReload(async () => {
      await dev.write("cjs.js", `let { exports } = module; exports.field = "4";`);
    });
    await c.expectMessage({ field: "4" });
    console.log("Fifth");
    await c.expectReload(async () => {
      await dev.write("cjs.js", `var { exports } = module; exports.field = "4.5";`);
    });
    await c.expectMessage({ field: "4.5" });
    console.log("Sixth");
    await c.expectReload(async () => {
      await dev.write("cjs.js", `let theExports = module.exports; theExports.field = "5";`);
    });
    await c.expectMessage({ field: "5" });
    console.log("Seventh");
    await c.expectReload(async () => {
      await dev.write("cjs.js", `require; eval("module.exports.field = '6'");`);
    });
    await c.expectMessage({ field: "6" });
  },
});

// --- Barrel optimization tests ---

devTest("barrel optimization skips unused submodules", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { Alpha } from 'barrel-lib';
      console.log('got: ' + Alpha);
    `,
    "node_modules/barrel-lib/package.json": JSON.stringify({
      name: "barrel-lib",
      version: "1.0.0",
      main: "./index.js",
      sideEffects: false,
    }),
    "node_modules/barrel-lib/index.js": `
      export { Alpha } from './alpha.js';
      export { Beta } from './beta.js';
      export { Gamma } from './gamma.js';
    `,
    "node_modules/barrel-lib/alpha.js": `export const Alpha = "ALPHA";`,
    "node_modules/barrel-lib/beta.js": `export const Beta = <<<SYNTAX_ERROR>>>;`,
    "node_modules/barrel-lib/gamma.js": `export const Gamma = <<<SYNTAX_ERROR>>>;`,
  },
  async test(dev) {
    // Beta.js and Gamma.js have syntax errors.
    // If barrel optimization works, they are never parsed, so no error.
    await using c = await dev.client("/");
    await c.expectMessage("got: ALPHA");
  },
});

devTest("barrel optimization: adding a new import triggers reload", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { Alpha } from 'barrel-lib';
      console.log('result: ' + Alpha);
    `,
    "node_modules/barrel-lib/package.json": JSON.stringify({
      name: "barrel-lib",
      version: "1.0.0",
      main: "./index.js",
      sideEffects: false,
    }),
    "node_modules/barrel-lib/index.js": `
      export { Alpha } from './alpha.js';
      export { Beta } from './beta.js';
      export { Gamma } from './gamma.js';
    `,
    "node_modules/barrel-lib/alpha.js": `export const Alpha = "ALPHA";`,
    "node_modules/barrel-lib/beta.js": `export const Beta = "BETA";`,
    "node_modules/barrel-lib/gamma.js": `export const Gamma = "GAMMA";`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("result: ALPHA");

    // Add a second import from the barrel — Beta was previously deferred,
    // now needs to be loaded. The barrel file should be re-bundled with
    // Beta un-deferred.
    await c.expectReload(async () => {
      await dev.write(
        "index.ts",
        `
        import { Alpha, Beta } from 'barrel-lib';
        console.log('result: ' + Alpha + ' ' + Beta);
      `,
      );
    });
    await c.expectMessage("result: ALPHA BETA");

    // Add a third import
    await c.expectReload(async () => {
      await dev.write(
        "index.ts",
        `
        import { Alpha, Beta, Gamma } from 'barrel-lib';
        console.log('result: ' + Alpha + ' ' + Beta + ' ' + Gamma);
      `,
      );
    });
    await c.expectMessage("result: ALPHA BETA GAMMA");
  },
});

devTest("barrel optimization: multi-file imports preserved across rebuilds", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { Alpha } from 'barrel-lib';
      import { value } from './other';
      console.log('result: ' + Alpha + ' ' + value);
    `,
    "other.ts": `
      import { Beta } from 'barrel-lib';
      export const value = Beta;
    `,
    "node_modules/barrel-lib/package.json": JSON.stringify({
      name: "barrel-lib",
      version: "1.0.0",
      main: "./index.js",
      sideEffects: false,
    }),
    "node_modules/barrel-lib/index.js": `
      export { Alpha } from './alpha.js';
      export { Beta } from './beta.js';
      export { Gamma } from './gamma.js';
    `,
    "node_modules/barrel-lib/alpha.js": `export const Alpha = "ALPHA";`,
    "node_modules/barrel-lib/beta.js": `export const Beta = "BETA";`,
    "node_modules/barrel-lib/gamma.js": `export const Gamma = "GAMMA";`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("result: ALPHA BETA");

    // Edit only other.ts to also import Gamma. Alpha (from index.ts) must
    // still be available even though index.ts is not re-parsed.
    await c.expectReload(async () => {
      await dev.write(
        "other.ts",
        `
        import { Beta, Gamma } from 'barrel-lib';
        export const value = Beta + ' ' + Gamma;
      `,
      );
    });
    await c.expectMessage("result: ALPHA BETA GAMMA");
  },
});

devTest("barrel optimization: export star target not deferred (#27521)", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    // The user imports from consumer-lib, which is a non-barrel package
    // that imports QueryClient from outer-lib.
    "index.ts": `
      import { useQuery } from 'consumer-lib';
      console.log('result: ' + useQuery());
    `,
    // consumer-lib is NOT a barrel — it has real code that uses
    // QueryClient from outer-lib. This mirrors @refinedev/core
    // importing QueryClient from @tanstack/react-query.
    "node_modules/consumer-lib/package.json": JSON.stringify({
      name: "consumer-lib",
      version: "1.0.0",
      main: "./index.js",
    }),
    "node_modules/consumer-lib/index.js": `
      import { QueryClient } from 'outer-lib';
      export function useQuery() {
        const client = new QueryClient();
        return client instanceof QueryClient ? 'PASS' : 'FAIL';
      }
    `,
    // outer-lib is a barrel with sideEffects:false that re-exports
    // everything from inner-lib via export *. Mirrors @tanstack/react-query.
    "node_modules/outer-lib/package.json": JSON.stringify({
      name: "outer-lib",
      version: "1.0.0",
      main: "./index.js",
      sideEffects: false,
    }),
    "node_modules/outer-lib/index.js": `
      export * from 'inner-lib';
      export { Unrelated } from './unrelated.js';
    `,
    "node_modules/outer-lib/unrelated.js": `export const Unrelated = "X";`,
    // inner-lib is a barrel with sideEffects:false that re-exports
    // from submodules. Mirrors @tanstack/query-core. Without the fix,
    // the barrel optimizer defers queryClient.js because it doesn't
    // know inner-lib is an export-star target (source_index is not
    // set in dev-server mode), so QueryClient becomes undefined.
    "node_modules/inner-lib/package.json": JSON.stringify({
      name: "inner-lib",
      version: "1.0.0",
      main: "./index.js",
      sideEffects: false,
    }),
    "node_modules/inner-lib/index.js": `
      export { QueryClient } from './queryClient.js';
      export { Other } from './other.js';
    `,
    "node_modules/inner-lib/queryClient.js": `
      export class QueryClient { constructor() { this.ready = true; } }
    `,
    "node_modules/inner-lib/other.js": `export const Other = "OTHER";`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("result: PASS");
  },
});

devTest("barrel optimization: two export-from blocks pointing to the same source", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { invariant } from 'barrel-lib';
      console.log('got: ' + typeof invariant);
    `,
    "node_modules/barrel-lib/package.json": JSON.stringify({
      name: "barrel-lib",
      version: "1.0.0",
      main: "./index.js",
      sideEffects: false,
    }),
    "node_modules/barrel-lib/index.js": `
      export {
        createDataProperty,
        defineProperty,
      } from './utils.js';

      export { unrelated } from './other.js';

      export {
        invariant,
      } from './utils.js';
    `,
    "node_modules/barrel-lib/utils.js": `
      export function createDataProperty() {}
      export function defineProperty() {}
      export function invariant(cond, msg) {
        if (!cond) throw new Error(msg);
      }
    `,
    "node_modules/barrel-lib/other.js": `export const unrelated = "OTHER";`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("got: function");
  },
});

// Regression: #28886
// Consumer has TWO separate `import { X } from 'barrel'` statements for the
// same barrel. HMR deduplicates the second into the first; the second's
// import record is marked is_unused=true and never gets its path resolved.
// Barrel optimization then fails to see the named import from the dedup'd
// record and marks its target submodule as unused → submodule stays `{}` →
// the export is `undefined` at runtime.
devTest("barrel optimization: two import statements from the same barrel (#28886)", {
  // Flakes on darwin in CI (timing); fix is platform-agnostic, coverage via linux/windows/alpine.
  skip: ["darwin"],
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { Alpha } from 'barrel-lib';
      import { Beta } from 'barrel-lib';
      console.log('got: ' + Alpha() + ' ' + Beta());
    `,
    "node_modules/barrel-lib/package.json": JSON.stringify({
      name: "barrel-lib",
      version: "1.0.0",
      main: "./index.js",
      sideEffects: false,
    }),
    "node_modules/barrel-lib/index.js": `
      export { Alpha } from './alpha.js';
      export { Beta } from './beta.js';
      export { Gamma } from './gamma.js';
    `,
    "node_modules/barrel-lib/alpha.js": `export const Alpha = () => "ALPHA";`,
    "node_modules/barrel-lib/beta.js": `export const Beta = () => "BETA";`,
    "node_modules/barrel-lib/gamma.js": `export const Gamma = () => "GAMMA";`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("got: ALPHA BETA");
  },
});

// HMR lowering merges the statements of one import path into the first one. The
// import record of each later statement is never resolved.
const abBarrel = `export { a } from './a.js'; export { b } from './b.js';`;
const abPackage = (name: string, index: string) => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({
    name,
    version: "1.0.0",
    main: "./index.js",
    sideEffects: false,
  }),
  [`node_modules/${name}/index.js`]: index,
  [`node_modules/${name}/inner.js`]: abBarrel,
  [`node_modules/${name}/a.js`]: `export const a = "A";`,
  [`node_modules/${name}/b.js`]: `export function b() {}`,
});

devTest("barrel optimization: export star after another statement of the same path", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { b as b1 } from 'named-first';
      import { b as b2 } from 'star-first';
      import { b as b3 } from 'star-twice';
      import { b as b4 } from './import-first';
      import { a as importLate } from 'parsed-first';
      const { b: b5 } = await importLate();
      console.log('got: ' + [b1, b2, b3, b4, b5].map(b => typeof b).join(' '));
    `,
    ...abPackage("named-first", `export { a } from './inner.js'; export * from './inner.js';`),
    ...abPackage("star-first", `export * from './inner.js'; export { a } from './inner.js';`),
    ...abPackage("star-twice", `import './inner.js'; export * from './inner.js'; export * from './inner.js';`),
    "import-first.ts": `
      import { a } from 'leaf';
      export * from 'leaf';
      export const own = a;
    `,
    ...abPackage("leaf", abBarrel),
    // parsed-first has deferred b.js by the time its a.js leads to late.ts.
    ...abPackage("parsed-first", abBarrel),
    "node_modules/parsed-first/a.js": `export const a = () => import('../../late');`,
    "late.ts": `
      import { a } from 'parsed-first';
      export * from 'parsed-first';
      export const own = a;
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("got: function function function function function");
  },
});

devTest("barrel optimization: namespace re-export cycle through a star-exported module", {
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { x, y, deepValue } from 'loop-lib';
      import { keep } from 'loop-lib/w.js';
      import { other } from 'loop-lib/g.js';
      console.log('result: ' + typeof x + ' ' + y + ' ' + keep + ' ' + deepValue + ' ' + other);
    `,
    "node_modules/loop-lib/package.json": JSON.stringify({
      name: "loop-lib",
      version: "1.0.0",
      main: "./index.js",
      sideEffects: false,
    }),
    "node_modules/loop-lib/index.js": `
      export * from './t.js';
    `,
    "node_modules/loop-lib/t.js": `
      export { x } from './w.js';
      export * from './r.js';
      export * from './g.js';
    `,
    "node_modules/loop-lib/w.js": `
      import * as ns from './t.js';
      export { ns as x };
      export { keep } from './keep.js';
    `,
    "node_modules/loop-lib/keep.js": `
      export const keep = "KEEP";
    `,
    "node_modules/loop-lib/r.js": `
      export const y = "Y";
    `,
    "node_modules/loop-lib/g.js": `
      export { deepValue } from './deep.js';
      export { other } from './other.js';
    `,
    "node_modules/loop-lib/deep.js": `
      export const deepValue = "DEEP";
    `,
    "node_modules/loop-lib/other.js": `
      export const other = "OTHER";
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("result: object Y KEEP DEEP OTHER");
  },
});
// The dev server's runtime threw `$ERR_SSR_RESPONSE_EXPECTED(...)`, a name only src/js resolves: what the
// user saw was "ReferenceError: $ERR_SSR_RESPONSE_EXPECTED is not defined".
// A build reads a barrel again when an earlier build left an export of it that nothing imports.
// /first bundled both barrels. They are deleted, and the build of /second reads both again:
//   1. The early barrel is not there to read. The dev server loads first.ts again, which imports it.
//   2. The onLoad of first.ts writes the early barrel back. The bundler resolves the imports of
//      first.ts: the early barrel is read again, and the late barrel still waits in its onLoad.
//   3. The late barrel is not there to read. first.ts and second.ts import it.
for (const late of ["whole", "named"]) {
  const early = late === "whole" ? "named" : "whole";
  const barrel = (name: string) => `node_modules/${name}/index.js`;
  const line = late === "whole" ? 2 : 1;
  devTest(`two imports of one module are deleted in one build, and the import of "${late}" fails last`, {
    files: {
      ...servePlugin(["first", "second"]),
      ...abPackage("named", abBarrel),
      ...abPackage("whole", abBarrel),
      "first.html": emptyHtmlFile({ scripts: ["first.ts"] }),
      "second.html": emptyHtmlFile({ scripts: ["second.ts"] }),
      "first.ts": `
        import { a as named } from "named";
        import { a as whole } from "whole";
        console.log("first: " + named + " " + whole);
      `,
      "second.ts": `
        import { a as named } from "named";
        import { a as whole } from "whole";
        console.log("second: " + named + " " + whole);
      `,
      "plugin.ts": `
        import fs from "node:fs";
        import path from "node:path";

        const root = import.meta.dir;
        // Resolves when the early barrel is loaded a second time: step 2 is done.
        const firstResolvedAgain = Promise.withResolvers();
        let deleted = false;
        export default {
          name: "orders two missing files",
          setup(build) {
            build.onLoad({ filter: /(first\\.ts|[\\\\/](named|whole)[\\\\/]index\\.js)$/ }, async args => {
              const file = path.relative(root, args.path).replaceAll("\\\\", "/");
              if (!fs.existsSync(args.path)) deleted = true;
              if (!deleted) return;
              const loads = (globalThis.counts[file] = (globalThis.counts[file] ?? 0) + 1);
              if (file === ${JSON.stringify(barrel(early))} && loads === 2) firstResolvedAgain.resolve();
              if (file === ${JSON.stringify(barrel(late))} && loads === 1) await firstResolvedAgain.promise;
              if (file === "first.ts") fs.writeFileSync(path.join(root, ${JSON.stringify(barrel(early))}), ${JSON.stringify(abBarrel)});
            });
          },
        };
      `,
    },
    htmlFiles: [],
    async test(dev) {
      await dev.fetch("/first");
      for (const name of [early, late]) fs.unlinkSync(dev.join(barrel(name)));
      {
        await using c = await dev.client("/second", {
          errors: ["first.ts", "second.ts"].map(
            file => `${file}:${line}:28: error: Could not resolve: "${late}". Maybe you need to "bun install"?`,
          ),
        });
      }
      expect(await dev.fetch("/counts").json()).toEqual({ [barrel(early)]: 2, [barrel(late)]: 1, "first.ts": 1 });
      fs.writeFileSync(dev.join(barrel(late)), abBarrel);
      await using c = await dev.client("/second");
      await c.expectMessage("second: A A");
    },
  });
}
// The same with no plugin: the one importer of a barrel is saved while the barrel is away.
devTest("saving the importer of a barrel that was deleted shows an error until the barrel is back", {
  files: {
    ...abPackage("named", abBarrel),
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `
      import { a as named } from "named";
      console.log("index: " + named);
    `,
  },
  async test(dev) {
    {
      await using c = await dev.client("/");
      await c.expectMessage("index: A");
    }
    fs.unlinkSync(dev.join("node_modules/named/index.js"));
    await dev.write(
      "index.ts",
      `
        import { a as named } from "named";
        console.log("saved: " + named);
      `,
      { errors: null },
    );
    {
      await using c = await dev.client("/", {
        errors: ['index.ts:1:28: error: Could not resolve: "named". Maybe you need to "bun install"?'],
      });
    }
    // The request above listed the directory of the package again, without the barrel. The dev
    // server watches that directory since the build of the save.
    await dev.write("node_modules/named/index.js", abBarrel);
    await using c = await dev.client("/");
    await c.expectMessage("saved: A");
  },
});
// /first has the modules of the package, and the page of /second has none of them.
devTest("a second route that imports a deleted barrel shows the error at each request", {
  files: {
    ...abPackage("named", abBarrel),
    "first.html": emptyHtmlFile({ scripts: ["first.ts"] }),
    "second.html": emptyHtmlFile({ scripts: ["second.ts"] }),
    "first.ts": `
      import { a } from "named";
      console.log("first: " + a);
    `,
    "second.ts": `
      import { b } from "named";
      console.log("second: " + typeof b);
    `,
  },
  async test(dev) {
    await dev.fetch("/first");
    fs.unlinkSync(dev.join("node_modules/named/index.js"));
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await dev.fetch("/second")).status);
    expect(statuses).toEqual([500, 500, 500]);
  },
});
devTest("a render() that does not return a Response is reported as that", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
      export default function () {
        return "not a response";
      }
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/");
    const text = await response.text();
    expect({
      status: response.status,
      saysWhatIsWrong: text.includes("was expected to return a Response object"),
      referenceError: text.includes("is not defined"),
    }).toEqual({ status: 500, saysWhatIsWrong: true, referenceError: false });
  },
});
devTest("require() of a built-in module in server code returns what require() returns", {
  framework: minimalFramework,
  files: {
    "node_modules/cjsdep/package.json": JSON.stringify({ name: "cjsdep", main: "index.js" }),
    "node_modules/cjsdep/index.js": `
      var Stream = require("stream");
      var EventEmitter = require("events");
      var util = require("util");
      function DataStream() {}
      util.inherits(DataStream, Stream);
      module.exports = {
        stream: typeof Stream + ":" + typeof Stream.prototype,
        events: typeof EventEmitter + ":" + typeof EventEmitter.prototype,
        inherits: new DataStream() instanceof Stream,
      };
    `,
    "routes/index.ts": `
      import info from "cjsdep";
      import * as streamNamespace from "stream";
      export default function () {
        return new Response(JSON.stringify({ ...info, importReadable: typeof streamNamespace.Readable }));
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals({
      stream: "function:object",
      events: "function:object",
      inherits: true,
      importReadable: "function",
    });
  },
});
devTest("a route whose import throws on load throws that error again on the next request", {
  framework: minimalFramework,
  files: {
    "dep.cjs": `throw new Error("dep.cjs failed to load");`,
    "esm-dep.ts": `throw new Error("esm-dep.ts failed to load"); export const value = 1;`,
    // A top-level await that rejects, after the module started.
    "tla-dep.ts": `await Promise.resolve(); throw new Error("tla-dep.ts failed to load"); export const value = 1;`,
    // Reached through require(), so through the synchronous loader: a body that throws, and an import that throws.
    "sync-body.ts": `throw new Error("sync-body.ts failed to load"); export const value = 1;`,
    "sync-body.cjs": `module.exports = require("./sync-body.ts").value;`,
    "sync-import-dep.ts": `throw new Error("sync-import-dep.ts failed to load"); export const value = 1;`,
    "sync-import.ts": `export { value } from "./sync-import-dep.ts";`,
    "sync-import.cjs": `module.exports = require("./sync-import.ts").value;`,
    "routes/index.ts": `
      import dep from "../dep.cjs";
      export default function () {
        return new Response("dep: " + dep);
      }
    `,
    "routes/esm.ts": `
      import { value } from "../esm-dep.ts";
      export default function () {
        return new Response("esm-dep: " + value);
      }
    `,
    "routes/tla.ts": `
      import { value } from "../tla-dep.ts";
      export default function () {
        return new Response("tla-dep: " + value);
      }
    `,
    "routes/sync-body.ts": `
      import value from "../sync-body.cjs";
      export default function () {
        return new Response("sync-body: " + value);
      }
    `,
    "routes/sync-import.ts": `
      import value from "../sync-import.cjs";
      export default function () {
        return new Response("sync-import: " + value);
      }
    `,
  },
  async test(dev) {
    for (const [url, message] of [
      ["/", "dep.cjs failed to load"],
      ["/esm", "esm-dep.ts failed to load"],
      ["/tla", "tla-dep.ts failed to load"],
      ["/sync-body", "sync-body.ts failed to load"],
      ["/sync-import", "sync-import-dep.ts failed to load"],
    ]) {
      for (let i = 0; i < 2; i++) {
        const response = await dev.fetch(url);
        const text = await response.text();
        expect({ url, status: response.status, hasMessage: text.includes(message) }).toEqual({
          url,
          status: 500,
          hasMessage: true,
        });
      }
    }
    await dev.write("dep.cjs", `module.exports = "fixed";`);
    await dev.fetch("/").equals("dep: fixed");
    await dev.write("esm-dep.ts", `export const value = "fixed";`);
    await dev.fetch("/esm").equals("esm-dep: fixed");
    await dev.write("tla-dep.ts", `await Promise.resolve(); export const value = "fixed";`);
    await dev.fetch("/tla").equals("tla-dep: fixed");
    await dev.write("sync-body.ts", `export const value = "fixed";`);
    await dev.fetch("/sync-body").equals("sync-body: fixed");
    await dev.write("sync-import-dep.ts", `export const value = "fixed";`);
    await dev.fetch("/sync-import").equals("sync-import: fixed");
  },
});
devTest("a route module that throws when a save reloads it is reported and recovers", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
      export default function () {
        return new Response("index v1");
      }
    `,
    "routes/other.ts": `
      export default function () {
        return new Response("other v1");
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("index v1");
    await dev.fetch("/other").equals("other v1");
    {
      await using batch = await dev.batchChanges();
      await dev.write(
        "routes/index.ts",
        `
          throw new Error("thrown at module scope");
          export default function () {
            return new Response("index v2");
          }
        `,
      );
      await dev.patch("routes/other.ts", { find: "v1", replace: "v2" });
    }
    const failed = await dev.fetch("/");
    expect(await failed.text()).toContain("thrown at module scope");
    expect(failed.status).toBe(500);
    await dev.fetch("/other").equals("other v2");
    await dev.write(
      "routes/index.ts",
      `
        export default function () {
          return new Response("index v3");
        }
      `,
    );
    await dev.fetch("/").equals("index v3");
  },
});
devTest("a route loads after a request for it was answered with 413", {
  files: {
    "routes/about.ts": `
      export default function () {
        return new Response("about");
      }
    `,
    "routes/other.ts": `
      export default function () {
        return new Response("other");
      }
    `,
    "bun.app.ts": `
      export default {
        maxRequestBodySize: 1024,
        app: { framework: ${JSON.stringify(minimalFramework)} },
      };
    `,
  },
  async test(dev) {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const socket = net.connect(dev.port, "localhost", () => {
      socket.write("POST /about HTTP/1.1\r\nHost: localhost\r\nContent-Length: 999999\r\n\r\n");
    });
    let data = "";
    socket.on("data", chunk => (data += chunk));
    socket.on("error", reject);
    socket.on("close", () => resolve(data.split("\r\n")[0]));
    expect(await promise).toBe("HTTP/1.1 413 Request Entity Too Large");

    await dev.fetch("/other").equals("other");
    await dev.fetch("/about").equals("about");
  },
});
// "loop" is a symlink to itself, so kqueue can't open the directory to watch it.
devTest("recovers from importing a file in a directory that can't be opened", {
  skip: ["win32"],
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      import { abc } from './loop/second';
      console.log('value: ' + abc);
    `,
  },
  async test(dev) {
    fs.symlinkSync("loop", dev.join("loop"));
    await using c = await dev.client("/", {
      errors: [`index.ts:1:21: error: Could not resolve: "./loop/second"`],
    });

    await c.expectReload(async () => {
      await dev.write("index.ts", `console.log('value: ' + 456);`);
    });

    await c.expectMessage("value: 456");
  },
});

// Nested `:fullscreen` rules copy the body once per vendor prefix at each level, which the CSS
// printer rejects. This only fails because the dev server prints and minifies with different targets.
// If that changes, this test needs another stylesheet that fails to print.
devTest("editing an @imported stylesheet recovers from a failed CSS print", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["main.css"],
      body: "hello",
    }),
    "main.css": `@import "./child.css";\nbody { margin: 0; }\n`,
    "child.css":
      Array.from({ length: 30 }, (_, i) => `.x${i}:fullscreen {`).join("\n") +
      "\ncolor: red;\n" +
      Buffer.alloc(30, "}").toString() +
      "\n",
  },
  async test(dev) {
    await using c = await dev.client("/", {
      errors: ["main.css: error: Failed to generate CSS for this file (PrintError)"],
    });

    await c.expectReload(async () => {
      await dev.write("child.css", ".visible { color: blue; }\n", { dedent: false, errors: null });
    });
    await c.style(".visible").color.expect.toBe("#00f");
  },
});

devTest("an @imported stylesheet recovers from a parse error", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["main.css"],
      body: "hello",
    }),
    "main.css": `@import "./child.css";\nbody { margin: 0; }\n`,
    "child.css": `.fine { color: red; }\n`,
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(200);
    await dev.write("child.css", `.fine {\n color`, { dedent: false });
    expect((await dev.fetch("/")).status).toBe(500);
    await dev.write("child.css", `.fine { color: blue; }\n`, { dedent: false });
    await using c = await dev.client("/");
    await c.style(".fine").color.expect.toBe("#00f");
    // Every later save must rebuild main.css too, not only the first one.
    for (const color of ["green", "tan", "red"]) {
      await dev.write("child.css", `.fine { color: ${color}; }\n`, { dedent: false });
      await c.style(".fine").color.expect.toBe(color);
    }
  },
});

// Changing index.ts makes the route trace its stylesheets again while main.css is in a failed state.
devTest("dev server survives a css parse error with an edge adjustment", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["main.css"],
      scripts: ["index.ts"],
      body: "hello",
    }),
    "index.ts": `import.meta.hot.accept();\n`,
    "main.css": `@import "./child.css";\nbody { margin: 0; }\n`,
    "child.css": `.fine { color: red; }\n`,
    "b.css": `.b { color: green; }\n`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.style(".fine").color.expect.toBe("red");
    {
      await using _batch = await dev.batchChanges({
        errors: ["main.css:5:1: error: Unexpected end of input"],
      });
      await dev.write("main.css", `@import "./child.css";\nbody {\n color: red;\n background-color\n}\n`, {
        dedent: false,
      });
      await dev.write("index.ts", `import.meta.hot.accept();\nimport "./b.css";\n`, { dedent: false });
    }
    await c.style(".fine").color.expect.toBe("red");
    await c.style(".b").color.expect.toBe("green");
    await dev.write("main.css", `@import "./child.css";\nbody { margin: 0; }\n`, { dedent: false });
    await c.style(".fine").color.expect.toBe("red");
  },
});

devTest("dev server survives a css resolution error with an edge adjustment", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["main.css"],
      scripts: ["index.ts"],
      body: "hello",
    }),
    "index.ts": `import.meta.hot.accept();\n`,
    "main.css": `@import "./child.css";\nbody { margin: 0; }\n`,
    "child.css": `.fine { color: red; }\n`,
    "b.css": `.b { color: green; }\n`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.style(".fine").color.expect.toBe("red");
    {
      await using _batch = await dev.batchChanges({
        errors: ['main.css:1:1: error: Could not resolve: "./missing.css"'],
      });
      await dev.write("main.css", `@import "./missing.css";\nbody { margin: 0; }\n`, { dedent: false });
      await dev.write("index.ts", `import.meta.hot.accept();\nimport "./b.css";\n`, { dedent: false });
    }
    await c.style(".fine").color.expect.toBe("red");
    await c.style(".b").color.expect.toBe("green");
    await dev.write("main.css", `@import "./child.css";\nbody { margin: 0; }\n`, { dedent: false });
    await c.style(".fine").color.expect.toBe("red");
  },
});

// The dev server builds its define table from the env map once. Assigning to a proxy variable frees the map's value.
const startupProxy = "http://proxy-at-startup.example:8080/" + Buffer.alloc(120, "a").toString();
async function clientBundle(dev: Dev) {
  const html = await dev.fetch("/").text();
  const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)];
  expect(scripts).toHaveLength(1);
  return dev.fetch(scripts[0][1]).text();
}
devTest("inlined env var survives a runtime process.env write to a proxy variable", {
  files: {
    "bunfig.toml": `
      [serve.static]
      env = "inline"
    `,
    "index.html": emptyHtmlFile({ scripts: ["index.ts"] }),
    "index.ts": `console.log("v1", process.env.HTTPS_PROXY);`,
    "bun.app.ts": `
      import html from "./index.html";
      export default {
        static: { "/": html },
        fetch(req) {
          if (new URL(req.url).pathname === "/set-proxy") {
            process.env.HTTPS_PROXY = "http://changed-at-runtime.example:1/";
            return new Response("ok");
          }
          return new Response("Not Found", { status: 404 });
        },
      };
    `,
  },
  htmlFiles: [],
  env: { HTTPS_PROXY: startupProxy },
  async test(dev) {
    const before = await clientBundle(dev);
    expect(before).toContain('"v1"');
    expect(before).toContain(startupProxy);

    await dev.fetch("/set-proxy").equals("ok");

    await dev.write("index.ts", `console.log("v2", process.env.HTTPS_PROXY);`);
    const after = await clientBundle(dev);
    expect(after).toContain('"v2"');
    expect(after).toContain(startupProxy);
  },
});

// An unresolved CSS url() is passed to the directory watcher. The HTML scanner joins a rooted src to the project root.
devTest("recovers from an unresolved css url() and html script src longer than the path buffer", {
  files: {
    "index.html": emptyHtmlFile({
      styles: ["styles.css"],
      scripts: ["/" + Buffer.alloc(MAX_PATH_BYTES + 1024, "a").toString() + ".js"],
    }),
    "styles.css": `
      body {
        background-image: url(${Buffer.alloc(MAX_PATH_BYTES + 1024, "a").toString()});
      }
    `,
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(500);
    // The stylesheet is bundled and watched only after the page's imports resolve.
    await dev.write("index.html", emptyHtmlFile({ styles: ["styles.css"] }), { errors: null });
    expect((await dev.fetch("/")).status).toBe(500);
    await dev.write("styles.css", `body { color: blue; }`);
    expect((await dev.fetch("/")).status).toBe(200);
  },
});
