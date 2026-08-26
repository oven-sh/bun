// VStack, HStack, ZStack, Group, ScrollView and SplitView are NSStackView,
// NSView, NSBox, NSScrollView and NSSplitView objects built through the objc
// bridge: `.native` is that object, children are its subviews, the readable
// props answer from it, and the common props are constraints and sends on
// each child's own NSView.
import {
  app,
  Button,
  Group,
  HStack,
  NativeView,
  ScrollView,
  SplitView,
  Text,
  TextEditor,
  VStack,
  Window,
  ZStack,
} from "bun:appkit";
import { appKitInternals } from "bun:internal-for-testing";
import { objc } from "bun:objc";
import { emit, run, waitFor } from "./_util";

await run(async () => {
  app.activationPolicy = "accessory";
  const { NSStackView, NSBox, NSScrollView, NSSplitView, NSClipView, NSColor, NSColorSpace } = objc.classes;
  const { NSStackViewDistribution, NSLayoutAttribute, NSTitlePosition } = objc.enums;
  const attempt = (f: () => unknown) => {
    try {
      f();
      return null;
    } catch (e) {
      return { message: String((e as Error).message), code: (e as { code?: string }).code };
    }
  };

  // A stack's children are its arranged subviews, and its props read the
  // NSStackView, so a change made through `.native` shows.
  {
    const a = new Button("a");
    const b = new Text("b");
    const stack = new VStack({ spacing: 3, children: [a, b] });
    stack.native.setSpacing_(5);
    const distributions: unknown[] = [];
    for (const value of [
      "fillEqually",
      "gravity",
      "gravityAreas",
      "NSStackViewDistributionEqualSpacing",
      2,
      -1,
      NSStackViewDistribution.gravityAreas,
    ]) {
      stack.distribution = value as never;
      distributions.push([stack.distribution, stack.native.distribution()]);
    }
    (stack as { distribution: unknown }).distribution = null;
    const row = new HStack({ align: "lastBaseline", padding: { x: 6, y: 2 } });
    // `align` takes the curated names or any NSLayoutAttribute, and reads
    // whatever the stack's alignment now is; `padding` reads its edge insets.
    const column = new VStack();
    const aligned: unknown[] = [];
    for (const value of [
      "center",
      "trailing",
      "bottom",
      "centerX",
      NSLayoutAttribute.trailing,
      "NSLayoutAttributeRight",
    ]) {
      column.align = value as never;
      aligned.push([column.align, column.native.alignment()]);
    }
    column.native.setAlignment_(NSLayoutAttribute.centerX);
    aligned.push([column.align, column.native.alignment()]);
    (column as { align: unknown }).align = null;
    aligned.push([column.align, column.native.alignment()]);
    column.native.setEdgeInsets_({ top: 1, left: 2, bottom: 3, right: 4 });
    emit({
      step: "stack",
      isStack: stack.native.isKindOfClass_(NSStackView),
      arranged: stack.native.arrangedSubviews().count(),
      sameChild: stack.native.arrangedSubviews().objectAtIndex_(0) === a.native,
      superview: a.native.superview() === stack.native,
      spacing: stack.spacing,
      distributions,
      reset: stack.distribution === "fill" && stack.native.distribution() === NSStackViewDistribution.fill,
      vertical: stack.native.orientation() === 1 && row.native.orientation() === 0,
      alignments: [
        stack.align,
        stack.native.alignment() === NSLayoutAttribute.leading,
        row.align,
        row.native.alignment() === NSLayoutAttribute.lastBaseline,
      ],
      insets: row.native.edgeInsets(),
      padding: [row.padding, new VStack({ padding: [1, 2] }).native.edgeInsets(), new VStack().padding, column.padding],
      aligned,
      badDistribution: attempt(() => (stack.distribution = "spread" as never)),
      badNegative: attempt(() => (stack.distribution = -2)),
      badPadding: attempt(() => (row.padding = [1, 2, 3] as never)),
      badAlign: attempt(() => (row.align = "middle" as never)),
      badBaseline: attempt(() => (column.align = NSLayoutAttribute.firstBaseline)),
    });
  }

  // The common props are the child's own NSView: sizes are constraints on
  // it, the rest are its properties, read back live.
  {
    const label = new Text({ text: "sized", width: 80, minHeight: 30, tooltip: "t", id: "the-label", alpha: 0.5 });
    label.native.setToolTip_("from native");
    label.native.setHidden_(true);
    const before = label.native.constraints().count();
    label.width = 90;
    label.width = null;
    emit({
      step: "common",
      tooltip: label.tooltip,
      hidden: label.hidden,
      id: `${label.native.identifier()}`,
      alpha: label.native.alphaValue(),
      constraints: [before, label.native.constraints().count()],
      reads: [label.width, label.minHeight, label.maxWidth],
      corner: ((label.cornerRadius = 4), [label.cornerRadius, label.native.layer().cornerRadius()]),
      background: ((label.background = "red"), label.native.layer().backgroundColor() !== null),
      autoresizing: label.native.translatesAutoresizingMaskIntoConstraints(),
    });
    // A CGColorRef argument takes a CGColor object and nothing else: not a
    // boxed string or number, and not another Core Foundation type.
    const layer = label.native.layer();
    layer.setBackgroundColor_(null);
    emit({
      step: "cgcolor",
      cleared: layer.backgroundColor(),
      string: attempt(() => layer.setBackgroundColor_("red")),
      number: attempt(() => layer.setBackgroundColor_(42)),
      array: attempt(() => layer.setBackgroundColor_([1, 0, 0])),
      nscolor: attempt(() => layer.setBackgroundColor_(NSColor.redColor())),
      colorSpace: attempt(() => layer.setBackgroundColor_(NSColorSpace.sRGBColorSpace().CGColorSpace())),
      set: (layer.setBackgroundColor_(NSColor.redColor().CGColor()), layer.backgroundColor() !== null),
      roundTrip: (layer.setBorderColor_(layer.backgroundColor()), layer.borderColor() === layer.backgroundColor()),
    });
  }

  // What the views read for their own use (a layer, the window, a shared
  // colour, NSApp, the constraints they add) are the same handles the script
  // gets, and the module never releases them: one the script holds stays
  // usable however many props touched its object.
  {
    const usable = (handle: any) => attempt(() => handle.self()) === null;
    const box = new VStack({ children: [new Text("counted")] });
    const win = new Window({ title: "counts", content: box, visible: false });
    const stack = box.native;
    stack.setWantsLayer_(true);
    const layer = stack.layer();
    box.width = 120;
    const constraint = stack.constraints().lastObject();
    const labelColor = NSColor.labelColor();
    const nsapp = objc.classes.NSApplication.sharedApplication();
    box.cornerRadius = 6;
    box.background = "red";
    box.border = 2;
    box.width = null;
    void [box.cornerRadius, box.frame, box.frame, box.hidden];
    const words = new Text({ text: "words", color: "red" });
    words.color = null;
    app.menu = [{ title: "Counts", items: [{ title: "Item", onClick() {} }] }];
    app.menu = null;
    emit({
      step: "counts",
      layer: usable(layer) && layer === stack.layer(),
      constraint: usable(constraint),
      labelColor: usable(labelColor) && labelColor === NSColor.labelColor(),
      nsapp: usable(nsapp) && nsapp === objc.classes.NSApplication.sharedApplication(),
      stackUsable: usable(stack) && stack === box.native,
    });
    // A view's colours are AppKit's shared NSColors, read again when it
    // paints rather than held: a script that ends the handle it got for the
    // same colour does not break the next repaint.
    NSColor.systemRedColor().release();
    NSColor.separatorColor().release();
    emit({
      step: "shared colours",
      border: attempt(() => void (box.border = 1)),
      background: attempt(() => void (box.background = " red ")),
      painted: layer.backgroundColor() !== null && layer.borderColor() !== null,
      fresh: usable(NSColor.systemRedColor()),
      reads: [box.background, box.border],
    });
    // The children are the ones the container's methods put there: a view
    // added to its NSView through `.native` is a subview but not a child,
    // and reads no parent or window; taken out again the same way, nothing
    // here notices either.
    const extra = new Text("by hand");
    stack.addSubview_(extra.native);
    const byHand = {
      subviews: stack.subviews().count(),
      children: box.children.length,
      parent: extra.parent,
      window: extra.window,
      arranged: stack.arrangedSubviews().count(),
    };
    extra.native.removeFromSuperview();
    emit({ step: "native subview", byHand, after: [stack.subviews().count(), box.children.length] });

    // The other direction: an NSView made through the bridge becomes a child
    // with NativeView, and the common props, frame, parent and window work on it.
    const picker = objc.classes.NSDatePicker.alloc().initWithFrame_({ x: 0, y: 0, width: 0, height: 0 });
    const adopted = new NativeView(picker, { width: 180, tooltip: "when" });
    box.append(adopted);
    const Drawn = objc.defineClass({ superclass: "NSView", methods: { isFlipped: true } });
    const drawn = new NativeView(Drawn.new(), { width: 40, height: 30, background: "red" });
    box.append(drawn);
    emit({
      step: "native view",
      same: adopted.native === picker,
      unknownProp: attempt(() => new NativeView(objc.classes.NSView.new(), { title: "x" } as never)),
      // `width` sizes the alignment rect; the bezeled picker's frame is wider by its insets.
      width: [
        adopted.width,
        Math.round(adopted.frame.width - picker.alignmentRectInsets().right - picker.alignmentRectInsets().left),
      ],
      tooltip: String(picker.toolTip()),
      parent: adopted.parent === box,
      window: adopted.window === win,
      children: box.children.includes(adopted) && box.children.includes(drawn),
      arranged: stack.arrangedSubviews().containsObject_(picker),
      drawnFrame: [Math.round(drawn.frame.width), Math.round(drawn.frame.height)],
      drawnLayer: drawn.native.layer() !== null,
      snapshot: drawn.snapshot() instanceof Uint8Array,
      twice: attempt(() => new NativeView(picker)),
      owned: attempt(() => new NativeView(extra.native)),
      placed: (() => {
        const sub = objc.classes.NSView.new();
        stack.addSubview_(sub);
        const refused = attempt(() => new NativeView(sub));
        sub.removeFromSuperview();
        return refused;
      })(),
      notView: attempt(() => new NativeView(objc.classes.NSString.new())),
      notHandle: attempt(() => new NativeView({} as never)),
      removed: (adopted.remove(), [adopted.parent, picker.superview(), box.children.includes(adopted)]),
    });
    win.close();
  }

  // A Group is an NSBox around a stack; ZStack a plain NSView whose subview
  // order is the children's; ScrollView an NSScrollView whose document is
  // the child and whose clip view is flipped; SplitView an NSSplitView.
  {
    const inner = new Button("in");
    const group = new Group({ title: "Box", children: [inner] });
    group.native.setTitle_("Renamed");
    const untitled = new Group();
    // A title position chosen through `.native` survives retitling; only an
    // empty title moves it (to none) and the next title back (to the top).
    const positioned = new Group({ title: "Low" });
    positioned.native.setTitlePosition_(NSTitlePosition.belowTop);
    const kept = ((positioned.title = "Lower"), positioned.native.titlePosition());
    const none = ((positioned.title = ""), positioned.native.titlePosition());
    const top = ((positioned.title = "Back"), positioned.native.titlePosition());
    const back = new Text("back");
    const front = new Text("front");
    const layers = new ZStack({ children: [back, front] });
    const editor = new TextEditor();
    const scroll = new ScrollView({ children: [editor] });
    scroll.native.setHasHorizontalScroller_(true);
    const split = new SplitView({ children: [new Text("l"), new Text("r")] });
    split.native.setVertical_(false);
    emit({
      step: "kinds",
      group: {
        isBox: group.native.isKindOfClass_(NSBox),
        title: group.title,
        titlePositions: [
          group.native.titlePosition(),
          untitled.native.titlePosition(),
          untitled.title,
          kept,
          none,
          top,
        ],
        innerStack: inner.native.superview().isKindOfClass_(NSStackView),
        inContent: inner.native.superview().superview() === group.native.contentView(),
      },
      zstack: {
        className: `${layers.native.class()}`,
        order: [
          layers.native.subviews().objectAtIndex_(0) === back.native,
          layers.native.subviews().objectAtIndex_(1) === front.native,
        ],
        reordered: (layers.insertBefore(front, back), layers.native.subviews().objectAtIndex_(0) === front.native),
      },
      scroll: {
        isScrollView: scroll.native.isKindOfClass_(NSScrollView),
        document: scroll.native.documentView() === editor.native,
        clip: [scroll.native.contentView().isKindOfClass_(NSClipView), scroll.native.contentView().isFlipped()],
        scrollBars: scroll.scrollBars,
        second: attempt(() => scroll.append(new Text("two"))),
        badBars: attempt(() => (scroll.scrollBars = "sideways" as never)),
      },
      split: {
        isSplitView: split.native.isKindOfClass_(NSSplitView),
        vertical: split.vertical,
        panes: split.native.arrangedSubviews().count(),
      },
    });
  }

  // Containers count as live views and are collected with their children.
  {
    // Views the steps above dropped go first, so the baseline holds only what something still refers to.
    let before = -1;
    await waitFor(
      () => {
        const last = before;
        Bun.gc(true);
        before = appKitInternals.liveViews();
        return before === last;
      },
      "the live view count to settle",
      3000,
    );
    (() => {
      for (let i = 0; i < 20; i++) {
        new VStack({ children: [new Button(`b${i}`), new HStack({ children: [new Text("t")] })] });
        new Group({ children: [new ScrollView({ children: [new ZStack()] })] });
        new SplitView({ children: [new Text("p")] });
      }
    })();
    const created = appKitInternals.liveViews() - before;
    let after = created;
    await waitFor(
      () => {
        Bun.gc(true);
        after = appKitInternals.liveViews() - before;
        return after === 0;
      },
      "containers to be collected",
      3000,
    );
    emit({ step: "collected", created, after });
  }

  // A window takes any of them as content; closing it lets the content go elsewhere.
  {
    const content = new HStack({ children: [new Text("moved")] });
    const first = new Window({ width: 200, height: 80, content });
    const inFirst = content.native.window() === first.native;
    first.close();
    const second = new Window({ width: 200, height: 80, content });
    emit({
      step: "window",
      inFirst,
      detached: content.parent === null,
      inSecond: content.native.window() === second.native,
    });
    second.close();
  }
});
