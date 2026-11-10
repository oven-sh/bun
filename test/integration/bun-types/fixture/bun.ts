import { plugin, type BunFile, type BunPlugin, type FileBlob } from "bun";
import * as tsd from "./utilities";
{
  const _plugin: BunPlugin = {
    name: "asdf",
    setup() {},
  };
  _plugin;
}

{
  // tslint:disable-next-line:no-void-expression
  const arg = Bun.plugin({
    name: "arg",
    setup() {},
  });

  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  tsd.expectType<void>(arg);
}

{
  // tslint:disable-next-line:no-void-expression
  const arg = Bun.plugin({
    name: "arg",
    async setup() {},
  });

  tsd.expectType<Promise<void>>(arg);
}

// `Bun.plugin` gives `setup()` a builder that takes only the loaders that the runtime accepts. It applies where
// TypeScript infers the type of `build` from the call.
{
  type RuntimeLoader =
    "js" | "jsx" | "ts" | "tsx" | "json" | "jsonc" | "json5" | "toml" | "yaml" | "xml" | "text" | "md" | "css";
  const loader = "css" as RuntimeLoader;

  Bun.plugin({
    name: "loaders that the runtime accepts",
    setup(build) {
      build.onLoad({ filter: /a/ }, () => ({ contents: "", loader }));
      build.onLoad({ filter: /b/ }, async () => ({ contents: "", loader }));
      build.onLoad({ filter: /c/ }, () => ({ contents: "" }));
      build.onLoad({ filter: /d/ }, () => ({ contents: "", loader: undefined }));
      build.onLoad({ filter: /e/ }, () => ({ exports: { a: 1 }, loader: "object" }));
      build.onLoad({ filter: /f/ }, () => undefined);
      build.onLoad({ filter: /g/ }, async () => null);
      build.onLoad({ filter: /h/ }, () => {});
      build.module("virtual:a", () => ({ contents: "", loader }));
      build.module("virtual:b", async () => ({ exports: { a: 1 }, loader: "object" }));
    },
  });

  Bun.plugin({
    name: "loaders that only Bun.build accepts",
    setup(build) {
      // @ts-expect-error
      build.onLoad({ filter: /a/ }, () => ({ contents: "", loader: "file" }));
      // @ts-expect-error
      build.onLoad({ filter: /b/ }, () => ({ contents: "", loader: "napi" }));
      // @ts-expect-error
      build.onLoad({ filter: /c/ }, () => ({ contents: "", loader: "wasm" }));
      // @ts-expect-error
      build.onLoad({ filter: /d/ }, () => ({ contents: "", loader: "html" }));
      // @ts-expect-error
      build.onLoad({ filter: /e/ }, async () => ({ contents: "", loader: "file" }));
      // @ts-expect-error
      build.onLoad({ filter: /f/ }, ({ path }) => ({ contents: "", ...(path ? { loader: "file" } : {}) }));
      const chained = build.onResolve({ filter: /g/ }, () => undefined);
      // @ts-expect-error
      chained.onLoad({ filter: /g/ }, () => ({ contents: "", loader: "file" }));
      // @ts-expect-error
      build.module("virtual:a", () => ({ contents: "", loader: "file" }));
      // @ts-expect-error
      build.module("virtual:b", async () => ({ contents: "", loader: "html" }));
    },
  });

  plugin({
    name: "the same check through the import",
    setup(build) {
      // @ts-expect-error
      build.onLoad({ filter: /a/ }, () => ({ contents: "", loader: "file" }));
    },
  });

  // A plugin that is typed `BunPlugin` can go to Bun.build too, so it keeps every `Bun.Loader`.
  const universal: BunPlugin = {
    name: "universal",
    setup(build) {
      build.onLoad({ filter: /a/ }, () => ({ contents: "", loader: "file" }));
    },
  };
  Bun.plugin(universal);
  Bun.build({ entrypoints: ["a"], plugins: [universal] });

  // A value with one of the shared types can hold a name that the runtime rejects.
  const sharedCallback = (() => ({ contents: "", loader: "ts" })) as Bun.OnLoadCallback;
  const sharedLoader = "ts" as Bun.Loader;
  Bun.plugin({
    name: "values with the shared types",
    setup(build) {
      // @ts-expect-error
      build.onLoad({ filter: /a/ }, sharedCallback);
      // @ts-expect-error
      build.onLoad({ filter: /b/ }, () => ({ contents: "", loader: sharedLoader }));
      // @ts-expect-error
      build.onLoad({ filter: /c/ }, args => ({ contents: "", loader: args.loader }));
    },
  });

  // A plugin that asks for the shared builder keeps the shared types.
  const registerShared = (build: Bun.PluginBuilder) => build.onLoad({ filter: /a/ }, sharedCallback);
  Bun.plugin({
    name: "a helper that takes the shared builder",
    setup(build) {
      registerShared(build);
    },
  });
  Bun.plugin({
    name: "a setup that takes the shared builder",
    setup(build: Bun.PluginBuilder) {
      build.onLoad({ filter: /a/ }, () => ({ contents: "", loader: sharedLoader }));
    },
  });
  Bun.plugin<BunPlugin>({
    name: "a type argument",
    setup(build) {
      build.onLoad({ filter: /a/ }, sharedCallback);
    },
  });
}

{
  const f = Bun.file("asdf");
  tsd.expectType<BunFile>(f);
  tsd.expectType<FileBlob>(f);
}
{
  Bun.spawn(["anything"], {
    env: process.env,
  });
  Bun.spawn(["anything"], {
    env: { ...process.env },
  });
  Bun.spawn(["anything"], {
    env: { ...process.env, dummy: "" },
  });
}
{
  Bun.TOML.parse("asdf = asdf");
}

DOMException;

tsd
  .expectType(
    Bun.secrets.get({
      service: "hey",
      name: "hey",
    }),
  )
  .is<Promise<string | null>>();

tsd
  .expectType(
    Bun.secrets.set({
      service: "hey",
      name: "hey",
      value: "hey",
      allowUnrestrictedAccess: true,
    }),
  )
  .is<Promise<void>>();

Bun.secrets.set({ service: "hey", name: "hey", value: "hey", persist: "local" });
Bun.secrets.set({ service: "hey", name: "hey", value: "hey", persist: "enterprise" });
Bun.secrets.set({ service: "hey", name: "hey", value: "hey", persist: undefined });
// @ts-expect-error - Bun does not expose CRED_PERSIST_SESSION
Bun.secrets.set({ service: "hey", name: "hey", value: "hey", persist: "session" });

tsd
  .expectType(
    Bun.secrets.delete({
      service: "hey",
      name: "hey",
    }),
  )
  .is<Promise<boolean>>();

tsd
  .expectType(
    Bun.mmap("./data.bin", {
      shared: true,
      sync: false,
      offset: 4096,
      size: 1024,
    }),
  )
  .is<Uint8Array<ArrayBuffer>>();

tsd.expectType(Bun.mmap("./data.bin", { offset: 4096 })).is<Uint8Array<ArrayBuffer>>();
tsd.expectType(Bun.mmap("./data.bin", { size: 1024 })).is<Uint8Array<ArrayBuffer>>();

declare const webview: Bun.WebView;
tsd.expectType(webview.goBack()).is<Promise<void>>();
tsd.expectType(webview.goForward()).is<Promise<void>>();
