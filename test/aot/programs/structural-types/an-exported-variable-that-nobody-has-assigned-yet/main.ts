import { bump, legacy, level, levelInside, levelPlusOneInside, onChange, setAll, tags, title } from "./settings.ts";
import * as settings from "./settings.ts";

function show(label: string, run: () => unknown): void {
  try {
    const value = run();
    console.log(label + ": " + typeof value + " " + String(value));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function levelOf(o: { level: number }): number {
  return o.level;
}

function round(when: string): void {
  show(when + " level", () => level);
  show(when + " level + 1", () => level + 1);
  show(when + " level | 0", () => level | 0);
  show(when + " level inside", levelInside);
  show(when + " level + 1 inside", levelPlusOneInside);
  show(when + " title", () => title);
  show(when + " title.length", () => title.length);
  show(when + " tags", () => tags);
  show(when + " tags.length", () => tags.length);
  show(when + " onChange()", () => onChange());
  show(when + " legacy", () => legacy);
  show(when + " through the namespace", () => settings.level);
  show(when + " the namespace as an object with a level", () => levelOf(settings));
}

round("before");
show("bump before", bump);
show("level after the bump", () => level);
setAll();
round("after");
show("bump after", bump);
show("level after the bump", () => level);
show("the namespace after the bump", () => levelOf(settings));
show("a plain object at the same function", () => levelOf({ level: 1 }));
show("keys of the namespace", () => Object.keys(settings).join());
