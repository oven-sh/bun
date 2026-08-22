import { app, type Button as AppKitButton, type Group as AppKitGroup } from "bun:appkit";
import { Button, Group, Text, VStack, Window, createRoot, flushSync } from "bun:appkit/react";
import { type ReactNode, useState } from "react";
import { emit, run, tick } from "./_util";

const windowCount = () => Array.from(app.windows).length;

async function attempt(step: string, element: ReactNode) {
  const errors: string[] = [];
  const root = createRoot({ onUncaughtError: e => errors.push(String((e as Error)?.message ?? e)) });
  root.render(element);
  await tick();
  // Counted before unmount: a native window created for a rejected element shows up here.
  emit({ step, errors: [...new Set(errors)], windows: windowCount() });
  root.unmount();
  await tick();
}

function Throws(): never {
  throw new Error("boom");
}

// The same <Button> takes its title from children, then the prop, then <Text>-like pieces, then nothing.
const phases: ReactNode[] = [
  <Button>from-children</Button>,
  <Button title="from-prop" />,
  <Button>
    {"x"}
    {"y"}
  </Button>,
  <Button />,
  <Button title="from-prop-again" />,
  <Button title="nothing-rendered">
    {false}
    {null}
  </Button>,
];
let setPhase!: (n: number) => void;
function Phases() {
  const [phase, set] = useState(0);
  setPhase = set;
  return <Window visible={false}>{phases[phase]}</Window>;
}

// <Group> takes both text pieces and views, so either can be the sibling a
// new child is inserted before.
let setAnchors!: (on: boolean) => void;
function Anchors() {
  const [on, set] = useState(false);
  setAnchors = set;
  return (
    <Window visible={false}>
      <Group>
        {on && "A"}
        <VStack />
        {on && <Button title="btn" />}
        {"B"}
        <Text text="t" />
      </Group>
    </Window>
  );
}

let setGroupTitle!: (title: string) => void;
function TitledGroup() {
  const [title, set] = useState("first");
  setGroupTitle = set;
  return (
    <Window visible={false}>
      <Group title={title}>
        <VStack />
        <Text>label</Text>
      </Group>
    </Window>
  );
}

await run(async () => {
  app.activationPolicy = "accessory";

  await attempt(
    "nested-window",
    <Window visible={false} title="outer">
      <VStack>
        <Window title="inner" />
      </VStack>
    </Window>,
  );
  await attempt("view-at-root", <VStack />);
  // React completes siblings in order, so the <Window> instance exists before the sibling is rejected.
  await attempt(
    "window-then-view-at-root",
    <>
      <Window visible={false} />
      <VStack />
    </>,
  );
  await attempt(
    "sibling-throws",
    <>
      <Window visible={false} />
      <Throws />
    </>,
  );
  await attempt(
    "two-children",
    <Window visible={false}>
      <VStack />
      <VStack />
    </Window>,
  );
  await attempt(
    "title-and-children",
    <Window visible={false}>
      <Button title="a">b</Button>
    </Window>,
  );

  {
    const errors: string[] = [];
    const root = createRoot({ onUncaughtError: e => errors.push(String((e as Error)?.message ?? e)) });
    root.render(<Phases />);
    const button = () => root.windows[0]!.content as AppKitButton;
    const titles = [button().title];
    for (let i = 1; i < phases.length; i++) {
      flushSync(() => setPhase(i));
      titles.push(button().title);
    }
    emit({ step: "text-source", errors, titles });
    root.unmount();
    await tick();
  }

  {
    const errors: string[] = [];
    const root = createRoot({ onUncaughtError: e => errors.push(String((e as Error)?.message ?? e)) });
    root.render(<TitledGroup />);
    const group = () => root.windows[0]!.content as AppKitGroup;
    const titles = [group().title];
    flushSync(() => setGroupTitle("second"));
    titles.push(group().title);
    emit({ step: "titled-group", errors, titles, kinds: group().children.map(c => c.constructor.name) });
    root.unmount();
    await tick();
  }

  {
    const errors: string[] = [];
    const root = createRoot({ onUncaughtError: e => errors.push(String((e as Error)?.message ?? e)) });
    root.render(<Anchors />);
    const group = () => root.windows[0]!.content as AppKitGroup;
    const shape = () => ({ title: group().title, kinds: group().children.map(c => c.constructor.name) });
    const before = shape();
    flushSync(() => setAnchors(true));
    const after = shape();
    flushSync(() => setAnchors(false));
    emit({ step: "group-anchors", errors, before, after, restored: shape() });
    root.unmount();
    await tick();
  }
  // No app.quit(): with every window gone the process exits by itself; a leaked one hangs it.
});
