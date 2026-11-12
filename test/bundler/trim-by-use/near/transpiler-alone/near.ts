console.log(new Bun.Transpiler({ loader: "ts" }).transformSync("const one: number = 1; console.log(one);"));
