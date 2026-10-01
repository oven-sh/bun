import { expect, test } from "bun:test";
import { parseArgs } from "node:util";

// Node.js emits parseArgs result keys in the order {values, positionals, tokens?}, and option-token
// keys in the order {kind, name, rawName, index, value, inlineValue}. Property insertion order is
// observable via Object.keys / JSON.stringify, so snapshot tests depend on it.
test("parseArgs: property insertion order matches Node.js", () => {
  const args = ["--x=v", "-ab", "--flag", "--", "pos"];
  const options = {
    x: { type: "string" },
    a: { type: "boolean" },
    b: { type: "boolean" },
    flag: { type: "boolean" },
  } as const;

  const result = parseArgs({ args, options, allowPositionals: true, tokens: true });
  expect(Object.keys(result)).toEqual(["values", "positionals", "tokens"]);

  expect(result.tokens.map(t => Object.keys(t).join(","))).toEqual([
    "kind,name,rawName,index,value,inlineValue",
    "kind,name,rawName,index,value,inlineValue",
    "kind,name,rawName,index,value,inlineValue",
    "kind,name,rawName,index,value,inlineValue",
    "kind,index",
    "kind,index,value",
  ]);
  expect(JSON.stringify(result.tokens[0])).toBe(
    '{"kind":"option","name":"x","rawName":"--x","index":0,"value":"v","inlineValue":true}',
  );

  expect(Object.keys(parseArgs({ args: [], options: {} }))).toEqual(["values", "positionals"]);
});
