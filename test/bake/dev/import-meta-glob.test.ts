// `import.meta.glob()` depends on the file system: the dev server bundles the importer again when the matches change.
import { devTest, emptyHtmlFile, minimalFramework } from "../bake-harness";

devTest("import.meta.glob follows files that appear and disappear", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      const eager = import.meta.glob("./modules/*.ts", { eager: true, import: "default" });
      const lazy = import.meta.glob("./modules/*.ts", { import: "default" });
      const loaded = await Promise.all(Object.values(lazy).map(load => load()));
      console.log(JSON.stringify(eager) + " " + loaded.join());
    `,
    "modules/a.ts": `export default "a";`,
    "modules/b.ts": `export default "b";`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(`{"./modules/a.ts":"a","./modules/b.ts":"b"} a,b`);

    await c.expectReload(async () => {
      await dev.write("modules/c.ts", `export default "c";`);
    });
    await c.expectMessage(`{"./modules/a.ts":"a","./modules/b.ts":"b","./modules/c.ts":"c"} a,b,c`);

    await c.expectReload(async () => {
      await dev.delete("modules/b.ts");
    });
    await c.expectMessage(`{"./modules/a.ts":"a","./modules/c.ts":"c"} a,c`);

    await c.expectNoWebSocketActivity(async () => {
      await dev.write("modules/notes.txt", "does not match");
    });

    await c.expectReload(async () => {
      await dev.write("modules/d.ts", `export default "d";`);
    });
    await c.expectMessage(`{"./modules/a.ts":"a","./modules/c.ts":"c","./modules/d.ts":"d"} a,c,d`);
  },
});

devTest("import.meta.glob follows a directory that nothing is imported from", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
      export default function () {
        return new Response(Object.keys(import.meta.glob(["../modules/**/*.ts", "!**/skip.ts"])).join());
      }
    `,
    "modules/a.ts": `throw new Error("not imported");`,
    "modules/nested/b.ts": `throw new Error("not imported");`,
    "empty/.gitkeep": "",
    "routes/empty.ts": `
      export default function () {
        return new Response("[" + Object.keys(import.meta.glob("../empty/*.ts")).join() + "]");
      }
    `,
  },
  async test(dev) {
    await dev.fetch("/").equals("../modules/a.ts,../modules/nested/b.ts");
    await dev.write("modules/c.ts", "");
    await dev.fetch("/").equals("../modules/a.ts,../modules/c.ts,../modules/nested/b.ts");
    await dev.write("modules/nested/d.ts", "");
    await dev.fetch("/").equals("../modules/a.ts,../modules/c.ts,../modules/nested/b.ts,../modules/nested/d.ts");
    await dev.write("modules/nested/skip.ts", "");
    await dev.fetch("/").equals("../modules/a.ts,../modules/c.ts,../modules/nested/b.ts,../modules/nested/d.ts");
    await dev.delete("modules/a.ts");
    await dev.fetch("/").equals("../modules/c.ts,../modules/nested/b.ts,../modules/nested/d.ts");

    await dev.fetch("/empty").equals("[]");
    await dev.write("empty/first.ts", "");
    await dev.fetch("/empty").equals("[../empty/first.ts]");
  },
});
