import { app, Button, Text, VStack, Window } from "bun:appkit";
import { appKitInternals } from "bun:internal-for-testing";
import { objc } from "bun:objc";
import { emit, run, waitFor } from "./_util";

await run(async () => {
  app.activationPolicy = "accessory";

  const win = new Window({ width: 200, height: 100, content: new Text({ text: "gc" }) });
  win.show();
  Bun.gc(true);
  const baseline = appKitInternals.liveViews();
  // Zeroing weak references to every NSView made below: once the View
  // objects are collected nothing may keep the NSViews themselves.
  const natives = objc.classes.NSHashTable.weakObjectsHashTable();

  (() => {
    const loose: unknown[] = [];
    for (let i = 0; i < 300; i++) {
      const view =
        i % 3 === 0 ? new Text({ text: `t${i}` }) : i % 3 === 1 ? new Button({ title: `b${i}` }) : new VStack();
      natives.addObject_(view.native);
      loose.push(view);
    }
    emit({ step: "created", live: appKitInternals.liveViews(), baseline, natives: natives.allObjects().count() });
  })();

  let after = appKitInternals.liveViews();
  await waitFor(
    () => {
      Bun.gc(true);
      after = appKitInternals.liveViews();
      return after <= baseline + 5;
    },
    "views to be collected",
    1500,
  ).catch(() => {});
  let nativesLeft = natives.allObjects().count();
  await waitFor(
    () => {
      Bun.gc(true);
      nativesLeft = natives.allObjects().count();
      return nativesLeft <= Math.max(after - baseline, 0);
    },
    "the NSViews to be deallocated",
    3000,
  ).catch(() => {});
  emit({ step: "collected", baseline, after, nativesLeft });

  win.close();
});
