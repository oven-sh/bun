import { expectType } from "../utilities";

declare const viteMeta: ViteRuntimeImportMeta;
declare const runnerMeta: ModuleRunnerImportMeta;

// A vite `ImportMeta` is a Bun `ImportMeta`, and its `hot` fits Bun's.
const meta: ImportMeta = viteMeta;
const bunHot: ImportMeta["hot"] = viteMeta.hot;
const runnerHot: ImportMeta["hot"] = runnerMeta.hot;
expectType(meta.hot).is<ImportMeta["hot"]>();
expectType(bunHot).is<ImportMeta["hot"]>();
expectType(runnerHot).is<ImportMeta["hot"]>();

if (viteMeta.hot) {
  viteMeta.hot.accept();
  viteMeta.hot.on("vite:beforeUpdate", payload => {
    expectType(payload).is<{ type: "update" }>();
  });
}

expectType(import.meta.dir).is<string>();
expectType(Bun.version).is<string>();
