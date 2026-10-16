export interface Logger { write(line: string): number }
export type Level = "info" | "warn";
export declare function log(line: string): number;
export declare class Sink implements Logger { write(line: string): number }
export default function make(): Sink;
export declare namespace Deep { interface Inner { depth: number } }
