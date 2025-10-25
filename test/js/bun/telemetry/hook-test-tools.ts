import { NativeInstrument } from "bun";

type CallbackRecord = {
  name: string;
  args: any[];
};
type MockedInstrument = {
  startCalls: CallbackRecord[];
  injectCalls: CallbackRecord[];
  progressCalls: CallbackRecord[];
  endCalls: CallbackRecord[];
  errorCalls: CallbackRecord[];
  getCallbackRecords: () => CallbackRecord[];
  [Symbol.dispose](): void;
};
export function mockInstrument(
  base: Pick<NativeInstrument, "name" | "type"> &
    Partial<Omit<NativeInstrument, "name" | "type">> & {
      log?: typeof console.log;
    },
  autoRegister: boolean = true,
): MockedInstrument & NativeInstrument {
  const payload = {
    name: base.name || "mock-instrument",
    type: base.type,
    version: "1.0.0",
    onOperationStart(a, b, ...args: any[]) {
      try {
        base.log?.("onOperationStart", a, b, ...args);
      } catch {}
      this.recordCallback("start", [a, b, ...args]);
      return base?.onOperationStart?.(a, b);
    },
    onOperationInject(a, b, ...args: any[]) {
      try {
        base.log?.("onOperationInject", a, b, ...args);
      } catch {}
      this.recordCallback("inject", [a, b, ...args]);
      return base?.onOperationInject?.(a, b);
    },
    onOperationProgress(a, b, ...args: any[]) {
      try {
        base.log?.("onOperationProgress", a, b, ...args);
      } catch {}
      this.recordCallback("progress", [a, b, ...args]);
      return base?.onOperationProgress?.(a, b);
    },
    onOperationEnd(a, b, ...args: any[]) {
      try {
        base.log?.("onOperationEnd", a, b, ...args);
      } catch {}
      this.recordCallback("end", [a, b, ...args]);
      return base?.onOperationEnd?.(a, b);
    },
    onOperationError(a, b, ...args: any[]) {
      try {
        base.log?.("onOperationError", a, b, ...args);
      } catch {}
      this.recordCallback("error", [a, b, ...args]);
      return base?.onOperationError?.(a, b);
    },
    get startCalls() {
      return this.getCallbackRecords().filter(r => r.name === "start");
    },
    get injectCalls() {
      return this.getCallbackRecords().filter(r => r.name === "inject");
    },
    get progressCalls() {
      return this.getCallbackRecords().filter(r => r.name === "progress");
    },
    get endCalls() {
      return this.getCallbackRecords().filter(r => r.name === "end");
    },
    get errorCalls() {
      return this.getCallbackRecords().filter(r => r.name === "error");
    },
    recordCallback(name: string, args: any[]) {
      if (!this.callbackRecords) {
        this.callbackRecords = [] as CallbackRecord[];
      }
      this.callbackRecords.push({ name, args });
    },
    getCallbackRecords() {
      return this.callbackRecords || [];
    },
    callbackRecords: [] as CallbackRecord[],
    [Symbol.dispose]() {
      // no-op
    },
  };
  if (autoRegister) {
    const _ref = Bun.telemetry.attach(payload);
    payload[Symbol.dispose] = _ref[Symbol.dispose].bind(_ref);
  }
  return payload;
}
