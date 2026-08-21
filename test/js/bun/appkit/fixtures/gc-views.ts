import { app, Button, Text, VStack, Window } from "bun:appkit";
import { appKitInternals } from "bun:internal-for-testing";
import { emit, run, waitFor } from "./_util";

await run(async () => {
  app.activationPolicy = "accessory";

  const win = new Window({ width: 200, height: 100, content: new Text({ text: "gc" }) });
  win.show();
  Bun.gc(true);
  const baseline = appKitInternals.liveViews();

  (() => {
    const loose: unknown[] = [];
    for (let i = 0; i < 300; i++) {
      loose.push(
        i % 3 === 0 ? new Text({ text: `t${i}` }) : i % 3 === 1 ? new Button({ title: `b${i}` }) : new VStack(),
      );
    }
    emit({ step: "created", live: appKitInternals.liveViews(), baseline });
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
  emit({ step: "collected", baseline, after });

  win.close();
});
