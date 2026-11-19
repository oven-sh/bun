import { readdirSync } from "node:fs";
import { join } from "node:path";
import { importByPath, requireByPath } from "fake-merge";
import { importByPathInTheMiddle } from "../src/settings";
import { check } from "../src/show";
const F = "67";
const folder = join(import.meta.dir, "../src/found-by-path");
const loads = () => [(globalThis as any).loadsOfPlugin1, (globalThis as any).loadsOfPlugin2, (globalThis as any).loadsOfPlugin9];
// This file alone names the plugins, under names that the build puts together. The package and the application are handed the path.
check(F, "a package imports what this file alone names", async () => { const got = await importByPath(folder + "/plugin-1.ts"); const mine = await import(join(import.meta.dir, "../src/found-by-path/plugin-1.ts")); return [got === mine, got.readByNobodyHere, got.sameText(), got.call() === mine.calls, Object.keys(got), loads()[0]]; });
check(F, "the application imports it", async () => { const got = await importByPathInTheMiddle(folder + "/plugin-1.ts"); const mine = await import(join(import.meta.dir, "../src/found-by-path/plugin-1.ts")); return [got === mine, got["readBy" + "NobodyHere"], new got.Plugin().describe(), new got.Plugin() instanceof mine.Plugin, got.default, loads()[0]]; });
check(F, "a package requires a CommonJS file that this file alone names", () => { const got = requireByPath(folder + "/plugin-2.cjs"); const mine = require(join(import.meta.dir, "../src/found-by-path/plugin-2.cjs")); return [got === mine, got.readByNobodyHere, got.call() + 1 === mine.call(), got.about(), Object.keys(got), loads()[1]]; });
check(F, "a package imports that CommonJS file", async () => { const got = await importByPath(folder + "/plugin-2.cjs"); return [got.default === require(join(import.meta.dir, "../src/found-by-path/plugin-2.cjs")), got.default.readByNobodyHere, loads()[1]]; });
// What this file imports itself it only compares: every export is read off what came back from below.
check(F, "exports that are read only off what the package hands back", async () => { const got = await importByPath(folder + "/plugin-3.ts"); const mine = await import(join(import.meta.dir, "../src/found-by-path/plugin-3.ts")); return [got.seenOnlyThroughThePackage, got === mine, got.middleMode]; });
// Nobody names this one: its name comes from the disk.
check(F, "a file that no build has read", async () => { const name = readdirSync(folder).sort().at(-1)!; const [a, b, c] = [await importByPath(folder + "/" + name), await importByPathInTheMiddle(folder + "/" + name), await import(folder + "/" + name)]; return [name, a === b, b === c, a.text, b.twice(21), Object.keys(c), loads()[2]]; });
check(F, "a path that leads nowhere", async () => [await importByPath(folder + "/none.ts").then(() => "loaded", (error: any) => error.code ?? error.name), await importByPathInTheMiddle(folder + "/none.ts").then(() => "loaded", (error: any) => error.code ?? error.name)]);
