import { app, Button, Image, MetalView, Slider, Switch, Text, View, VStack, Window } from "bun:appkit";
import { emit, run } from "./_util";

function attempt(name: string, f: () => unknown) {
  try {
    f();
    emit({ step: name, threw: false });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err?.code === "ERR_OBJC_UNAVAILABLE") throw err;
    emit({
      step: name,
      threw: true,
      isTypeError: err instanceof TypeError,
      message: String(err?.message),
      code: err?.code,
      path: (err as { path?: string }).path,
    });
  }
}

await run(() => {
  app.activationPolicy = "accessory";

  const slider = new Slider();
  const text = new Text({ text: "x" });
  const button = new Button({ title: "b" });
  const a = new VStack();
  const b = new VStack();

  attempt("slider.value=string", () => ((slider as any).value = "loud"));
  attempt("text.lineLimit=object", () => ((text as any).lineLimit = { no: true }));
  attempt("button.bezelStyle=bogus", () => ((button as any).bezelStyle = "bogus"));
  attempt("button.width=string", () => ((button as any).width = "wide"));
  attempt("switch.hidden=string", () => new Switch({ hidden: "no" } as any));
  attempt("text.background=badcolor", () => (text.background = "not a colour"));
  attempt("text.background=rgb(nan)", () => (text.background = "rgb(nan,0,0)"));
  attempt("slider.step=-1", () => (slider.step = -1));
  attempt("text.font.size=Infinity", () => (text.font = { size: Infinity }));
  attempt("abstract View", () => new (View as any)());
  attempt("method as prop", () => new Button({ title: "b", click() {} } as any));
  attempt("unregistered prop", () => new Text({ text: "x", kind: "x" } as any));
  attempt("getter as prop", () => new Text({ text: "x", frame: 1 } as any));
  class MyText extends Text {}
  attempt("subclass props", () => new MyText({ text: "sub", lineLimit: 1 }));
  a.append(text);
  attempt("append twice", () => b.append(text));
  attempt("removeChild stranger", () => b.removeChild(button));
  // A rejected insertBefore/replaceChildren leaves both trees exactly as they were.
  const first = new Text({ text: "first" });
  b.append(first);
  attempt("insertBefore stranger ref", () => a.insertBefore(text, button));
  attempt("insertBefore move stranger ref", () => b.insertBefore(first, button));
  attempt("replaceChildren foreign child", () => b.replaceChildren(new Text({ text: "new" }), text));
  attempt("replaceChildren duplicate", () => b.replaceChildren(first, first));
  attempt("replaceChildren non-view", () => b.replaceChildren(first, {} as View));
  emit({
    step: "tree after rejected edits",
    a: a.children.map(c => (c as Text).text),
    b: b.children.map(c => (c as Text).text),
    textParent: text.parent === a,
    firstParent: first.parent === b,
  });
  attempt("image missing file", () => new Image({ image: { file: "/definitely/missing.png" } }));
  attempt("valid props", () => {
    slider.value = 3;
    text.lineLimit = 2;
    button.bezelStyle = "toolbar";
    text.background = "#ff000080";
  });

  attempt("window x without y", () => new Window({ x: 100, visible: false }));
  attempt("window show option", () => new Window({ show: false } as any));
  const windowsBefore = app.windows.length;
  attempt("unknown window option", () => new Window({ visible: false, bogus: 1 } as any));
  emit({ step: "unknown window option leak", leaked: app.windows.length - windowsBefore });
  const before2 = app.windows.length;
  attempt("window bad handler", () => new Window({ visible: false, onClose: 42 } as any));
  emit({ step: "window bad handler leak", leaked: app.windows.length - before2 });
  const before3 = app.windows.length;
  attempt("window bad content", () => new Window({ visible: false, content: {} } as any));
  emit({ step: "window bad content leak", leaked: app.windows.length - before3 });
  const before4 = app.windows.length;
  attempt("window width NaN", () => new Window({ width: NaN, visible: false }));
  emit({ step: "window width NaN leak", leaked: app.windows.length - before4 });
  attempt("window x Infinity", () => {
    const w = new Window({ visible: false });
    try {
      (w as any).x = Infinity;
    } finally {
      w.close();
    }
  });
  // NSWindow aborts the process on a frame edge outside [INT_MIN, INT_MAX], not only on NaN/Inf.
  const before5 = app.windows.length;
  attempt("window width 3e9", () => new Window({ width: 3e9, visible: false }));
  emit({ step: "window width 3e9 leak", leaked: app.windows.length - before5 });
  // The NSWindow already exists when the content turns out unmountable (its
  // handle was released): it is closed again, and an onClose given with it
  // does not run for a window the caller never got.
  const before6 = app.windows.length;
  attempt("window released content", () => {
    const dead = new Text({ text: "gone" });
    const handle = dead.native as unknown as { release(): void };
    handle.release();
    handle.release();
    new Window({ visible: false, content: dead, onClose: () => emit({ step: "window released content onClose" }) });
  });
  emit({ step: "window released content leak", leaked: app.windows.length - before6 });
  attempt("window x 1e15", () => {
    const w = new Window({ visible: false });
    try {
      w.x = 1e15;
    } finally {
      w.close();
    }
  });
  attempt("shown text width 3e9", () => {
    const w = new Window({ visible: false, content: new Text({ text: "x", width: 3e9 }) });
    try {
      w.show();
    } finally {
      w.close();
    }
  });
  const named = new Window({ restoreName: "bun-appkit-errors-test", visible: false });
  named.close();
  attempt("restoreName after close", () =>
    new Window({ restoreName: "bun-appkit-errors-test", visible: false }).close(),
  );
  const closed = new Window({ visible: false });
  attempt("window resizable=string", () => ((closed as any).resizable = "no"));
  closed.close();
  attempt("hide after close", () => closed.hide());
  attempt("title after close", () => (closed.title = "late"));
  attempt("resizable after close", () => (closed.resizable = false));
  attempt("menu action without colon", () => (app.menu = [{ title: "X", items: [{ title: "Copy", action: "copy" }] }]));
  attempt(
    "menu action outside the standard list",
    () => (app.menu = [{ title: "X", items: [{ title: "Bad", action: "doesNotRecognizeSelector:" }] }]),
  );
  attempt("content after close", () => {
    closed.content = new Text({ text: "late" });
  });
  emit({ step: "content after close state", content: closed.content === null });

  // MetalView's colour is parsed before it reaches the MTKView, so every
  // shape answers the same with or without a GPU.
  const metal = new MetalView({ clearColor: "#0000ff", running: false });
  attempt("metal.clearColor=number", () => ((metal as any).clearColor = 3));
  attempt("metal.clearColor=bogus", () => (metal.clearColor = "bogus"));
  attempt("metal.clearColor=rgb(nan)", () => (metal.clearColor = "rgb(nan, 0, 0)"));
  const afterRejected = metal.clearColor;
  attempt("metal.running=string", () => ((metal as any).running = "yes"));
  attempt("metal.preferredFPS=string", () => ((metal as any).preferredFPS = "fast"));
  attempt("metal.onFrame=number", () => ((metal as any).onFrame = 42));
  const accepted: Record<string, unknown> = {};
  for (const value of ["red", " windowBackground ", "rgba(0, 0, 255, 0.5)", "#fff", null]) {
    metal.clearColor = value as string;
    accepted[String(value)] = metal.clearColor;
  }
  metal.running = null as never;
  metal.preferredFPS = 30;
  emit({
    step: "metal props",
    afterRejected,
    accepted,
    running: metal.running,
    preferredFPS: metal.preferredFPS,
    onFrame: metal.onFrame,
    unknown: (() => {
      try {
        new MetalView({ colour: "red" } as any);
        return "constructed";
      } catch (e) {
        return String((e as Error).message);
      }
    })(),
  });
});
