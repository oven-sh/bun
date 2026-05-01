import { expectType } from "./utilities";

import { env as bun_env } from "bun";
import { env as node_env } from "node:process";

declare module "bun" {
  interface Env {
    FOO: "FOO";
  }
}
expectType(Bun.env.FOO).is<"FOO">();
expectType(process.env.FOO).is<"FOO">();
expectType(import.meta.env.FOO).is<"FOO">();
expectType(bun_env.FOO).is<"FOO">();
expectType(node_env.FOO).is<"FOO">();

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      BAR: "BAR";
    }
  }
}
expectType(Bun.env.BAR).is<"BAR">();
expectType(process.env.BAR).is<"BAR">();
expectType(import.meta.env.BAR).is<"BAR">();
expectType(node_env.BAR).is<"BAR">();
expectType(bun_env.BAR).is<"BAR">();

declare global {
  interface ImportMetaEnv {
    BAZ: "BAZ";
  }
}
expectType(Bun.env.BAZ).is<"BAZ">();
// expectType(process.env.BAZ).is<"BAZ">(); // ProcessEnv does NOT extend ImportMetaEnv
expectType(import.meta.env.BAZ).is<"BAZ">();
// expectType(node_env.BAZ).is<"BAZ">(); // ProcessEnv does NOT extend ImportMetaEnv
expectType(bun_env.BAZ).is<"BAZ">();

expectType(Bun.env.OTHER).is<string | undefined>();
expectType(process.env.OTHER).is<string | undefined>();
expectType(import.meta.env.OTHER).is<string | undefined>();
expectType(node_env.OTHER).is<string | undefined>();
expectType(bun_env.OTHER).is<string | undefined>();

function isAllSame<T>(a: T, b: T, c: T, d: T, e: T) {
  return a === b && b === c && c === d && d === e;
}

//prettier-ignore
{

  isAllSame              <"FOO"> (process.env.FOO,   Bun.env.FOO,   import.meta.env.FOO,   node_env.FOO,   bun_env.FOO);
  isAllSame              <"BAR"> (process.env.BAR,   Bun.env.BAR,   import.meta.env.BAR,   node_env.BAR,   bun_env.BAR);
  isAllSame              <"BAZ"> (          "BAZ",   Bun.env.BAZ,   import.meta.env.BAZ,          "BAZ",   bun_env.BAZ); // ProcessEnv does NOT extend ImportMetaEnv
  isAllSame <string | undefined> (process.env.OTHER, Bun.env.OTHER, import.meta.env.OTHER, node_env.OTHER, bun_env.OTHER);

}
