import { expectTypeOf, inject } from "vitest";

declare module "vitest" {
  interface ProvidedContext {
    port: number;
  }
}

expectTypeOf(inject("port")).toEqualTypeOf<number | undefined>();
