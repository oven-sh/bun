interface Context { depth: number }
interface In0 { v0: number }
interface Tool0 { name: "t0"; run(input: In0, context: Context): number; make(): In0 }
interface In1 { v1: number }
interface Tool1 { name: "t1"; run(input: In1, context: Context): number; make(): In1 }
interface In2 { v2: number }
interface Tool2 { name: "t2"; run(input: In2, context: Context): number; make(): In2 }
interface In3 { v3: number }
interface Tool3 { name: "t3"; run(input: In3, context: Context): number; make(): In3 }
interface In4 { v4: number }
interface Tool4 { name: "t4"; run(input: In4, context: Context): number; make(): In4 }
interface In5 { v5: number }
interface Tool5 { name: "t5"; run(input: In5, context: Context): number; make(): In5 }
interface In6 { v6: number }
interface Tool6 { name: "t6"; run(input: In6, context: Context): number; make(): In6 }
interface In7 { v7: number }
interface Tool7 { name: "t7"; run(input: In7, context: Context): number; make(): In7 }
interface In8 { v8: number }
interface Tool8 { name: "t8"; run(input: In8, context: Context): number; make(): In8 }
interface In9 { v9: number }
interface Tool9 { name: "t9"; run(input: In9, context: Context): number; make(): In9 }
interface In10 { v10: number }
interface Tool10 { name: "t10"; run(input: In10, context: Context): number; make(): In10 }
interface In11 { v11: number }
interface Tool11 { name: "t11"; run(input: In11, context: Context): number; make(): In11 }
interface In12 { v12: number }
interface Tool12 { name: "t12"; run(input: In12, context: Context): number; make(): In12 }
interface In13 { v13: number }
interface Tool13 { name: "t13"; run(input: In13, context: Context): number; make(): In13 }
interface In14 { v14: number }
interface Tool14 { name: "t14"; run(input: In14, context: Context): number; make(): In14 }
interface In15 { v15: number }
interface Tool15 { name: "t15"; run(input: In15, context: Context): number; make(): In15 }
interface In16 { v16: number }
interface Tool16 { name: "t16"; run(input: In16, context: Context): number; make(): In16 }
interface In17 { v17: number }
interface Tool17 { name: "t17"; run(input: In17, context: Context): number; make(): In17 }
type AnyTool = Tool0 | Tool1 | Tool2 | Tool3 | Tool4 | Tool5 | Tool6 | Tool7 | Tool8 | Tool9 | Tool10 | Tool11 | Tool12 | Tool13 | Tool14 | Tool15 | Tool16 | Tool17;
const tool0: Tool0 = { name: "t0", run: (input, context) => input.v0 + context.depth, make: () => ({ v0: 0 }) };
const tool1: Tool1 = { name: "t1", run: (input, context) => input.v1 + context.depth, make: () => ({ v1: 1 }) };
const tool2: Tool2 = { name: "t2", run: (input, context) => input.v2 + context.depth, make: () => ({ v2: 2 }) };
const tool3: Tool3 = { name: "t3", run: (input, context) => input.v3 + context.depth, make: () => ({ v3: 3 }) };
const tool4: Tool4 = { name: "t4", run: (input, context) => input.v4 + context.depth, make: () => ({ v4: 4 }) };
const tool5: Tool5 = { name: "t5", run: (input, context) => input.v5 + context.depth, make: () => ({ v5: 5 }) };
const tool6: Tool6 = { name: "t6", run: (input, context) => input.v6 + context.depth, make: () => ({ v6: 6 }) };
const tool7: Tool7 = { name: "t7", run: (input, context) => input.v7 + context.depth, make: () => ({ v7: 7 }) };
const tool8: Tool8 = { name: "t8", run: (input, context) => input.v8 + context.depth, make: () => ({ v8: 8 }) };
const tool9: Tool9 = { name: "t9", run: (input, context) => input.v9 + context.depth, make: () => ({ v9: 9 }) };
const tool10: Tool10 = { name: "t10", run: (input, context) => input.v10 + context.depth, make: () => ({ v10: 10 }) };
const tool11: Tool11 = { name: "t11", run: (input, context) => input.v11 + context.depth, make: () => ({ v11: 11 }) };
const tool12: Tool12 = { name: "t12", run: (input, context) => input.v12 + context.depth, make: () => ({ v12: 12 }) };
const tool13: Tool13 = { name: "t13", run: (input, context) => input.v13 + context.depth, make: () => ({ v13: 13 }) };
const tool14: Tool14 = { name: "t14", run: (input, context) => input.v14 + context.depth, make: () => ({ v14: 14 }) };
const tool15: Tool15 = { name: "t15", run: (input, context) => input.v15 + context.depth, make: () => ({ v15: 15 }) };
const tool16: Tool16 = { name: "t16", run: (input, context) => input.v16 + context.depth, make: () => ({ v16: 16 }) };
const tool17: Tool17 = { name: "t17", run: (input, context) => input.v17 + context.depth, make: () => ({ v17: 17 }) };
const all: AnyTool[] = [tool0, tool1, tool2, tool3, tool4, tool5, tool6, tool7, tool8, tool9, tool10, tool11, tool12, tool13, tool14, tool15, tool16, tool17];
function runOne(tool: AnyTool, context: Context): number {
  switch (tool.name) {
    case "t0": return tool.run(tool.make(), context);
    case "t1": return tool.run(tool.make(), context);
    case "t2": return tool.run(tool.make(), context);
    case "t3": return tool.run(tool.make(), context);
    case "t4": return tool.run(tool.make(), context);
    case "t5": return tool.run(tool.make(), context);
    case "t6": return tool.run(tool.make(), context);
    case "t7": return tool.run(tool.make(), context);
    case "t8": return tool.run(tool.make(), context);
    case "t9": return tool.run(tool.make(), context);
    case "t10": return tool.run(tool.make(), context);
    case "t11": return tool.run(tool.make(), context);
    case "t12": return tool.run(tool.make(), context);
    case "t13": return tool.run(tool.make(), context);
    case "t14": return tool.run(tool.make(), context);
    case "t15": return tool.run(tool.make(), context);
    case "t16": return tool.run(tool.make(), context);
    case "t17": return tool.run(tool.make(), context);
  }
}
interface Plain { run(input: In0, context: Context): number }
interface Other { run(input: { v0: number; more?: string }, context: Context): number }
const untagged: (Plain | Other)[] = [tool0, { run: (input: { v0: number; more?: string }, context: Context) => input.v0 * 2 + context.depth }];
type Numbered = { kind: 1; get(): string } | { kind: 2; get(): number } | { kind: 1 | 3; get(): boolean };
const numbered: Numbered[] = [{ kind: 1, get: () => "one" }, { kind: 2, get: () => 2 }, { kind: 3, get: () => true }];
const byName = new Map<string, AnyTool>(all.map(tool => [tool.name, tool]));
console.log(all.map(tool => runOne(tool, { depth: 1 })).join());
console.log(untagged.map(one => one.run({ v0: 5 }, { depth: 2 })).join(), numbered.map(one => String(one.get())).join(), runOne(byName.get("t7")!, { depth: 0 }));
