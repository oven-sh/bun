import { soon, trail } from "./trail.ts";
import { shared } from "./shared.ts";

trail.push("late: starts, shared is " + shared.count);
export const value: string = await soon("late: its await is over", "late value", 3);
trail.push("late: ends");
