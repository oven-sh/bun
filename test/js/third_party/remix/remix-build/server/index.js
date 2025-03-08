import { createReadableStreamFromReadable } from "@remix-run/node";
import { Links, Meta, Outlet, RemixServer, Scripts, ScrollRestoration } from "@remix-run/react";
import { isbot } from "isbot";
import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { jsx, jsxs } from "react/jsx-runtime";
const ABORT_DELAY = 5e3;
function handleRequest(request, responseStatusCode, responseHeaders, remixContext, loadContext) {
  return isbot(request.headers.get("user-agent") || "")
    ? handleBotRequest(request, responseStatusCode, responseHeaders, remixContext)
    : handleBrowserRequest(request, responseStatusCode, responseHeaders, remixContext);
}
function handleBotRequest(request, responseStatusCode, responseHeaders, remixContext) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = renderToPipeableStream(
      /* @__PURE__ */ jsx(RemixServer, {
        context: remixContext,
        url: request.url,
        abortDelay: ABORT_DELAY,
      }),
      {
        onAllReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          console.log(responseHeaders);
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error(error);
          }
        },
      },
    );
    setTimeout(abort, ABORT_DELAY);
  });
}
function handleBrowserRequest(request, responseStatusCode, responseHeaders, remixContext) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = renderToPipeableStream(
      /* @__PURE__ */ jsx(RemixServer, {
        context: remixContext,
        url: request.url,
        abortDelay: ABORT_DELAY,
      }),
      {
        onShellReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error(error);
          }
        },
      },
    );
    setTimeout(abort, ABORT_DELAY);
  });
}
const entryServer = /* @__PURE__ */ Object.freeze(
  /* @__PURE__ */ Object.defineProperty(
    {
      __proto__: null,
      default: handleRequest,
    },
    Symbol.toStringTag,
    { value: "Module" },
  ),
);
function Layout({ children }) {
  return /* @__PURE__ */ jsxs("html", {
    lang: "en",
    children: [
      /* @__PURE__ */ jsxs("head", {
        children: [
          /* @__PURE__ */ jsx("meta", { charSet: "utf-8" }),
          /* @__PURE__ */ jsx("meta", {
            name: "viewport",
            content: "width=device-width, initial-scale=1",
          }),
          /* @__PURE__ */ jsx(Meta, {}),
          /* @__PURE__ */ jsx(Links, {}),
        ],
      }),
      /* @__PURE__ */ jsxs("body", {
        children: [children, /* @__PURE__ */ jsx(ScrollRestoration, {}), /* @__PURE__ */ jsx(Scripts, {})],
      }),
    ],
  });
}
function App() {
  return /* @__PURE__ */ jsx(Outlet, {});
}
const route0 = /* @__PURE__ */ Object.freeze(
  /* @__PURE__ */ Object.defineProperty(
    {
      __proto__: null,
      Layout,
      default: App,
    },
    Symbol.toStringTag,
    { value: "Module" },
  ),
);
const meta = () => {
  return [{ title: "New Remix App" }, { name: "description", content: "Welcome to Remix!" }];
};
function Index() {
  return /* @__PURE__ */ jsxs("div", {
    className: "font-sans p-4",
    children: [
      /* @__PURE__ */ jsx("h1", {
        className: "text-3xl",
        children: "Welcome to Remix",
      }),
      /* @__PURE__ */ jsxs("ul", {
        className: "list-disc mt-4 pl-6 space-y-2",
        children: [
          /* @__PURE__ */ jsx("li", {
            children: /* @__PURE__ */ jsx("a", {
              className: "text-blue-700 underline visited:text-purple-900",
              target: "_blank",
              href: "https://remix.run/start/quickstart",
              rel: "noreferrer",
              children: "5m Quick Start",
            }),
          }),
          /* @__PURE__ */ jsx("li", {
            children: /* @__PURE__ */ jsx("a", {
              className: "text-blue-700 underline visited:text-purple-900",
              target: "_blank",
              href: "https://remix.run/start/tutorial",
              rel: "noreferrer",
              children: "30m Tutorial",
            }),
          }),
          /* @__PURE__ */ jsx("li", {
            children: /* @__PURE__ */ jsx("a", {
              className: "text-blue-700 underline visited:text-purple-900",
              target: "_blank",
              href: "https://remix.run/docs",
              rel: "noreferrer",
              children: "Remix Docs",
            }),
          }),
        ],
      }),
    ],
  });
}
const route1 = /* @__PURE__ */ Object.freeze(
  /* @__PURE__ */ Object.defineProperty(
    {
      __proto__: null,
      default: Index,
      meta,
    },
    Symbol.toStringTag,
    { value: "Module" },
  ),
);
const serverManifest = {
  entry: {
    module: "/assets/entry.client-ER-smVHW.js",
    imports: ["/assets/jsx-runtime-56DGgGmo.js", "/assets/components-BI_hnQlH.js"],
    css: [],
  },
  routes: {
    root: {
      id: "root",
      parentId: void 0,
      path: "",
      index: void 0,
      caseSensitive: void 0,
      hasAction: false,
      hasLoader: false,
      hasClientAction: false,
      hasClientLoader: false,
      hasErrorBoundary: false,
      module: "/assets/root-CBMuz_vA.js",
      imports: ["/assets/jsx-runtime-56DGgGmo.js", "/assets/components-BI_hnQlH.js"],
      css: ["/assets/root-BFUH26ow.css"],
    },
    "routes/_index": {
      id: "routes/_index",
      parentId: "root",
      path: void 0,
      index: true,
      caseSensitive: void 0,
      hasAction: false,
      hasLoader: false,
      hasClientAction: false,
      hasClientLoader: false,
      hasErrorBoundary: false,
      module: "/assets/_index-B6hwyHK-.js",
      imports: ["/assets/jsx-runtime-56DGgGmo.js"],
      css: [],
    },
  },
  url: "/assets/manifest-c2e02a52.js",
  version: "c2e02a52",
};
const mode = "production";
const assetsBuildDirectory = "build/client";
const basename = "/";
const future = {
  v3_fetcherPersist: true,
  v3_relativeSplatPath: true,
  v3_throwAbortReason: true,
  unstable_singleFetch: false,
  unstable_fogOfWar: false,
};
const isSpaMode = false;
const publicPath = "/";
const entry = { module: entryServer };
const routes = {
  root: {
    id: "root",
    parentId: void 0,
    path: "",
    index: void 0,
    caseSensitive: void 0,
    module: route0,
  },
  "routes/_index": {
    id: "routes/_index",
    parentId: "root",
    path: void 0,
    index: true,
    caseSensitive: void 0,
    module: route1,
  },
};
export { serverManifest as assets, assetsBuildDirectory, basename, entry, future, isSpaMode, mode, publicPath, routes };
