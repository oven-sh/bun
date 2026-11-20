// A reader for `judge.mjs --reader`: the native TypeScript, which is the package `typescript7` in test/package.json.
//
//   node judge.mjs --modules=<dir> --bun=<bun> --matrix --reader=typescript7.mjs
//
// It gets the directory of `--modules` as its argument, and a JSON array of `{ text, ext }` on standard input. It
// prints one `{ diags, shape }` for each text: the messages of the syntax errors, and the tree without parentheses.
// The API of the package reads the files of a project, so the texts go to a temporary directory.
import fs from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(join(resolve(process.argv[2]), "noop.js"));
const base = dirname(require.resolve("typescript7/package.json"));
const { API } = await import(pathToFileURL(join(base, "dist/api/sync/api.js")).href);
const { SyntaxKind } = await import(pathToFileURL(join(base, "dist/ast/index.js")).href);

const texts = JSON.parse(fs.readFileSync(0, "utf8"));
const directory = fs.mkdtempSync(join(tmpdir(), "arrow-parens-typescript7-"));
const path = index => join(directory, "texts", `${index}.${texts[index].ext}`);
fs.mkdirSync(join(directory, "texts"));
texts.forEach(({ text }, index) => fs.writeFileSync(path(index), text));
const compilerOptions = { noCheck: true, noLib: true, noResolve: true, noEmit: true, types: [] };
fs.writeFileSync(
  join(directory, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: { ...compilerOptions, target: "esnext", module: "preserve", jsx: "preserve" },
    include: ["texts"],
  }),
);

const api = new API({ cwd: directory });
try {
  const project = { openProjects: [join(directory, "tsconfig.json")] };
  // 7.0 has `updateSnapshot` for this, and 7.1 has `createSnapshot`.
  const snapshot = (api.createSnapshot ?? api.updateSnapshot).call(api, project);
  const program = snapshot.getProjects()[0].program;
  const shape = node => {
    if (node.kind === SyntaxKind.ParenthesizedExpression) return shape(node.expression);
    // Prettier prints `T` for `| T`, which is a union of one type.
    const isOneType = node.kind === SyntaxKind.UnionType || node.kind === SyntaxKind.IntersectionType;
    if (isOneType && node.types.length === 1) return shape(node.types[0]);
    const children = [];
    node.forEachChild(child => void children.push(shape(child)));
    const name = SyntaxKind[node.kind];
    return children.length ? `${name}(${children.join(" ")})` : `${name} ${node.getText()}`;
  };
  const readings = texts.map((_, index) => {
    const diags = Array.from(program.getSyntacticDiagnostics(path(index)), diagnostic => diagnostic.text);
    const file = diags.length ? null : program.getSourceFile(path(index));
    return { diags, shape: file ? Array.from(file.statements, shape).join(" ") : "" };
  });
  console.log(JSON.stringify(readings));
} finally {
  api.close();
  fs.rmSync(directory, { recursive: true, force: true });
}
