export type Level = 1 | 2 | 3;
export interface Kept<T> { value: T }
interface Entry { hidden: boolean }
const entry: Entry = { hidden: true };
export function other(level: Level): number { return entry.hidden ? level : 0; }
