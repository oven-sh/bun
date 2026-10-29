// node:module's SourceMap decodes mappings (the same decoder reads the maps inside an executable built with --sourcemap)
import { SourceMap } from "node:module";
const map = new SourceMap({
  version: 3,
  file: "out.js",
  sources: ["a.ts", "b.ts"],
  names: ["x"],
  sourcesContent: ["let x = 1", "x"],
  mappings: "AAAA,IAAIA;ACAJ,CAAC",
} as any);
const first: any = map.findEntry(0, 4);
const second: any = map.findEntry(1, 1);
console.log(
  first.originalSource,
  first.originalLine,
  first.originalColumn,
  first.name,
  second.originalSource,
  second.originalLine,
  second.originalColumn,
);
console.log(JSON.stringify(map.payload.sources), JSON.stringify(map.findOrigin(1, 5)));
function fail(): never {
  throw new Error("mapped");
}
try {
  fail();
} catch (error) {
  console.log(
    String((error as Error).stack)
      .split("\n")
      .slice(0, 2)
      .map(line => line.replace(/\(.*[\\/]/, "("))
      .join(" | "),
  );
}
