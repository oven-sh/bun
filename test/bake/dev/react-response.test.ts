import { expect } from "bun:test";
import { devTest, emptyHtmlFile } from "../bake-harness";

// The dev error page embeds its payload as JSON (see src/runtime/server/DevErrorPage.rs).
function getFallbackMessageContainer(text: string) {
  const regex = /<script id="__bunfallback" type="application\/json">([^<]*)<\/script>/m;
  return JSON.parse(regex.exec(text)![1]);
}

// Test case 1: Simple page which throws an error when streaming = false
devTest("error thrown when streaming = false", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      export const streaming = false;
      export const mode = "ssr";
      
      export default async function IndexPage() {
        throw new Error('LMAO')
      }
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/");
    expect(response.status).toBe(500);
  },
});

// Test case 2: Simple page which throws an error when streaming = true
devTest("error thrown when streaming = true", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      export const streaming = true;
      export const mode = "ssr";

      export default async function IndexPage() {
        throw new Error('LMAO')
      }
    `,
  },
  async test(dev) {
    const response = await dev.fetch("/");

    // Streaming might return 200 and then error, or 500
    const text = await response.text();

    const fallback_message_container = getFallbackMessageContainer(text);
    expect(fallback_message_container.problems?.exceptions[0].message).toContain("LMAO");
  },
});

const counter = (version: string) => `
  "use client";
  import { label } from "./label";
  export function Counter() {
    return <button>{label} counter ${version}</button>;
  }
`;
const button = (html: string) => /<button>(.*?)<\/button>/.exec(html)?.[1]?.replaceAll("<!-- -->", "");

// The server renders a client component through a module that it loads with import(). A save of the
// component has to get to the server-rendered HTML of the next request, not only to the browser.
devTest("the server-rendered HTML of a client component follows its saves", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      import { Counter } from "../components/Counter";
      export default function Page() {
        return <main><Counter /></main>;
      }
    `,
    "components/Counter.tsx": counter("v1"),
    "components/label.ts": `export const label = "L1";`,
  },
  async test(dev) {
    expect(button(await (await dev.fetch("/")).text())).toBe("L1 counter v1");

    await dev.write("components/Counter.tsx", counter("v2"));
    expect(button(await (await dev.fetch("/")).text())).toBe("L1 counter v2");

    // Two saves with no request between them.
    await dev.write("components/Counter.tsx", counter("v3"));
    await dev.write("components/Counter.tsx", counter("v4"));
    expect(button(await (await dev.fetch("/")).text())).toBe("L1 counter v4");

    // A file that only the client component imports.
    await dev.write("components/label.ts", `export const label = "L2";`);
    expect(button(await (await dev.fetch("/")).text())).toBe("L2 counter v4");
  },
});

// react-server-dom-bun keeps the promise of that import() for each client component. When the component
// fails to load, the promise it keeps is a rejected one, and only a new evaluation of that module drops it.
devTest("a client component that fails to load on the server is rendered after it is fixed", {
  framework: "react",
  files: {
    "pages/index.tsx": `
      import { Counter } from "../components/Counter";
      export default function Page() {
        return <main><Counter /></main>;
      }
    `,
    "components/Counter.tsx": `
      "use client";
      throw new Error("counter failed");
    `,
    "components/label.ts": `export const label = "L1";`,
  },
  async test(dev) {
    expect((await dev.fetch("/")).status).toBe(500);
    expect((await dev.fetch("/")).status).toBe(500);

    await dev.write("components/Counter.tsx", counter("v2"));
    expect(button(await (await dev.fetch("/")).text())).toBe("L1 counter v2");
  },
});

