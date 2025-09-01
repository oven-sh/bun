import { expect } from "bun:test";
import { devTest, minimalFramework } from "../bake-harness";

devTest("server starts with default configuration", {
  framework: minimalFramework,
  files: {
    "routes/index.ts": `
export default function (req, meta) {
  return new Response("Hello World");
}
`,
  },
  async test(dev) {
    const response = await dev.fetch("/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello World");
  },
});

devTest("server starts with console: false configuration", {
  files: {
    "minimal.server.ts": `
import { Bake } from "bun";

export function render(req: Request, meta: Bake.RouteMetadata) {
  if (typeof meta.pageModule.default !== "function") {
    console.error("pageModule === ", meta.pageModule);
    throw new Error("Expected default export to be a function");
  }
  return meta.pageModule.default(req, meta);
}

export function registerClientReference(value: any, file: any, uid: any) {
  return {
    value,
    file,
    uid,
  };
}
`,
    "bun.app.ts": `
export default {
  port: 0,
  app: {
    framework: {
      fileSystemRouterTypes: [
        {
          root: "routes",
          style: "nextjs-pages",
          serverEntryPoint: "./minimal.server.ts",
        },
      ],
      serverComponents: {
        separateSSRGraph: false,
        serverRuntimeImportSource: "./minimal.server.ts",
        serverRegisterClientReferenceExport: "registerClientReference",
      },
    },
  },
  development: {
    console: false,
  },
};
`,
    "routes/index.ts": `
export default function (req, meta) {
  return new Response("Hello World with console false");
}
`,
  },
  async test(dev) {
    const response = await dev.fetch("/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello World with console false");
  },
});