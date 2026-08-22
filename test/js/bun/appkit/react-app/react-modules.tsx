import { app } from "bun:appkit";
import { Text, Window, createRoot, flushSync, render } from "bun:appkit/react";
import * as React from "react";
import Reconciler from "react-reconciler";
import * as Constants from "react-reconciler/constants";
import { emit, run, tick } from "./_util";

// An app that bundles React hands its own copies over instead of letting the
// renderer look them up next to the entry point. Every root shares them.
function Label() {
  const [text] = React.useState("from modules");
  return <Text>{text}</Text>;
}

function message(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return String((e as Error)?.message ?? e);
  }
}

await run(async () => {
  app.activationPolicy = "accessory";
  const modules = { react: React, reconciler: Reconciler, constants: Constants };

  // Nothing is mounted yet, so this only runs the callback.
  const early = flushSync(() => "early");

  const badShape = message(() => createRoot({ modules: { react: React } as never }));
  const root = render(
    <Window visible={false}>
      <Label />
    </Window>,
    { modules },
  );
  await tick();
  const text = (root.windows[0]?.content as import("bun:appkit").Text | undefined)?.text ?? null;
  const again = message(() => createRoot({ modules }).unmount());
  const implicit = message(() => createRoot().unmount());
  const otherReact = message(() => createRoot({ modules: { ...modules, react: { ...React } } }));
  emit({ step: "modules", early, badShape, text, windows: root.windows.length, again, implicit, otherReact });
  root.unmount();
  await tick();
  app.quit();
});
