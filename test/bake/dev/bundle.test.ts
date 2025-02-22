// Bundle tests are tests concerning bundling bugs that only occur in DevServer.
import { expect } from "bun:test";
import { devTest, emptyHtmlFile, minimalFramework, reactAndRefreshStub } from "../dev-server-harness";

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
// https://github.com/oven-sh/bun/issues/17447
devTest("react refresh should register and track hook state", {
  framework: minimalFramework,
  files: {
    ...reactAndRefreshStub,
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.tsx"],
    }),
    "index.tsx": `
      import { expectRegistered } from 'bun-devserver-react-mock';
      import App from './App.tsx';
      expectRegistered(App, "App.tsx", "default");
    `,
    "App.tsx": `
      export default function App() {
        let [a, b] = useState(1);
        return <div>Hello, world!</div>;
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {});
    const firstHash = await c.reactRefreshComponentHash("App.tsx", "default");
    expect(firstHash).toBeDefined();

    // hash does not change when hooks stay same
    await dev.write(
      "App.tsx",
      `
      export default function App() {
        let [a, b] = useState(1);
        return <div>Hello, world! {a}</div>;
      }
    `,
    );
    const secondHash = await c.reactRefreshComponentHash("App.tsx", "default");
    expect(secondHash).toEqual(firstHash);

    // hash changes when hooks change
    await dev.write(
      "App.tsx",
      `
      export default function App() {
        let [a, b] = useState(2);
        return <div>Hello, world! {a}</div>;
      }
    `,
    );
    const thirdHash = await c.reactRefreshComponentHash("App.tsx", "default");
    expect(thirdHash).not.toEqual(firstHash);
  },
});
devTest("react refresh cases", {
  framework: minimalFramework,
  files: {
    ...reactAndRefreshStub,
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.tsx"],
    }),
    "index.tsx": `
      import { expectRegistered } from 'bun-devserver-react-mock';

      expectRegistered((await import("./default_unnamed")).default, "default_unnamed.tsx", "default");
      expectRegistered((await import("./default_named")).default, "default_named.tsx", "default");
      expectRegistered((await import("./default_arrow")).default, "default_arrow.tsx", "default");
      expectRegistered((await import("./local_var")).LocalVar, "local_var.tsx", "LocalVar");
      expectRegistered((await import("./local_const")).LocalConst, "local_const.tsx", "LocalConst");
      await import("./non_exported");

      expectRegistered((await import("./default_unnamed_hooks")).default, "default_unnamed_hooks.tsx", "default");
      expectRegistered((await import("./default_named_hooks")).default, "default_named_hooks.tsx", "default");
      expectRegistered((await import("./default_arrow_hooks")).default, "default_arrow_hooks.tsx", "default");
      expectRegistered((await import("./local_var_hooks")).LocalVar, "local_var_hooks.tsx", "LocalVar");
      expectRegistered((await import("./local_const_hooks")).LocalConst, "local_const_hooks.tsx", "LocalConst");
      await import("./non_exported_hooks");
    `,
    "default_unnamed.tsx": `
      export default function() {
        return <div></div>;
      }
    `,
    "default_named.tsx": `
      export default function Hello() {
        return <div></div>;
      }
    `,
    "default_arrow.tsx": `
      export default () => {
        return <div></div>;
      }
    `,
    "local_var.tsx": `
      export var LocalVar = () => {
        return <div></div>;
      }
    `,
    "local_const.tsx": `
      export const LocalConst = () => {
        return <div></div>;
      }
    `,
    "non_exported.tsx": `
      import { expectRegistered } from 'bun-devserver-react-mock';

      function NonExportedFunc() {
        return <div></div>;
      }

      const NonExportedVar = () => {
        return <div></div>;
      }

      // Anonymous function with name
      const NonExportedAnon = (function MyNamedAnon() {
        return <div></div>;
      });

      // Anonymous function without name
      const NonExportedAnonUnnamed = (function() {
        return <div></div>;
      });

      expectRegistered(NonExportedFunc, "non_exported.tsx", "NonExportedFunc");
      expectRegistered(NonExportedVar, "non_exported.tsx", "NonExportedVar");
      expectRegistered(NonExportedAnon, "non_exported.tsx", "NonExportedAnon");
      expectRegistered(NonExportedAnonUnnamed, "non_exported.tsx", "NonExportedAnonUnnamed");
    `,
    "default_unnamed_hooks.tsx": `
      export default function() {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      }
    `,
    "default_named_hooks.tsx": `
      export default function Hello() {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      }
    `,
    "default_arrow_hooks.tsx": `
      export default () => {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      }
    `,
    "local_var_hooks.tsx": `
      export var LocalVar = () => {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      }
    `,
    "local_const_hooks.tsx": `
      export const LocalConst = () => {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      }
    `,
    "non_exported_hooks.tsx": `
      import { expectRegistered } from 'bun-devserver-react-mock';

      function NonExportedFunc() {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      }

      const NonExportedVar = () => {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      }

      // Anonymous function with name
      const NonExportedAnon = (function MyNamedAnon() {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      });

      // Anonymous function without name
      const NonExportedAnonUnnamed = (function() {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      });

      expectRegistered(NonExportedFunc, "non_exported_hooks.tsx", "NonExportedFunc");
      expectRegistered(NonExportedVar, "non_exported_hooks.tsx", "NonExportedVar");
      expectRegistered(NonExportedAnon, "non_exported_hooks.tsx", "NonExportedAnon");
      expectRegistered(NonExportedAnonUnnamed, "non_exported_hooks.tsx", "NonExportedAnonUnnamed");
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
  },
});
devTest("default export same-scope handling", {
  files: {
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.ts"],
    }),
    "index.ts": `
      await import("./fixture1.ts"); 
      console.log((new ((await import("./fixture2.ts")).default)).a); 
      await import("./fixture3.ts"); 
      console.log((new ((await import("./fixture4.ts")).default)).result); 
      console.log((await import("./fixture5.ts")).default);
      console.log((await import("./fixture6.ts")).default);
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
      export default class MOVE {
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
  },
  async test(dev) {
    await using c = await dev.client("/", { storeHotChunks: true });
    c.expectMessage("ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN");

    const filesExpectingMove = Object.entries(dev.options.files)
      .filter(([path]) => path.includes("MOVE"))
      .map(([path]) => path);
    for (const file of filesExpectingMove) {
      await dev.writeNoChanges(file);
      const chunk = c.getMostRecentHmrChunk();
      expect(chunk).toMatch(/:\s*(function|class)\s*MOVE/);
      console.log(chunk);
    }
  },
});
