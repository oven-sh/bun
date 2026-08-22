import { app } from "bun:appkit";
import { Button, Text, VStack, Window, flushSync, render } from "bun:appkit/react";
import { appKitInternals } from "bun:internal-for-testing";
import { useState } from "react";
import { emit, run, tick } from "./_util";

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

// A view React deleted has had its native side freed: `released` says so,
// reads keep answering with the last value, and mutations throw ERR_INVALID_STATE.
function released(view: import("bun:appkit").View): boolean | Record<string, unknown> {
  if (!view.released) return false;
  const text = (view as import("bun:appkit").Text).text;
  let setter: unknown = "no throw";
  try {
    (view as import("bun:appkit").Text).text = "again";
  } catch (e) {
    setter = (e as { code?: string })?.code;
  }
  return { text, frame: view.frame, setter };
}

await run(async () => {
  app.activationPolicy = "accessory";
  render(<List />);
  const win = Array.from(app.windows)[0];
  const stack = win.content as import("bun:appkit").VStack;
  const order = () =>
    stack.children.map(c => (c as import("bun:appkit").Text).text ?? (c as import("bun:appkit").Button).title);

  emit({ step: "initial", order: order() });
  const [a, b, , d] = stack.children;
  const liveBefore = appKitInternals.liveViews();
  flushSync(() => setItems(["d", "a", "c", "b"]));
  emit({ step: "reordered", order: order(), sameViews: stack.children[1] === a && stack.children[3] === b });
  flushSync(() => setItems(["c", "btn", "e", "a"]));
  await tick();
  emit({ step: "replaced", order: order(), kinds: stack.children.map(c => c.constructor.name) });
  // b and d went away, btn and e arrived: freed at the commit, not at a later collection.
  emit({
    step: "released",
    a: released(a),
    b: released(b),
    d: released(d),
    liveViewsDelta: appKitInternals.liveViews() - liveBefore,
  });
  flushSync(() => setHidden(true));
  emit({ step: "hidden", hidden: stack.children.map(c => !!c.hidden) });
  flushSync(() => setItems([]));
  emit({ step: "emptied", order: order() });
  app.quit();
});
