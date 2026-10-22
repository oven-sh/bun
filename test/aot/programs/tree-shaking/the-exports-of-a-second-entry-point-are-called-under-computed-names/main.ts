// start.ts is the program; this file is passed to the build as a second entry point. start.ts loads it under a path that is put together where the program runs, and calls its exports under names that are put together too. Nothing else names them: what an entry point exports is kept.
import { shared } from "./shared";

function helper() { return "helper of the second entry point"; }
export function first() { return "first, " + helper(); }
export const second = () => "second, " + shared();
export class Third { name() { return "third"; } }
export default function () { return "the default"; }
console.log("the second entry point is evaluated");
