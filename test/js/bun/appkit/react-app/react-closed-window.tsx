import { app, type Window as AppKitWindow } from "bun:appkit";
import { Text, Window, flushSync, render } from "bun:appkit/react";
import { useState } from "react";
import { emit, run, tick } from "./_util";

let setCount!: (n: number) => void;
let setPanelVisible!: (v: boolean) => void;

function TwoWindows() {
  const [count, _setCount] = useState(0);
  const [panelVisible, _setPanelVisible] = useState(true);
  setCount = _setCount;
  setPanelVisible = _setPanelVisible;
  return (
    <>
      <Window title={`main ${count}`} width={200} height={100}>
        <Text>{`main ${count}`}</Text>
      </Window>
      <Window title={`panel ${count}`} width={200 + count} height={100} visible={panelVisible}>
        <Text key={count % 2 ? "odd" : "even"}>{`panel ${count}`}</Text>
      </Window>
    </>
  );
}

await run(async () => {
  app.activationPolicy = "accessory";
  app.keepAlive = true;

  const errors: string[] = [];
  const root = render(<TwoWindows />, { onUncaughtError: e => errors.push(String((e as Error)?.message ?? e)) });
  const [main, panel] = root.windows as [AppKitWindow, AppKitWindow];

  // What the red close button does: the <Window> stays mounted, its NSWindow is gone.
  panel.close();
  await tick();
  flushSync(() => setCount(1));
  await tick();
  emit({ step: "rerender", errors, mainClosed: main.closed, mainTitle: main.title, panelClosed: panel.closed });

  flushSync(() => setPanelVisible(false));
  flushSync(() => setPanelVisible(true));
  await tick();
  emit({ step: "toggle-visible", errors, mainClosed: main.closed });

  root.unmount();
  await tick();
  emit({ step: "unmounted", errors, windows: Array.from(app.windows).length });
  app.keepAlive = false;
  app.quit();
});
