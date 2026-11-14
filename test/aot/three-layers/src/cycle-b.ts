import { early } from "./cycle-a";
export const late = "late";
export function seenFromB(): string { return early + " seen"; }
