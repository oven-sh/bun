import { late, seenFromB } from "./cycle-b";
export const early = "early";
export function readLate(): unknown[] { return [late, seenFromB()]; }
