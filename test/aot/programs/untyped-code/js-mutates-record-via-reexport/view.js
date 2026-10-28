import { makeCounter, makeHolder, makeState, showCounter, showHolder, showState } from "./entry.js";

export function run() {
  const lines = [];
  for (let round = 0; round < 2; round++) {
    const counter = makeCounter();
    counter.count = "many";
    const seen = [typeof counter.count];
    counter.count = 2;
    const holder = makeHolder();
    holder.count = { big: 1 };
    seen.push(typeof holder.count);
    holder.count = 2;
    const state = makeState();
    state.open = true;
    state.at = 4;
    lines.push(
      [
        round,
        "exported again",
        seen.join(),
        showCounter(counter),
        showHolder(holder),
        showState(state),
        JSON.stringify([counter, holder, state]),
      ].join(" "),
    );
  }
  return lines.join("\n");
}
