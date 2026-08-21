import { app } from "bun:appkit";
import { Button, Text, VStack, Window, flushSync, render } from "bun:appkit/react";
import { useState } from "react";
import { emit, run } from "./_util";

let setItems!: (items: string[]) => void;
let setHidden!: (hidden: boolean) => void;

function List() {
  const [items, set] = useState(["a", "b", "c", "d"]);
  const [hidden, hide] = useState(false);
  setItems = set;
  setHidden = hide;
  return (
    <Window title="reorder" width={200} height={200}>
      <VStack spacing={2}>
        {items.map(k =>
          k === "btn" ? (
            <Button key={k}>btn</Button>
          ) : (
            <Text key={k} hidden={hidden && k === "a"}>
              {k}
            </Text>
          ),
        )}
      </VStack>
    </Window>
  );
}

await run(() => {
  app.activationPolicy = "accessory";
  render(<List />);
  const win = Array.from(app.windows)[0];
  const stack = win.content as import("bun:appkit").VStack;
  const order = () =>
    stack.children.map(c => (c as import("bun:appkit").Text).text ?? (c as import("bun:appkit").Button).title);

  emit({ step: "initial", order: order() });
  flushSync(() => setItems(["d", "a", "c", "b"]));
  emit({ step: "reordered", order: order() });
  flushSync(() => setItems(["c", "btn", "e", "a"]));
  emit({ step: "replaced", order: order(), kinds: stack.children.map(c => c.constructor.name) });
  flushSync(() => setHidden(true));
  emit({ step: "hidden", hidden: stack.children.map(c => !!c.hidden) });
  flushSync(() => setItems([]));
  emit({ step: "emptied", order: order() });
  app.quit();
});
