import { app } from "bun:appkit";
import { Button, Text, VStack, Window, render } from "bun:appkit/react";
import { createElement, useState } from "react";
import { emit, run, tick } from "./_util";

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <Window title="React counter" width={240} height={120}>
      <VStack>
        <Text>{`Count: ${count}`}</Text>
        <Button kind="primary" onClick={() => setCount(c => c + 1)}>
          {count} clicks
        </Button>
      </VStack>
    </Window>
  );
}

await run(async () => {
  app.activationPolicy = "accessory";

  const root = render(<Counter />);
  const win = Array.from(app.windows)[0];
  emit({ step: "rendered", windows: Array.from(app.windows).length, hasWindow: !!win });
  win.show();

  const stack = win.content as import("bun:appkit").VStack;
  const [label, button] = stack.children as [import("bun:appkit").Text, import("bun:appkit").Button];
  emit({
    step: "tree",
    kinds: stack.children.map(c => c.constructor.name),
    text: label.text,
    title: button.title,
    kind: button.kind,
  });

  button.click();
  await tick();
  emit({ step: "clicked-once", text: label.text, title: button.title });
  button.click();
  button.click();
  await tick();
  emit({ step: "clicked-thrice", text: label.text, snapshotBytes: win.snapshot()?.byteLength ?? 0 });

  root.unmount();
  await tick();
  emit({ step: "unmounted", windows: Array.from(app.windows).length, closed: win.closed });

  const errors: string[] = [];
  const bad = render(<Window visible={false}>{createElement("constructor")}</Window>, {
    onUncaughtError: e => errors.push(String((e as Error)?.message ?? e).split(".")[0]),
  });
  await tick();
  emit({ step: "unknown-element", errors: [...new Set(errors)] });
  bad.unmount();
  await tick();
  app.quit();
});
