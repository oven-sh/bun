import {
  app,
  Button,
  Checkbox,
  Divider,
  Group,
  HStack,
  Picker,
  Progress,
  Segmented,
  Spacer,
  SplitView,
  Text,
  View,
  VStack,
  Window,
  ZStack,
} from "bun:appkit";
import { emit, run } from "./_util";

// Layout rules that need a real Auto Layout pass to check. `frame` lays the
// window out before answering, so nothing here waits or snapshots first.
await run(async () => {
  app.activationPolicy = "accessory";

  const same = (a: Uint8Array | null, b: Uint8Array | null) => !!a && !!b && Buffer.from(a).equals(Buffer.from(b));
  const inWindow = <T>(content: View, size: { width: number; height: number }, body: (win: Window) => T): T => {
    const win = new Window({ title: "layout", ...size, content });
    win.show();
    try {
      return body(win);
    } finally {
      win.close();
    }
  };

  // frame is current straight after a mutation, without a snapshot first;
  // out of a window it is all zeros, and reading it delivers onResize after
  // the value was taken rather than in the middle of the layout pass.
  {
    const label = new Text({ text: "short" });
    const stack = new VStack({ align: "leading" });
    const detached = { ...label.frame };
    inWindow(stack, { width: 300, height: 100 }, win => {
      stack.append(label);
      const appended = label.frame.width;
      const events: string[] = [];
      win.onResize = () => {
        events.push("resize");
        events.push(`nested:${tall.frame.height > 0}`);
      };
      const tall = new ZStack({ height: 400 });
      stack.append(tall);
      events.push("appended");
      const height = win.height;
      events.push("read");
      label.text = "a label that is very much longer than before";
      const grown = label.frame.width;
      emit({ step: "frame", detached, appended, grown, height, events });
    });
  }

  // A Group sizes itself around its children and lays them out.
  {
    const a = new Button({ title: "A" });
    const b = new Button({ title: "B" });
    const titled = new Group({ title: "Titled", children: [a, b] });
    const bare = new Group({ children: [new Button({ title: "A" }), new Button({ title: "B" })] });
    const stack = new VStack({ children: [titled, bare] });
    inWindow(stack, { width: 300, height: 300 }, () => {
      emit({
        step: "group",
        titled: titled.frame,
        bare: bare.frame,
        a: a.frame,
        b: b.frame,
        stack: stack.frame,
      });
    });
  }

  // A long title truncates inside the window instead of widening it, for
  // every control that draws one.
  {
    const long = Buffer.alloc(2000, "x").toString();
    const widths: Record<string, number> = {};
    const controls: Record<string, View> = {
      button: new Button({ title: long }),
      checkbox: new Checkbox({ title: long }),
      picker: new Picker({ items: [long] }),
      segmented: new Segmented({ items: [long, "b"] }),
      text: new Text({ text: long }),
    };
    for (const [name, control] of Object.entries(controls)) {
      inWindow(new VStack({ children: [control] }), { width: 300, height: 80 }, win => {
        control.frame;
        widths[name] = win.width;
      });
    }
    // Twenty ordinary buttons (about 1600pt of titles) in a row do not add up
    // either. Only titles give way, not the 8pt gaps, so those must fit: 19 do.
    const row = new HStack();
    for (let i = 0; i < 20; i++) row.append(new Button({ title: `Button ${i}` }));
    inWindow(row, { width: 300, height: 80 }, win => {
      row.frame;
      widths.row = win.width;
    });
    emit({ step: "long labels", widths });
  }

  // Content taller than the window makes it taller, as wider content makes it
  // wider; content that fits leaves the size alone. maxHeight caps that, and
  // an explicit child width past maxWidth is cut to it.
  {
    const tall = new VStack({ spacing: 0, children: [new ZStack({ height: 250 }), new ZStack({ height: 250 })] });
    const grown = inWindow(tall, { width: 300, height: 120 }, win => {
      tall.frame;
      return [win.width, win.height];
    });
    const short = new VStack({ children: [new ZStack({ height: 20 })] });
    const kept = inWindow(short, { width: 300, height: 120 }, win => {
      short.frame;
      return [win.width, win.height];
    });
    const capped = new VStack({ children: [new ZStack({ width: 600, height: 250 })] });
    const win = new Window({ width: 300, height: 120, maxWidth: 400, maxHeight: 200, content: capped });
    win.show();
    const cappedSize = [win.width, win.height, capped.frame.width];
    // Programmatic sizes respect the limits too, and lowering a limit under
    // the current size shrinks the window to it.
    win.width = 5000;
    const setPastMax = win.width;
    win.maxWidth = 350;
    const afterLowerMax = win.width;
    win.close();
    emit({ step: "tall content", grown, kept, cappedSize, setPastMax, afterLowerMax });
  }

  // min beats max and an exact size is clamped between them, whichever
  // order the three arrive in.
  {
    const measure = (props: Record<string, unknown>, after?: (v: View) => void) => {
      const v = new ZStack({ height: 10, ...props });
      after?.(v);
      const stack = new VStack({ align: "leading", children: [v] });
      return inWindow(stack, { width: 400, height: 60 }, () => v.frame.width);
    };
    emit({
      step: "min max",
      minOverMax: measure({ minWidth: 200, maxWidth: 100 }),
      maxThenMin: measure({ maxWidth: 100 }, v => (v.minWidth = 200)),
      widthUnderMin: measure({ width: 50, minWidth: 100 }),
      widthOverMax: measure({ width: 300, maxWidth: 120 }),
      maxCleared: measure({ width: 300, maxWidth: 120 }, v => (v.maxWidth = null)),
    });
  }

  // Spacers share leftover space equally, so one on each side centres; `grow`
  // weights share it in ratio, including for views with no natural size.
  {
    const left = new Spacer();
    const right = new Spacer();
    const label = new Text({ text: "centred" });
    const row = new HStack({ children: [left, label, right] });
    const centred = inWindow(row, { width: 300, height: 40 }, () => ({
      left: left.frame.width,
      right: right.frame.width,
      labelMid: label.frame.x + label.frame.width / 2,
      rowWidth: row.frame.width,
    }));
    const one = new ZStack({ grow: 1, height: 10 });
    const two = new ZStack({ grow: 2, height: 10 });
    const fixed = new Button({ title: "fixed" });
    const weighted = new HStack({ spacing: 0, children: [one, two, fixed] });
    const ratio = inWindow(weighted, { width: 340, height: 40 }, () => ({
      one: one.frame.width,
      two: two.frame.width,
      fixed: fixed.frame.width,
    }));
    // Changing grow after mounting re-shares; hiding a grower hands its share on.
    const a = new VStack({ grow: 1, children: [new Text({ text: "a" })] });
    const b = new VStack({ grow: 1, children: [new Text({ text: "b" })] });
    const stacks = new HStack({ spacing: 0, children: [a, b] });
    const nested = inWindow(stacks, { width: 300, height: 40 }, () => {
      const equal = [a.frame.width, b.frame.width];
      b.grow = 2;
      const reweighted = [a.frame.width, b.frame.width];
      b.hidden = true;
      const hidden = a.frame.width;
      b.hidden = false;
      b.grow = 1;
      const restored = [a.frame.width, b.frame.width];
      return { equal, reweighted, hidden, restored };
    });
    emit({ step: "grow", centred, ratio, nested });
  }

  // In a SplitView the pane with `grow` is the one that absorbs a resize.
  {
    const still = new VStack({ children: [new Text({ text: "left" })] });
    const grows = new VStack({ grow: 1, children: [new Text({ text: "right" })] });
    const split = new SplitView({ children: [still, grows] });
    const win = new Window({ width: 300, height: 60, content: split });
    win.show();
    const before = [still.frame.width, grows.frame.width];
    win.width = 500;
    const after = [still.frame.width, grows.frame.width];
    win.close();
    emit({ step: "split grow", before, after });
  }

  // A Divider runs across its container: vertical in a row, horizontal in a
  // column, and follows a move between them unless `vertical` was set.
  {
    const auto = new Divider();
    const flat = new Divider({ vertical: false });
    const row = new HStack({ height: 48, children: [new Text({ text: "L" }), auto, flat, new Text({ text: "R" })] });
    const column = new VStack({ children: [row] });
    const frames = inWindow(column, { width: 300, height: 100 }, () => {
      const inRow = { auto: auto.frame, flat: flat.frame };
      row.removeChild(auto);
      column.append(auto);
      const inColumn = auto.frame;
      return { inRow, inColumn };
    });
    emit({ step: "divider", ...frames });
  }

  // Progress keeps the value it was given when the range arrives after it.
  {
    const valueFirst = new Progress({ value: 150, max: 200, width: 120 });
    const maxFirst = new Progress({ max: 200, value: 150, width: 120 });
    const half = new Progress({ max: 200, value: 100, width: 120 });
    const stack = new VStack({ children: [valueFirst, maxFirst, half] });
    inWindow(stack, { width: 200, height: 120 }, () => {
      const [a, b, c] = [valueFirst.snapshot(), maxFirst.snapshot(), half.snapshot()];
      emit({ step: "progress order", sameAsMaxFirst: same(a, b), sameAsHalf: same(a, c) });
    });
  }

  // click() on something that is not clickable says so.
  {
    let message = "";
    try {
      Button.prototype.click.call(new Text({ text: "not a control" }));
    } catch (e) {
      message = String((e as Error).message);
    }
    emit({ step: "click", message });
  }

  emit({ step: "done" });
});
