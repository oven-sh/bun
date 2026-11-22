import { writeFileSync } from "node:fs";
writeFileSync("in.js", "console.log(1 + 1)");
const result = await Bun.build({
  entrypoints: ["./in.js"],
  bytecode: true,
  target: "bun",
  format: "cjs",
  outdir: "./out",
});
console.log(
  result.success,
  result.outputs
    .map(output => output.kind)
    .sort()
    .join(","),
);
