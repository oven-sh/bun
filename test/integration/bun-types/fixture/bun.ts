import { randomCUID2, type BunFile, type BunPlugin, type FileBlob } from "bun";
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

tsd.expectType(Bun.randomCUID2()).is<string>();
tsd.expectType(Bun.randomCUID2(2)).is<string>();
tsd.expectType(Bun.randomCUID2(32)).is<string>();
tsd.expectType(randomCUID2()).is<string>();

// @ts-expect-error `length` must be a number.
Bun.randomCUID2("24");
// @ts-expect-error `randomCUID2` accepts at most one argument.
Bun.randomCUID2(24, 24);
