import { expectType } from "../utilities";

declare const viteMeta: ViteRuntimeImportMeta;
declare const runnerMeta: ModuleRunnerImportMeta;

// A vite `ImportMeta` is a Bun `ImportMeta`, and its `hot` fits Bun's.
export const meta: ImportMeta = viteMeta;
export const bunHot: ImportMeta["hot"] = viteMeta.hot;
export const runnerHot: ImportMeta["hot"] = runnerMeta.hot;
expectType(viteMeta.hot).is<ViteHotContext | undefined>();
expectType(runnerMeta.hot).is<ViteHotContext | undefined>();

if (viteMeta.hot) {
  viteMeta.hot.accept();
  viteMeta.hot.on("vite:beforeUpdate", payload => {
    expectType(payload).is<{ type: "update" }>();
  });
}

expectType(import.meta.dir).is<string>();
expectType(Bun.version).is<string>();
