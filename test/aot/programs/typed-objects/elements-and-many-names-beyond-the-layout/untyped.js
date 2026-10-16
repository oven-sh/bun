import { Options, Packed, makeSettings } from "./shapes.ts";

const names = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
function byName(o, i) {
  o.a = i; o.b = i; o.c = i; o.d = i; o.e = i; o.f = i;
  o.g = i;
  o.h = i; o.i = i; o.j = i;
  o.k = i;
  o.l = i;
}
function underKeys(o, i) {
  for (let n = 0; n < names.length; n++) o[names[n]] = i;
}
function byDefinition(o, i) {
  for (let n = 0; n < names.length; n++) Object.defineProperty(o, names[n], { value: i, writable: true, enumerable: true, configurable: true });
}
const makers = {
  Options: () => new Options(),
  Packed: () => new Packed(),
  record: () => makeSettings(1),
  plain: () => ({}),
};
const elements = {
  "none": () => {},
  "one before": (o, i) => { o[7] = i; },
  "the first before": (o, i) => { o[0] = i; },
  "several before": (o, i) => { for (let n = 0; n < 5; n++) o[n] = i; },
  "a far one before": (o, i) => { o[100000] = i; },
  "a double before": (o, i) => { o[3] = i + 0.5; },
  "an object before": (o, i) => { o[3] = { i }; },
};
const look = o => JSON.stringify(o) + " " + Object.keys(o).join();

export function run() {
  for (const maker in makers) {
    for (const element in elements) {
      for (const [how, give] of [["by name", byName], ["under keys", underKeys], ["by definition", byDefinition]]) {
        const kept = [];
        for (let round = 0; round < 24; round++) {
          const o = makers[maker]();
          elements[element](o, round);
          give(o, round);
          kept.push(o);
        }
        const wrong = [];
        for (let round = 0; round < 24; round++) {
          const expected = makers.plain();
          if (maker === "Options") expected.always = 1;
          if (maker === "record") expected.id = 1;
          elements[element](expected, round);
          for (const name of names) expected[name] = round;
          if (look(kept[round]) !== look(expected)) wrong.push(round + ": " + look(kept[round]));
        }
        console.log(maker, element, how, wrong.length, wrong.slice(0, 2).join(" ; "), look(kept[23]));
      }
    }
  }
  for (const maker in makers) {
    const kept = [];
    for (let round = 0; round < 24; round++) {
      const o = makers[maker]();
      o.a = round; o.b = round; o.c = round;
      o[2] = round;
      o.d = round; o.e = round; o.f = round; o.g = round;
      o[9] = round;
      o.h = round; o.i = round; o.j = round; o.k = round; o.l = round;
      kept.push(o);
    }
    console.log(maker, "elements in between", new Set(kept.map((o, round) => look(o).replaceAll(String(round), "n"))).size, look(kept[11]));
  }
}
