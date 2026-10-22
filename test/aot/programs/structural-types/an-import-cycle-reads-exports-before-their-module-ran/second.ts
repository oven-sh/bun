import fallback, { arrow, count, helper, level, limit, list, makesThing, readsCount, readsCountPlusOne, readsLimit, Thing, title } from "./first.ts";
import { note } from "./report.ts";

export function look(when: string): void {
  note(when + " var number", () => count);
  note(when + " var number + 1", () => count + 1);
  note(when + " var number | 0", () => count | 0);
  note(when + " var string", () => title);
  note(when + " var string length", () => title.length);
  note(when + " var array", () => list);
  note(when + " var array length", () => list.length);
  note(when + " let", () => level);
  note(when + " const", () => limit);
  note(when + " typeof const", () => typeof limit);
  note(when + " class", () => new Thing().size);
  note(when + " static of class", () => Thing.made);
  note(when + " function", () => helper());
  note(when + " function that reads a var", () => readsCount());
  note(when + " function that adds to a var", () => readsCountPlusOne());
  note(when + " function that reads a const", () => readsLimit());
  note(when + " function that makes a class", () => makesThing().size);
  note(when + " arrow in a const", () => arrow());
  note(when + " default", () => fallback);
}

look("early");
export const secondReady: boolean = true;