// Real React and react-refresh. Page.tsx is a Fast Refresh boundary. widgets.tsx, theme.ts and Fwd.tsx
// are between it and config.ts and are not boundaries, so a save of config.ts evaluates them again.
devTest("component state after a hot update evaluates the modules below a Fast Refresh boundary again", {
  framework: "react",
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.tsx"], body: `<div id="root"></div>` }),
    "index.tsx": `
      import { createRoot } from "react-dom/client";
      import { Page } from "./Page";
      createRoot(document.getElementById("root")).render(<Page />);
    `,
    "Page.tsx": `
      import { Plain, Memo, LABEL } from "./widgets";
      import { Theme } from "./theme";
      import { Consumer } from "./Consumer";
      import { Fwd } from "./Fwd";
      export function Page() {
        return (
          <div>
            <span id="label">{LABEL}</span>
            <Plain />
            <Memo />
            <Theme.Provider value={LABEL}><Consumer /></Theme.Provider>
            <Fwd />
          </div>
        );
      }
    `,
    // Not a boundary: LABEL is not a component.
    "widgets.tsx": `
      import { memo, useState } from "react";
      import { config } from "./config";
      export const LABEL = "label(" + config + ")";
      export function Plain() {
        const [n, setN] = useState(0);
        return <button id="plain" onClick={() => setN(n => n + 1)}>{"plain " + n}</button>;
      }
      export const Memo = memo(function Memo() {
        const [n, setN] = useState(0);
        return <button id="memo" onClick={() => setN(n => n + 1)}>{"memo " + n}</button>;
      });
    `,
    // Not a boundary: a context is not a component.
    "theme.ts": `
      import { createContext } from "react";
      import { config } from "./config";
      export const themeName = "theme(" + config + ")";
      export const Theme = createContext("none");
    `,
    // A boundary below the provider.
    "Consumer.tsx": `
      import { useContext, useState } from "react";
      import { Theme } from "./theme";
      export function Consumer() {
        const theme = useContext(Theme);
        const [n, setN] = useState(0);
        return <button id="ctx" onClick={() => setN(n => n + 1)}>{theme + " ctx " + n}</button>;
      }
    `,
    // Not a boundary: Bun does not register the result of forwardRef() with react-refresh.
    "Fwd.tsx": `
      import { forwardRef, useState } from "react";
      import { config } from "./config";
      export const Fwd = forwardRef(function Fwd(props, ref) {
        const [n, setN] = useState(0);
        return <button id="fwd" ref={ref} onClick={() => setN(n => n + 1)}>{config + " fwd " + n}</button>;
      });
    `,
    "config.ts": `export const config = "v1";`,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectElemText("#fwd", "v1 fwd 0");
    for (const id of ["plain", "memo", "ctx", "fwd"]) {
      await c.click("#" + id);
      await c.click("#" + id);
    }
    await c.expectElemText("#plain", "plain 2");
    await c.expectElemText("#memo", "memo 2");
    await c.expectElemText("#ctx", "label(v1) ctx 2");
    await c.expectElemText("#fwd", "v1 fwd 2");

    await dev.write("config.ts", `export const config = "v2";`);
    // widgets.tsx runs again, so the label follows the save.
    await c.expectElemText("#label", "label(v2)");
    // A function component keeps its state: Bun registers the new function with react-refresh under the same name.
    await c.expectElemText("#plain", "plain 2");
    // The lines marked "Lost" are the cost. An update that evaluates only config.ts and the boundaries
    // keeps that state, and leaves the label at v1.
    // Lost: memo() makes a new component that react-refresh does not know, so it mounts again.
    await c.expectElemText("#memo", "memo 0");
    // Lost: theme.ts makes a new context. Its provider is a new one, so the consumer mounts again.
    await c.expectElemText("#ctx", "label(v2) ctx 0");
    // Lost: forwardRef() makes a new component too.
    await c.expectElemText("#fwd", "v2 fwd 0");
  },
});

// React keeps what the function that is given to lazy() returned. For a page that fails to load, that is
// a rejected promise. routes.tsx is not a Fast Refresh boundary, so the save that fixes the page evaluates
// it again and makes a new lazy().
devTest("a page that lazy() loads and that fails to load is shown after it is fixed", {
  framework: "react",
  files: {
    "index.html": emptyHtmlFile({ scripts: ["index.tsx"], body: `<div id="root"></div>` }),
    "index.tsx": `
      import { createRoot } from "react-dom/client";
      import { App } from "./App";
      createRoot(document.getElementById("root")).render(<App />);
    `,
    "App.tsx": `
      import { Component, Suspense } from "react";
      import { Page } from "./routes";
      class Boundary extends Component {
        state = { error: null };
        static getDerivedStateFromError(error) {
          return { error };
        }
        render() {
          return this.state.error ? <p id="out">{"failed: " + this.state.error.message}</p> : this.props.children;
        }
      }
      export function App() {
        return (
          <Boundary>
            <Suspense fallback={<p id="out">loading</p>}>
              <Page />
            </Suspense>
          </Boundary>
        );
      }
    `,
    "routes.tsx": `
      import { lazy } from "react";
      export const Page = lazy(() => import("./Page"));
    `,
    "Page.tsx": `
      throw new Error("page failed");
    `,
  },
  async test(dev) {
    // React reports the error that the boundary caught with console.error.
    await using c = await dev.client("/", { errors: [] });
    await c.expectElemText("#out", "failed: page failed");

    await dev.write("Page.tsx", `export default function Page() { return <p id="out">page v2</p>; }`);
    await c.expectElemText("#out", "page v2");
  },
});
