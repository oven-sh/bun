import { trail } from "./trail.ts";
import { shared } from "./shared.ts";

trail.push("third: has no await, shared is " + shared.count);
export const third: number = 3;
shared.count += third;
