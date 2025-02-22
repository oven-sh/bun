// these tests involve ensuring react (html loader + single page app) works
// react is big and we do lots of stuff like fast refresh.
import { expect } from "bun:test";
import { devTest } from "../dev-server-harness";

devTest("react in html", {
  fixture: "react-spa-simple",
  async test(dev) {
    await using c = await dev.client();

    expect(await c.elemText("h1")).toBe("Hello World");

    await dev.write(
      "App.tsx",
      `
        console.log('reload');
        export default function App() {
          return <h1>Yay</h1>;
        }
      `,
    );
    await c.expectMessage("reload");
    expect(await c.elemText("h1")).toBe("Yay");

    await c.hardReload();
    await c.expectMessage("reload");

    expect(await c.elemText("h1")).toBe("Yay");
  },
});
