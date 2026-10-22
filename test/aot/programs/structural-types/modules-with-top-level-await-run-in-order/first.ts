import { soon, trail } from "./trail.ts";
import { shared } from "./shared.ts";

trail.push("first: starts, shared is " + shared.count);
export const first: number = await soon("first: its await is over", 1, 5);
shared.count += first;
trail.push("first: ends, shared is " + shared.count);
