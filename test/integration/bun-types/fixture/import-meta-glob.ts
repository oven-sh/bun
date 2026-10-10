import { expectType } from "./utilities";

interface Page {
  default: () => string;
}

expectType(import.meta.glob("./pages/*.tsx")).is<Record<string, () => Promise<unknown>>>();
expectType(import.meta.glob(["./pages/*.tsx", "!**/skip.tsx"])).is<Record<string, () => Promise<unknown>>>();
expectType(import.meta.glob("./pages/*.tsx", {})).is<Record<string, () => Promise<unknown>>>();
expectType(import.meta.glob("./pages/*.tsx", { eager: false })).is<Record<string, () => Promise<unknown>>>();
expectType(import.meta.glob("./pages/*.tsx", { eager: true })).is<Record<string, unknown>>();

expectType(import.meta.glob<Page>("./pages/*.tsx")).is<Record<string, () => Promise<Page>>>();
expectType(import.meta.glob<Page>("./pages/*.tsx", { eager: true })).is<Record<string, Page>>();
expectType(import.meta.glob<Page["default"]>("./pages/*.tsx", { import: "default", eager: true })).is<
  Record<string, () => string>
>();

import.meta.glob("./**/*.sql", {
  import: "default",
  query: "?raw",
  base: "./queries",
  exhaustive: true,
});
import.meta.glob("./pages/*.tsx", { query: { a: "b", c: 1, d: true } });

const options: Bun.ImportMetaGlobOptions = { eager: true };
expectType(options.eager).is<boolean | undefined>();

// @ts-expect-error a pattern is required
import.meta.glob();
// @ts-expect-error a pattern is a string
import.meta.glob(1);
// @ts-expect-error there is no such option
import.meta.glob("./pages/*.tsx", { nope: true });
// @ts-expect-error eager is a boolean
import.meta.glob("./pages/*.tsx", { eager: "yes" });
// @ts-expect-error a query has no nested values
import.meta.glob("./pages/*.tsx", { query: { a: {} } });
