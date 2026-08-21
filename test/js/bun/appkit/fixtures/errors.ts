import { app, Button, Image, Slider, Text, View, VStack, Window } from "bun:appkit";
import { emit, run } from "./_util";

function attempt(name: string, f: () => unknown) {
  try {
    f();
    emit({ step: name, threw: false });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err?.code === "ERR_APPKIT_UNAVAILABLE") throw err;
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
  attempt("button.kind=bogus", () => ((button as any).kind = "bogus"));
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
    button.kind = "primary";
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
  attempt("window create-only after create", () => ((closed as unknown as { resizable: boolean }).resizable = false));
  closed.close();
  attempt("hide after close", () => closed.hide());
  attempt("title after close", () => (closed.title = "late"));
  attempt("menu action without colon", () => (app.menu = [{ title: "X", items: [{ title: "Copy", action: "copy" }] }]));
  attempt(
    "menu action outside the standard list",
    () => (app.menu = [{ title: "X", items: [{ title: "Bad", action: "doesNotRecognizeSelector:" }] }]),
  );
  attempt("content after close", () => {
    closed.content = new Text({ text: "late" });
  });
  emit({ step: "content after close state", content: closed.content === null });
});
