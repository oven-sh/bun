import {
  app,
  Button,
  Divider,
  HStack,
  Slider,
  Spacer,
  SplitView,
  Text,
  TextField,
  View,
  VStack,
  Window,
  ZStack,
} from "bun:appkit";
import { emit, run, waitFor } from "./_util";

await run(async () => {
  app.activationPolicy = "accessory";

  const text = new Text({ text: "Hello" });
  const button = new Button({ title: "Press" });
  const field = new TextField({ placeholder: "type here" });
  const slider = new Slider({ min: 0, max: 10 });
  const stack = new VStack({ spacing: 4 });
  stack.append(text, button, field, slider);

  const win = new Window({ title: "props", width: 300, height: 200, content: stack });
  win.show();

  text.text = "World";
  text.tooltip = "tip";
  button.title = "Go";
  button.enabled = false;
  field.value = "typed";
  slider.value = 7.5;
  win.title = "retitled";

  emit({
    step: "props",
    text: text.text,
    tooltip: text.tooltip,
    buttonTitle: button.title,
    buttonEnabled: button.enabled,
    fieldValue: field.value,
    sliderValue: slider.value,
    windowTitle: win.title,
    children: stack.children.length,
    parentIsStack: text.parent === stack,
    windowOfText: text.window === win,
    windows: Array.from(app.windows).length,
    visible: win.visible,
  });

  await waitFor(() => button.frame.width > 0 && text.frame.height > 0, "layout");
  emit({ step: "layout", button: button.frame, text: text.frame, window: [win.width, win.height] });

  // `grow` and a SplitView parent both loosen a view's hold on its size;
  // clearing them must give the widget its own priorities back.
  const widthAfter = (view: View, change?: () => void) => {
    change?.();
    win.snapshot();
    return view.frame.width;
  };
  const w0 = widthAfter(text);
  const growZero = widthAfter(text, () => {
    text.grow = 1;
    text.grow = 0;
  });
  const growNull = widthAfter(text, () => {
    text.grow = 1;
    (text as { grow: number | null }).grow = null;
  });
  // A vertical Divider sets its own priorities again when `vertical` flips,
  // so one flipped while grown or inside a SplitView must still stretch like
  // a fresh one afterwards.
  const fresh = new Divider({ vertical: true });
  const grown = new Divider();
  grown.grow = 1;
  grown.vertical = true;
  grown.grow = 0;
  const penned = new Divider();
  const fold = new SplitView();
  fold.append(penned);
  penned.vertical = true;
  fold.removeChild(penned);
  const rules = new HStack({ height: 48 });
  rules.append(fresh, grown, penned);
  stack.append(rules);
  win.snapshot();
  const divider = [fresh.frame.height, grown.frame.height, penned.frame.height];
  stack.removeChild(rules);

  const moved = new Button({ title: button.title });
  const pen = new SplitView();
  pen.append(moved);
  pen.removeChild(moved);
  const row = new HStack();
  row.append(moved, new Text({ text: "fills" }));
  stack.append(row);
  emit({
    step: "priorities restored",
    text: [w0, growZero, growNull],
    button: [widthAfter(button), moved.frame.width],
    divider,
  });
  stack.removeChild(row);

  // A spacer's minLength holds along a split view's axis too, here pushing
  // the window wider than it was made.
  const spacer = new Spacer({ minLength: 300 });
  const split = new SplitView();
  split.append(new Text({ text: "L" }), spacer, new Text({ text: "R" }));
  const splitWin = new Window({ title: "split", width: 200, height: 60, content: split });
  splitWin.show();
  splitWin.snapshot();
  await waitFor(() => split.frame.width > 0, "split layout");
  emit({ step: "split spacer", spacer: spacer.frame.width, split: split.frame.width });
  // Turning the split after the spacer is in it moves the constraint to the
  // new axis.
  split.vertical = true;
  splitWin.snapshot();
  emit({ step: "split spacer turned", spacer: spacer.frame });
  splitWin.close();

  // ZStack children overlap back to front in children order; moving a child
  // changes which one is on top.
  const red = new ZStack({ background: "#ff0000" });
  const blue = new ZStack({ background: "#0000ff" });
  const layers = new ZStack({ width: 8, height: 8 });
  layers.append(red, blue);
  const layerWin = new Window({ title: "z", width: 8, height: 8, content: layers });
  layerWin.show();
  const blueOnTop = layers.snapshot();
  layers.insertBefore(blue, red);
  const redOnTop = layers.snapshot();
  layers.insertBefore(red, blue);
  const blueOnTopAgain = layers.snapshot();
  const same = (a: Uint8Array | null, b: Uint8Array | null) => !!a && !!b && Buffer.from(a).equals(Buffer.from(b));
  emit({
    step: "zstack order",
    children: layers.children.map(c => (c === red ? "red" : "blue")),
    reorderChangesPixels: !same(blueOnTop, redOnTop),
    restoredMatchesOriginal: same(blueOnTop, blueOnTopAgain),
  });
  layerWin.close();

  win.onClose = () => emit({ step: "onClose" });
  win.close();
  emit({ step: "closed", closed: win.closed, windows: Array.from(app.windows).length });

  // Nothing keeps the process alive now, so this unref'd timer must never fire.
  setTimeout(() => emit({ step: "unexpected-timer" }), 200).unref();
});
