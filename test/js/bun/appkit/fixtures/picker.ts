import { app, Picker, Segmented, VStack, Window } from "bun:appkit";
import { emit, run } from "./_util";

await run(() => {
  app.activationPolicy = "accessory";

  const dup = new Picker({ items: ["A", "B", "A"] });
  const segDup = new Segmented({ items: ["x", "y", "x"] });
  const early = new Picker({ selectedIndex: 2 });
  const oobItemsFirst = new Picker({ items: ["A", "B"], selectedIndex: 5 });
  const oobIndexFirst = new Picker({ selectedIndex: 5, items: ["A", "B"] });
  const segOobItemsFirst = new Segmented({ items: ["a", "b"], selectedIndex: 5 });
  const segOobIndexFirst = new Segmented({ selectedIndex: 5, items: ["a", "b"] });
  const none = new Segmented({ items: ["a", "b"], selectedIndex: -1 });
  const stack = new VStack();
  stack.append(dup, segDup, early, oobItemsFirst, oobIndexFirst, segOobItemsFirst, segOobIndexFirst, none);
  const win = new Window({ width: 300, height: 300, content: stack });
  win.show();

  emit({ step: "defaults", picker: dup.selectedIndex, segmented: segDup.selectedIndex });

  dup.selectedIndex = 2;
  segDup.selectedIndex = 2;
  emit({ step: "duplicate titles", picker: dup.selectedIndex, segmented: segDup.selectedIndex, items: dup.items });

  const before = early.selectedIndex;
  early.items = ["p", "q", "r"];
  emit({ step: "index before items", before, after: early.selectedIndex });

  const oob = {
    step: "out of range",
    picker: [oobItemsFirst.selectedIndex, oobIndexFirst.selectedIndex],
    segmented: [segOobItemsFirst.selectedIndex, segOobIndexFirst.selectedIndex],
  };
  oobItemsFirst.items = ["A", "B", "C", "D", "E", "F"];
  segOobIndexFirst.items = ["a", "b", "c", "d", "e", "f"];
  emit({ ...oob, grown: [oobItemsFirst.selectedIndex, segOobIndexFirst.selectedIndex] });

  const explicitNone = none.selectedIndex;
  none.selectedIndex = null;
  emit({ step: "none", explicit: explicitNone, reset: none.selectedIndex });

  segDup.items = ["only"];
  dup.items = ["only"];
  emit({ step: "shrunk", picker: dup.selectedIndex, segmented: segDup.selectedIndex });

  for (const [name, value] of [
    ["fraction", 1.5],
    ["negative", -7],
    ["huge", 1e20],
  ] as const) {
    early.selectedIndex = value;
    none.selectedIndex = value;
    emit({ step: `selectedIndex=${name}`, picker: early.selectedIndex, segmented: none.selectedIndex });
  }
  for (const [name, value] of [
    ["NaN", NaN],
    ["string", "1"],
  ] as const) {
    let threw: unknown;
    try {
      early.selectedIndex = value as any;
    } catch (e) {
      threw = { isTypeError: e instanceof TypeError, message: (e as Error).message };
    }
    emit({ step: `selectedIndex=${name}`, threw });
  }

  win.close();
});
