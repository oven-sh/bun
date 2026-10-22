import { soon, trail } from "./trail.ts";
import { shared } from "./shared.ts";

trail.push("second: starts, shared is " + shared.count);
export const second: number = await soon("second: its await is over", 2, 1);
shared.count += second;
trail.push("second: ends, shared is " + shared.count);
