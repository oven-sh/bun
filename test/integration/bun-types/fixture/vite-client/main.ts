import { expectType } from "../utilities";

interface Page {
  title: string;
}

expectType<ImportMeta["glob"]>().is<ViteGlobFunction>();

expectType(import.meta.glob("./pages/*.md")).is<Record<string, () => Promise<unknown>>>();
expectType(import.meta.glob("./pages/*.md", { eager: true })).is<Record<string, unknown>>();
expectType(import.meta.glob("./pages/*.md", { as: "raw" })).is<Record<string, () => Promise<string>>>();
expectType(import.meta.glob("./pages/*.md", { as: "url", eager: true })).is<Record<string, string>>();
expectType(import.meta.glob<Page>("./pages/*.md")).is<Record<string, () => Promise<Page>>>();
expectType(import.meta.glob<Page>("./pages/*.md", { eager: true })).is<Record<string, Page>>();
expectType(import.meta.glob<true, string, Page>("./pages/*.md", { eager: true })).is<Record<string, Page>>();
import.meta.glob("./pages/*.MD", { caseSensitive: false });

// @ts-expect-error there is no such option
import.meta.glob("./pages/*.md", { nope: true });

expectType(import.meta.dir).is<string>();
expectType(Bun.version).is<string>();
