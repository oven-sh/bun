import make, { log, Sink, type Logger, type Level as Severity } from "outside";
import type * as outside from "outside";
import { other, type Level } from "./other";
import * as everything from "./other";
export type Both = Severity | Level;
export interface Entry { level: Both; logger: Logger; inner?: outside.Deep.Inner; sink: Sink }
export function write(entry: Entry, line: string): number {
  const sink: Sink = entry.sink ?? make();
  const kept: import("./other").Kept<number> = { value: log(line) };
  const again: everything.Kept<string> = { value: line };
  return sink.write(line) + kept.value + again.value.length + other(entry.level as Level);
}
export const levels: ReadonlyArray<Both> = ["info", 1];
