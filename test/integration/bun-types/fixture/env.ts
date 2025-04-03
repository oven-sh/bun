import { expectType } from "./utilities";

declare module "bun" {
  interface Env {
    FOO: "FOO";
  }
}
expectType<"FOO">(Bun.env.FOO);
expectType<"FOO">(process.env.FOO);

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      BAR: "BAR";
    }
  }
}
expectType<"BAR">(process.env.BAR);

process.env.FOO;
process.env.BAR;
process.env.OTHER;
Bun.env.FOO;
Bun.env.BAR;
