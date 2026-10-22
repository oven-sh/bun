import { soon, trail } from "./trail.ts";

trail.push("shared: starts");
export const shared: { count: number } = { count: await soon("shared: its await is over", 100, 2) };
trail.push("shared: ends");
