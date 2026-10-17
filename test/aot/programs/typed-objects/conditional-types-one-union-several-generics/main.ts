import { toolA, toolB, toolC, type AnyTool, type InputOf, type OutputOf } from "./tools";

function first<T extends AnyTool>(tool: T, input: InputOf<T>): OutputOf<T> {
  const given: InputOf<T> = input;
  return (tool.run as (input: InputOf<T>, note: string) => OutputOf<T>)(given, "!");
}

function second<U extends AnyTool>(tool: U, inputs: InputOf<U>[]): OutputOf<U>[] {
  const made: OutputOf<U>[] = [];
  for (const input of inputs) made.push(first(tool, input));
  return made;
}

function third<V extends AnyTool>(tool: V, input: InputOf<V>): { name: V["name"]; made: OutputOf<V> } {
  return { name: tool.name, made: second(tool, [input])[0] };
}

console.log(JSON.stringify(first(toolA, { kind: "a", size: 4 })));
console.log(JSON.stringify(second(toolB, [{ kind: "b", text: "x" }, { kind: "b", text: "yz" }])));
console.log(JSON.stringify(third(toolC, { kind: "c", flag: false })));
