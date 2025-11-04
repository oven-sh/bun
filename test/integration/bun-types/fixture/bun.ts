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

tsd
  .expectType(
    Bun.secrets.delete({
      service: "hey",
      name: "hey",
    }),
  )
  .is<Promise<boolean>>();
