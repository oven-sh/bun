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

// bun.lock: the info object of a tarball, git or github package can carry the package.json version.
declare const lockfile: Bun.BunLockFile;
const tarballRow = ["pkg@https://example.com/pkg.tgz", { version: "1.2.3" }] satisfies Bun.BunLockFilePackageArray;
tsd.expectType(tarballRow[1].version).is<string>();
const gitRow = [
  "pkg@git+https://example.com/pkg.git#abc",
  { version: "" },
  "abc",
] satisfies Bun.BunLockFilePackageArray;
tsd.expectType(gitRow[2]).is<string>();
for (const row of Object.values(lockfile.packages)) {
  if (row.length === 4) {
    tsd.expectType(row[2].version).is<string | undefined>();
  }
}
