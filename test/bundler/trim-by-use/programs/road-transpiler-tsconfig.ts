const transpiler = new Bun.Transpiler({
  loader: "tsx",
  tsconfig: { compilerOptions: { jsx: "react", jsxFactory: "h" } },
});
console.log(transpiler.transformSync("export const a = <b />;").trim());
