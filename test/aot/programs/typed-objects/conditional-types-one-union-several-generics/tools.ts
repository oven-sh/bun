export interface InA { kind: "a"; size: number }
export interface InB { kind: "b"; text: string }
export interface InC { kind: "c"; flag: boolean }
export interface OutA { doubled: number }
export interface OutB { shouted: string }
export interface OutC { negated: boolean }
export interface ToolA { name: "A"; run(input: InA, note: string): OutA }
export interface ToolB { name: "B"; run(input: InB, note: string): OutB }
export interface ToolC { name: "C"; run(input: InC, note: string): OutC }
export type AnyTool = ToolA | ToolB | ToolC;
export type InputOf<T> = T extends { run(input: infer I, note: string): unknown } ? I : never;
export type OutputOf<T> = T extends { run(input: never, note: string): infer O } ? O : never;

export const toolA: ToolA = { name: "A", run(input, note) { return { doubled: input.size * 2 + note.length }; } };
export const toolB: ToolB = { name: "B", run(input, note) { return { shouted: (input.text + note).toUpperCase() }; } };
export const toolC: ToolC = { name: "C", run(input) { return { negated: !input.flag }; } };
