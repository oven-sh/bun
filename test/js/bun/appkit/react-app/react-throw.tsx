import { app } from "bun:appkit";
import { Text, Window, render } from "bun:appkit/react";
import { emit, run, tick } from "./_util";

// argv[2] picks the scenario:
//   (none)    Boom always throws, no onError: React's default handler reports the
//             render error as an uncaught exception, so the process exits 1.
//   "handled" Boom always throws, onError given: the handler sees it, exit 0.
//   "flaky"   Flaky throws on its first render attempt only. React recovers by
//             retrying synchronously and reports through onRecoverableError; that
//             must not be fatal, so the window renders and the process exits 0.
const mode = process.argv[2];

function Boom(): never {
  throw new Error("boom");
}

let firstAttempt = true;
function Flaky() {
  if (firstAttempt) {
    firstAttempt = false;
    throw new Error("transient");
  }
  return "ok";
}

await run(async () => {
  app.activationPolicy = "accessory";

  const errors: string[] = [];
  const root = render(
    <Window visible={false}>
      <Text>{mode === "flaky" ? <Flaky /> : <Boom />}</Text>
    </Window>,
    mode === "handled" ? { onError: e => errors.push(String((e as Error)?.message ?? e)) } : undefined,
  );
  await tick();
  const text = (root.windows[0]?.content as import("bun:appkit").Text | undefined)?.text ?? null;
  emit({ step: "after-render", errors, windows: root.windows.length, text });
  root.unmount();
  await tick();
  app.quit();
});
