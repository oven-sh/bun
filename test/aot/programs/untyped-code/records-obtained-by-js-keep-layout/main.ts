// JavaScript files of the program import functions of typed files, or get them through a JavaScript file that exports them again. The records of written types that those functions yield, and the ones they take, stay laid out by their types, and typed code reads their fields in place.
// Whatever the JavaScript does to a record it has got (freezing it, a property more or less, another prototype, an object of its own making stored into a field), and whatever it hands in for one (a plain object with more members, in another order, frozen, with accessors, an instance of a class of its own), typed code sees what it sees under plain Bun.
// IR= 1 total : number = PropGet v[0-9]+ name="y"(?!.* isFallback)
// IR= 1 length : number = PropGet v[0-9]+ name="y"(?!.* isFallback)
// IR+ : =?L[0-9]+ = NewObject 
import { deeds } from "./hostile.js";
import { deeds as deedsThroughEntry } from "./hostile-through-entry.js";
import * as caller from "./importing-caller.js";
import * as callerThroughEntry from "./importing-caller-through-entry.js";
import { report, total, length, chain } from "./model.ts";
import { bump, sumOfAll, own } from "./taker.ts";
const attempt = (f: () => unknown): string => { try { return String(f()); } catch (e: any) { return "throws " + e.constructor.name; } };
for (let turn = 0; turn < 2; turn++) {
  for (const name of Object.keys(deeds)) console.log(turn, "imported", name, attempt((deeds as any)[name]), report());
  for (const name of Object.keys(deedsThroughEntry)) console.log(turn, "exported again", name, attempt((deedsThroughEntry as any)[name]), report());
}
console.log(total(), length(chain(5)));
console.log(bump(own()).x);
for (let turn = 0; turn < 2; turn++) {
  for (const name of Object.keys(caller).sort()) console.log(turn, "imported", name, attempt((caller as any)[name]), attempt(sumOfAll));
  for (const name of Object.keys(callerThroughEntry).sort()) console.log(turn, "exported again", name, attempt((callerThroughEntry as any)[name]), attempt(sumOfAll));
}
