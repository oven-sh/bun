// The Effect packages ship their TypeScript sources in src/ next to the compiled dist/. This points the `exports` of the installed
// packages at the sources, which is what the same package.json files say in Effect's own repository.
// Effect is written against the DOM library (TextDecoder, Transferable, ReadableStream). Without it the sources have type errors
// under this folder's tsconfig.json, and a package with a type error is compiled untyped.
import { readFileSync, writeFileSync } from "node:fs"

for (const name of ["effect", "@effect/platform-bun", "@effect/platform-node", "@effect/platform-node-shared"]) {
  const path = `${import.meta.dirname}/node_modules/${name}/package.json`
  const manifest = JSON.parse(readFileSync(path, "utf8"))
  for (const [key, target] of Object.entries(manifest.exports)) {
    if (typeof target === "string" && target.startsWith("./dist/")) {
      manifest.exports[key] = target.replace("./dist/", "./src/").replace(/\.js$/, ".ts")
    }
  }
  writeFileSync(path, JSON.stringify(manifest, null, 2))
}

const tsconfig = JSON.parse(readFileSync(`${import.meta.dirname}/tsconfig.json`, "utf8"))
tsconfig.compilerOptions.lib = ["ESNext", "DOM", "DOM.Iterable", "DOM.AsyncIterable"]
writeFileSync(`${import.meta.dirname}/tsconfig.json`, JSON.stringify(tsconfig, null, 2))
