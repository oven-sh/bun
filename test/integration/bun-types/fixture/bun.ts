import type { BunFile, BunPlugin, FileBlob } from "bun";
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

tsd.expectType(Bun.secrets.get("hey", "hey")).is<Promise<string | null>>();
tsd.expectType(Bun.secrets.set("hey", "hey", "hey")).is<Promise<void>>();
tsd.expectType(Bun.secrets.delete("hey", "hey")).is<Promise<boolean>>();
// @ts-expect-error - the value is not optional
Bun.secrets.set("hey", "hey");
// @ts-expect-error - the name is not optional
Bun.secrets.get("hey");
// @ts-expect-error - the name is not optional
Bun.secrets.delete("hey");
// The options stay the parameters that a wrapper or a mock reads from the types.
tsd.expectType<Parameters<typeof Bun.secrets.get>>().is<[options: { service: string; name: string }]>();
tsd.expectType<Parameters<typeof Bun.secrets.delete>>().is<[options: { service: string; name: string }]>();
tsd.expectType<Parameters<typeof Bun.secrets.set>[0]["value"]>().is<string>();

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
