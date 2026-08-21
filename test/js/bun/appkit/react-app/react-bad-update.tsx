import { app, type VStack as AppKitVStack, type Text as AppKitText } from "bun:appkit";
import { Text, VStack, Window, flushSync, render } from "bun:appkit/react";
import { useState } from "react";
import { emit, run, tick } from "./_util";

// A prop value the native side rejects, or a create-only Window option that
// changes, arrives in React's commit phase. It is reported on stderr and
// skipped; the rest of the commit lands and no window is torn down.
let setColor!: (color: string) => void;
let setResizable!: (on: boolean) => void;
let setCount!: (n: number) => void;

function App() {
  const [color, _setColor] = useState("red");
  const [resizable, _setResizable] = useState(true);
  const [count, _setCount] = useState(0);
  setColor = _setColor;
  setResizable = _setResizable;
  setCount = _setCount;
  return (
    <>
      <Window visible={false} title={`main ${count}`} resizable={resizable}>
        <VStack>
          <Text background={color}>{`colored ${count}`}</Text>
          <Text>{`sibling ${count}`}</Text>
        </VStack>
      </Window>
      <Window visible={false} title={`other ${count}`}>
        <Text>other</Text>
      </Window>
    </>
  );
}

await run(async () => {
  app.activationPolicy = "accessory";
  const seen: Record<string, string[]> = { uncaught: [], caught: [], recoverable: [] };
  const record = (channel: string) => (e: unknown) => seen[channel]!.push(String((e as Error)?.message ?? e));
  const root = render(<App />, {
    onUncaughtError: record("uncaught"),
    onCaughtError: record("caught"),
    onRecoverableError: record("recoverable"),
  });
  const texts = () =>
    ((root.windows[0]!.content as AppKitVStack).children as AppKitText[]).map(t => ({
      text: t.text,
      background: t.background,
    }));

  flushSync(() => {
    setColor("not-a-color");
    setCount(1);
  });
  await tick();
  emit({
    step: "bad-value",
    ...seen,
    windows: root.windows.length,
    titles: root.windows.map(w => w.title),
    texts: texts(),
  });

  flushSync(() => {
    setResizable(false);
    setCount(2);
  });
  await tick();
  emit({ step: "create-only", ...seen, windows: root.windows.length, titles: root.windows.map(w => w.title) });

  flushSync(() => {
    setColor("blue");
    setCount(3);
  });
  await tick();
  emit({ step: "recovered", ...seen, windows: root.windows.length, texts: texts() });

  root.unmount();
  await tick();
  app.quit();
});
