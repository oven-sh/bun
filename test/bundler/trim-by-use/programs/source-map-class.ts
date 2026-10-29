import { SourceMap } from "node:module";
const map = new SourceMap({
  version: 3,
  file: "out.js",
  sources: ["a.ts"],
  names: [],
  sourcesContent: ["let x = 1"],
  mappings: "AAAA,IAAI",
} as any);
const entry: any = map.findEntry(0, 4);
console.log(entry.originalSource, entry.originalLine, entry.originalColumn);
