// `import.meta.glob()` is expanded each time the file that calls it is bundled.
import { writeFileSync } from "node:fs";
import { devTest, emptyHtmlFile, minimalFramework } from "../bake-harness";

const index = (label: string) => `
  const eager = import.meta.glob("./modules/*.ts", { eager: true, import: "default" });
  const lazy = import.meta.glob("./modules/*.ts", { import: "default" });
  const loaded = await Promise.all(Object.values(lazy).map(load => load()));
  console.log("${label} " + JSON.stringify(eager) + " " + loaded.join());
`;

devTest("import.meta.glob in a client bundle", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": index("first"),
    "modules/a.ts": `export default "a";`,
    "modules/b.ts": `export default "b";`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage(`first {"./modules/a.ts":"a","./modules/b.ts":"b"} a,b`);

    writeFileSync(dev.join("modules/c.ts"), `export default "c";`);
    await c.expectReload(async () => {
      await dev.write("index.ts", index("second"));
    });
    await c.expectMessage(`second {"./modules/a.ts":"a","./modules/b.ts":"b","./modules/c.ts":"c"} a,b,c`);
  },
});

const route = (label: string) => `
  export default function () {
    return new Response("${label} " + Object.keys(import.meta.glob(["../modules/**/*.ts", "!**/skip.ts"])).join());
  }
`;

devTest("import.meta.glob in a server bundle", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": route("first"),
    "modules/a.ts": `throw new Error("not imported");`,
    "modules/nested/b.ts": `throw new Error("not imported");`,
    "modules/nested/skip.ts": `throw new Error("not imported");`,
  },
  async test(dev) {
    await dev.fetch("/").equals("first ../modules/a.ts,../modules/nested/b.ts");

    writeFileSync(dev.join("modules/nested/c.ts"), `throw new Error("not imported");`);
    await dev.write("routes/index.ts", route("second"));
    await dev.fetch("/").equals("second ../modules/a.ts,../modules/nested/b.ts,../modules/nested/c.ts");
  },
});
