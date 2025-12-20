import { expectType } from "./utilities";

const fixtures = import.meta.glob("./**/*.ts");
for (const [file, importFn] of Object.entries(fixtures)) {
  console.log(file, await importFn());
}
expectType<Record<string, () => Promise<any>>>(fixtures);

const http = import.meta.glob(["*.html", "**/*.html"], { with: { type: "text" } });
expectType<Record<string, () => Promise<any>>>(http);

const tests = import.meta.glob("*.test.ts", { base: "../", eager: false });
expectType<Record<string, () => Promise<any>>>(tests);

const jsons = import.meta.glob<false, Record<string, number>>("*.json");
expectType<Record<string, () => Promise<Record<string, number>>>>(jsons);

const jsons2 = import.meta.glob<Record<string, number>>("*.json");
expectType<Record<string, () => Promise<Record<string, number>>>>(jsons2);

// @ts-expect-error: right now bun doesn't support eager
const eagerJsons = import.meta.glob<Record<string, number>>("*.json", { eager: true });
// @ts-expect-error: right now bun doesn't support eager
expectType<Record<string, Record<string, number>>>(eagerJsons);

expectType<string>(import.meta.dir);
expectType<string>(import.meta.dirname);
expectType<string>(import.meta.file);
expectType<string>(import.meta.path);
expectType<string>(import.meta.url);
expectType<boolean>(import.meta.main);
expectType<string>(import.meta.resolve("zod"));
expectType<Record<string, () => Promise<any>>>(import.meta.glob("*"));
expectType<Object>(import.meta.hot);
