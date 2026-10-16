import { makeCounter, makeHolder, makeState, showCounter, showHolder, showState } from "./state.ts";

export const deeds = [
  "a string",
  "undefined",
  "null",
  "an object",
  "a fraction",
  "a getter",
  "a function",
  "a symbol",
  "deleted",
];

export function alter(object, name, deed, last, seen) {
  try {
    switch (deed) {
      case "a string":
        object[name] = "many";
        break;
      case "undefined":
        object[name] = undefined;
        break;
      case "null":
        object[name] = null;
        break;
      case "an object":
        object[name] = { big: 1 };
        break;
      case "a fraction":
        object[name] = 1.5;
        break;
      case "a getter":
        Object.defineProperty(object, name, { get: () => 7, enumerable: true, configurable: true });
        break;
      case "a function":
        object[name] = () => 1;
        break;
      case "a symbol":
        object[name] = Symbol.iterator;
        break;
      case "deleted":
        delete object[name];
        break;
    }
    seen.push(typeof object[name]);
    Object.defineProperty(object, name, { value: last, writable: true, enumerable: true, configurable: true });
  } catch (error) {
    seen.push("throws " + error.constructor.name);
  }
}

export function run() {
  const lines = [];
  for (let round = 0; round < 2; round++) {
    for (const deed of deeds) {
      const seen = [];
      const counter = makeCounter();
      counter.count = "many";
      seen.push(typeof counter.count);
      counter.count = 3;
      alter(counter, "count", deed, 2, seen);
      const holder = makeHolder();
      alter(holder, "count", deed, 2, seen);
      const state = makeState();
      alter(state, "open", deed, false, seen);
      const opened = makeState();
      opened.open = true;
      opened.at = 4;
      lines.push(
        [
          round,
          "imported",
          deed,
          seen.join(),
          showCounter(counter),
          showHolder(holder),
          showState(state),
          showState(opened),
          JSON.stringify([counter, holder, state, opened]),
        ].join(" "),
      );
    }
  }
  return lines.join("\n");
}
