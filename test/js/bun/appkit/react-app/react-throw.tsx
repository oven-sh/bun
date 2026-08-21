import { app } from "bun:appkit";
import { Text, Window, render } from "bun:appkit/react";
import { Component, type ReactNode } from "react";
import { emit, run, tick } from "./_util";

// argv[2] picks the scenario:
//   (none)     Boom throws, no handlers: React's default onUncaughtError reports
//              the render error as an uncaught exception, so the process exits 1.
//   "uncaught" Boom throws with no boundary: only onUncaughtError sees it, exit 0.
//   "caught"   Boom throws under an error boundary: only onCaughtError sees it,
//              the boundary's fallback renders and the window stays.
//   "flaky"    Flaky throws on its first render attempt only. React recovers by
//              retrying synchronously and reports through onRecoverableError;
//              that must not be fatal, so the window renders and exit 0.
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

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? "fallback" : this.props.children;
  }
}

await run(async () => {
  app.activationPolicy = "accessory";

  const seen: Record<string, string[]> = { uncaught: [], caught: [], recoverable: [] };
  const record = (channel: string) => (e: unknown) => seen[channel]!.push(String((e as Error)?.message ?? e));
  const handlers = mode
    ? {
        onUncaughtError: record("uncaught"),
        onCaughtError: record("caught"),
        onRecoverableError: record("recoverable"),
      }
    : undefined;
  const body =
    mode === "flaky" ? (
      <Flaky />
    ) : mode === "caught" ? (
      <Boundary>
        <Boom />
      </Boundary>
    ) : (
      <Boom />
    );
  const root = render(
    <Window visible={false}>
      <Text>{body}</Text>
    </Window>,
    handlers,
  );
  await tick();
  const text = (root.windows[0]?.content as import("bun:appkit").Text | undefined)?.text ?? null;
  emit({ step: "after-render", ...seen, windows: root.windows.length, text });
  root.unmount();
  await tick();
  app.quit();
});
