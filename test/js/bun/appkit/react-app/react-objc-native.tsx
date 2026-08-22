// `.native` on a view React has deleted (and so released) throws
// ERR_INVALID_STATE; a handle taken while it was mounted keeps working.
import { app, objc } from "bun:appkit";
import { Text, VStack, Window, flushSync, render } from "bun:appkit/react";
import { useState } from "react";
import { emit, run, tick } from "./_util";

let setShown!: (shown: boolean) => void;

function App() {
  const [shown, show] = useState(true);
  setShown = show;
  return (
    <Window title="native" visible={false}>
      <VStack>{shown ? <Text key="t">mounted</Text> : null}</VStack>
    </Window>
  );
}

function attempt(f: () => unknown) {
  try {
    f();
    return { threw: false };
  } catch (e) {
    const err = e as Error & { code?: string };
    return { threw: true, code: err?.code, message: String(err?.message) };
  }
}

await run(async () => {
  app.activationPolicy = "accessory";
  const root = render(<App />);
  const win = Array.from(app.windows)[0];
  const text = (win.content as import("bun:appkit").VStack).children[0] as import("bun:appkit").Text;
  const handle = text.native;
  const mounted = {
    isTextField: handle.isKindOfClass_(objc.classes.NSTextField),
    stringValue: String(handle.stringValue()),
    identity: text.native === handle,
  };
  flushSync(() => setShown(false));
  await tick();
  emit({
    step: "released",
    mounted,
    released: text.released,
    native: attempt(() => text.native),
    handleStillWorks: String(handle.stringValue()),
    windowNative: attempt(() => win.native.title()),
  });
  root.unmount();
  emit({ step: "unmounted", windows: Array.from(app.windows).length, closedNative: attempt(() => win.native) });
});
