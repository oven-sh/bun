// A Window is an NSWindow made through the bridge: every option is a live
// property of the window, the events come from its notifications and its own
// windowShouldClose: (the delegate slot is the script's), and a closed,
// unreferenced window is collected.
import { app, Text, VStack, Window } from "bun:appkit";
import { objc } from "bun:objc";
import { emit, run, tick, waitFor } from "./_util";

type H = { [selector: string]: (...args: unknown[]) => any };

await run(async () => {
  app.activationPolicy = "accessory";
  const { NSWindowStyleMask, NSWindowTitleVisibility, NSWindowCollectionBehavior } = objc.enums;

  const events: string[] = [];
  const win = new Window({
    title: "first",
    width: 200,
    height: 100,
    content: new Text({ text: "x" }),
    onResize: ({ width, height }) => events.push(`resize ${width}x${height}`),
    onMove: ({ x, y }) => events.push(`move ${x},${y}`),
    onFocus: () => events.push("focus"),
    onBlur: () => events.push("blur"),
    onClose: () => events.push("close"),
    shouldClose: () => (events.push("shouldClose"), false),
  });
  const ns = win.native as unknown as H;

  // The program's own geometry changes are not reported; the same changes
  // arriving from anywhere else (here: through .native, as a user's would)
  // are, with the payload read from the window.
  win.width = 300;
  win.x = 10;
  win.center();
  ns.setContentSize_({ width: 320, height: 120 });
  ns.setFrameOrigin_({ x: 30, y: 40 });
  // The close button's path: windowShouldClose: refuses, nothing closes.
  ns.performClose_(null);
  const closedAfterRefusal = win.closed;
  // Key-window changes reach onFocus/onBlur through the window's notifications.
  ns.becomeKeyWindow();
  ns.resignKeyWindow();
  emit({
    step: "events",
    isWindow: ns.isKindOfClass_(objc.classes.NSWindow),
    className: String(ns.className()),
    sameHandle: win.native === win.native && (win.native as unknown as H).contentView().window() === win.native,
    delegate: ns.delegate(),
    answersShouldClose: ns.respondsToSelector_("windowShouldClose:"),
    events: events.splice(0),
    closedAfterRefusal,
    width: win.width,
    x: win.x,
    y: win.y,
  });

  // The delegate is the script's: one of its own hears the window too, and
  // the Window's events keep coming. A delegate that implements
  // windowShouldClose: answers the close button instead of `shouldClose`.
  {
    const heard: string[] = [];
    const Delegate = objc.defineClass({
      protocols: ["NSWindowDelegate"],
      methods: {
        "windowDidResize:": () => void heard.push("resize"),
        "windowWillClose:": () => void heard.push("close"),
      },
    });
    const Decides = objc.defineClass({
      protocols: ["NSWindowDelegate"],
      methods: { "windowShouldClose:": () => (heard.push("asked"), false) },
    });
    const own: string[] = [];
    const w = new Window({
      visible: false,
      width: 120,
      height: 80,
      onResize: ({ width }) => own.push(`resize ${width}`),
      onClose: () => own.push("close"),
      shouldClose: () => (own.push("shouldClose"), true),
    });
    const nw = w.native as unknown as H;
    const delegate = Delegate.new();
    nw.setDelegate_(delegate);
    nw.setContentSize_({ width: 160, height: 80 });
    const decides = Decides.new();
    nw.setDelegate_(decides);
    nw.performClose_(null);
    const closedByDelegate = w.closed;
    nw.setDelegate_(delegate);
    nw.performClose_(null);
    emit({
      step: "own delegate",
      sameDelegate: nw.delegate() === delegate,
      heard,
      own,
      closedByDelegate,
      closed: w.closed,
      windows: app.windows.includes(w),
    });
  }

  // Every option reads the window, so a change made through .native shows, and writes it.
  ns.setTitle_("renamed");
  const title = win.title;
  win.title = "again";
  const styleBits = (): Record<string, boolean> => ({
    resizable: (ns.styleMask() & NSWindowStyleMask.resizable) !== 0,
    closable: (ns.styleMask() & NSWindowStyleMask.closable) !== 0,
    minimizable: (ns.styleMask() & NSWindowStyleMask.miniaturizable) !== 0,
    fullSizeContent: (ns.styleMask() & NSWindowStyleMask.fullSizeContentView) !== 0,
  });
  const initialBits = styleBits();
  win.resizable = false;
  win.closable = false;
  win.minimizable = false;
  win.fullSizeContent = true;
  const flippedBits = styleBits();
  const flippedProps = {
    resizable: win.resizable,
    closable: win.closable,
    minimizable: win.minimizable,
    fullSizeContent: win.fullSizeContent,
  };
  const fullScreenOff = (ns.collectionBehavior() & NSWindowCollectionBehavior.fullScreenPrimary) !== 0;
  ns.setStyleMask_(ns.styleMask() | NSWindowStyleMask.resizable);
  const resizableViaNative = win.resizable;
  (win as { resizable: boolean | null }).resizable = null;
  const fullScreenOn = (ns.collectionBehavior() & NSWindowCollectionBehavior.fullScreenPrimary) !== 0;
  win.titleHidden = true;
  win.titlebarTransparent = true;
  win.alpha = 7;
  const alphaClamped = win.alpha;
  ns.setAlphaValue_(0.5);
  win.background = "#ff0000";
  const backgroundSet = String(ns.backgroundColor()).includes(" 1 0 0 1");
  (win as { background: string | null }).background = null;
  emit({
    step: "live",
    title,
    titleAgain: String(ns.title()),
    initialBits,
    flippedBits,
    flippedProps,
    fullScreenOff,
    resizableViaNative,
    fullScreenOn,
    titleHidden: [win.titleHidden, ns.titleVisibility() === NSWindowTitleVisibility.hidden],
    titlebarTransparent: [win.titlebarTransparent, ns.titlebarAppearsTransparent()],
    alphaClamped,
    alphaViaNative: win.alpha,
    backgroundSet,
    backgroundReset: win.background,
    visible: [win.visible, ns.isVisible()],
  });

  // restoreName is the frame autosave name, live; a closed window gives its name up.
  win.restoreName = "bun-appkit-windows-test";
  const named = [win.restoreName, String(ns.frameAutosaveName())];
  (win as { restoreName: string | null }).restoreName = null;
  const cleared = [win.restoreName, String(ns.frameAutosaveName())];
  const other = new Window({ visible: false, restoreName: "bun-appkit-windows-other" });
  const otherWindow = other.native as unknown as H;
  other.close();
  emit({ step: "restoreName", named, cleared, afterClose: String(otherWindow.frameAutosaveName()) });

  // Size limits bound the content through constraints on the container the
  // content is pinned into, and the window through its content min/max size.
  win.minWidth = 400;
  win.maxHeight = 90;
  const container = (ns.contentView() as H).subviews().objectAtIndex_(0) as H;
  emit({
    step: "limits",
    read: [win.minWidth, win.maxHeight, win.maxWidth],
    size: [win.width, win.height],
    contentMin: ns.contentMinSize().width,
    contentMax: ns.contentMaxSize().height,
    containerConstraints: container.constraints().count(),
    contentSuperviewIsContainer: (win.content!.native as unknown as H).superview() === container,
    resizeEvents: events.splice(0),
  });

  // close(): shouldClose is not asked, the content leaves the window (and can
  // be mounted elsewhere), onClose runs once however many paths get there.
  win.shouldClose = () => (events.push("shouldClose"), true);
  const content = win.content!;
  win.close();
  win.close();
  ns.close();
  const second = new Window({ visible: false, content: new VStack({ children: [content] }) });
  emit({
    step: "closed",
    events: events.splice(0),
    closed: win.closed,
    visible: win.visible,
    key: win.key,
    contentWindow: content.window === second,
    superviewGone: (content.native as unknown as H).window() === second.native,
    nativeStillAnswers: String(ns.title()),
    windows: app.windows.length,
  });
  // The NSWindow outlives the close, and .native keeps handing it out.
  emit({
    step: "native after close",
    same: win.native === ns,
    frame: typeof (win.native as unknown as H).frame().size.width,
  });
  second.close();

  // The limits read the window, so one set through .native shows; a minimum
  // past the maximum raises the maximum with it, on the window and on the
  // container alike, and each axis leaves the other's native values alone.
  {
    const w = new Window({ visible: false, width: 200, height: 100, maxWidth: 300, maxHeight: 150 });
    const nw = w.native as unknown as H;
    const box = (nw.contentView() as H).subviews().objectAtIndex_(0) as H;
    const constants = () => {
      const list = box.constraints();
      const out: number[] = [];
      for (let i = 0; i < list.count(); i++) out.push(list.objectAtIndex_(i).constant());
      return out.sort((a, b) => a - b);
    };
    const initial = [w.minWidth, w.maxWidth, w.maxHeight, constants()];
    w.minWidth = 400;
    const raised = [w.minWidth, w.maxWidth, nw.contentMaxSize().width, w.width, constants()];
    w.minWidth = null;
    const restored = [w.minWidth, w.maxWidth, w.width, constants()];
    nw.setContentMinSize_({ width: 0, height: 70 });
    const viaNative = [w.minHeight, w.minWidth];
    w.maxWidth = 250;
    const otherAxisKept = [w.minHeight, nw.contentMinSize().height, w.maxWidth];
    w.maxHeight = 0;
    const zeroMax = [w.maxHeight, nw.contentMaxSize().height];
    w.close();
    emit({ step: "limits live", initial, raised, restored, viaNative, otherAxisKept, zeroMax });
  }

  // An NSWindow whose Window has been collected still answers in type: a
  // script holding it can close it again without an error.
  {
    const orphan: { gone: boolean; handle?: H } = { gone: false };
    const registry = new FinalizationRegistry(() => (orphan.gone = true));
    (() => {
      const w = new Window({ visible: false, shouldClose: () => false });
      orphan.handle = w.native as unknown as H;
      registry.register(w, 0);
      w.close();
    })();
    await waitFor(
      () => {
        Bun.gc(true);
        return orphan.gone;
      },
      "the closed window to be collected",
      5000,
    ).catch(() => {});
    let threw = false;
    let verdict: unknown;
    try {
      verdict = orphan.handle!.windowShouldClose_(orphan.handle);
      orphan.handle!.performClose_(null);
    } catch {
      threw = true;
    }
    emit({ step: "orphaned window", gone: orphan.gone, verdict, threw });
  }

  // Closed windows nobody references are collected, and their NSWindow with
  // them.
  const weak = objc.classes.NSHashTable.weakObjectsHashTable();
  let collected = 0;
  const registry = new FinalizationRegistry(() => collected++);
  (() => {
    for (let i = 0; i < 20; i++) {
      const w = new Window({ visible: false, title: `w${i}`, onClose() {}, onResize() {} });
      weak.addObject_(w.native);
      registry.register(w, i);
      w.close();
    }
  })();
  const made = weak.allObjects().count();
  const NSApp = objc.classes.NSApplication.sharedApplication();
  await waitFor(
    async () => {
      Bun.gc(true);
      // AppKit lets go of a closed window on a later pass of its run loop,
      // after the windows update that follows an event.
      await tick();
      NSApp.updateWindows();
      return collected === 20 && weak.allObjects().count() === 0;
    },
    "closed windows to be collected",
    5000,
  ).catch(() => {});
  // What still holds a window that should be gone: its counts and state, for the test's message.
  const retainCount = objc.fn("CFGetRetainCount", { returns: "l", args: ["@"] });
  const survivors = objc.js(weak.allObjects()) as H[];
  if (survivors.length > 0) {
    using listed = NSApp.windows();
    emit({
      step: "survivors",
      windows: survivors.map(w => ({
        title: w.title(),
        retainCount: retainCount(w),
        visible: w.isVisible(),
        number: w.windowNumber(),
        listed: listed.containsObject_(w),
        releasedWhenClosed: w.isReleasedWhenClosed(),
        contentView: w.contentView() !== null,
      })),
    });
  }
  emit({ step: "collected", made, collected, nativesLeft: weak.allObjects().count(), windows: app.windows.length });
});
