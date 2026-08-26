// Button, Checkbox, Radio and Switch are NSButtons built through the objc
// bridge: their getters read the control, their events are its
// target/action, and `.native` is the very object the class made.
import { app, Button, Checkbox, HStack, Switch, Text, TextEditor, View, VStack, Window } from "bun:appkit";
import { appKitInternals } from "bun:internal-for-testing";
import { objc } from "bun:objc";
import { emit, run, tick, waitFor } from "./_util";

await run(async () => {
  app.activationPolicy = "accessory";
  const { NSButton, NSSwitch, NSFont } = objc.classes;
  const uncaught: string[] = [];
  process.on("uncaughtException", e => uncaught.push(String((e as Error).message)));
  const attempt = (f: () => unknown) => {
    try {
      f();
      return null;
    } catch (e) {
      return {
        message: String((e as Error).message),
        code: (e as { code?: string }).code,
        isTypeError: e instanceof TypeError,
      };
    }
  };

  const button = new Button({ title: "Go" });
  const check = new Checkbox({ title: "c" });
  const toggle = new Switch();
  const win = new Window({ width: 300, height: 200, content: new VStack({ children: [button, check, toggle] }) });

  // `.native` is the object the class built, the same handle every time, and
  // the getters answer from it: a change made through the bridge shows.
  button.native.setTitle_("Native");
  button.native.setEnabled_(false);
  check.native.setState_(objc.enums.NSControlStateValueOn);
  emit({
    step: "live",
    same: button.native === button.native,
    isButton: button.native.isKindOfClass_(NSButton),
    isSwitch: toggle.native.isKindOfClass_(NSSwitch),
    title: button.title,
    enabled: button.enabled,
    checked: check.checked,
    hostedIn: `${button.native.superview().class()}`,
    defaults: {
      bezelStyle: new Button().bezelStyle,
      bordered: new Button().bordered,
      hasDestructiveAction: new Button().hasDestructiveAction,
      keyEquivalent: new Button().keyEquivalent,
      switchEnabled: toggle.enabled,
    },
  });
  button.enabled = true;

  // bezelStyle takes every NSBezelStyle member, short or full name or the
  // number, and reads back the current name for the value (deprecated
  // aliases map onto it; a value with no name reads as the number).
  const styles: Record<string, unknown> = {};
  for (const name of ["toolbar", "accessoryBarAction", "NSBezelStyleFlexiblePush", "texturedRounded", "badge"]) {
    button.bezelStyle = name as never;
    styles[name] = [button.bezelStyle, button.native.bezelStyle()];
  }
  button.bezelStyle = objc.enums.NSBezelStyle.circular;
  styles.number = button.bezelStyle;
  button.native.setBezelStyle_(3);
  styles.unnamed = button.bezelStyle;
  button.bezelStyle = button.bezelStyle;
  styles.unnamedRoundTrip = button.native.bezelStyle();
  (button as { bezelStyle: string | null }).bezelStyle = null;
  styles.reset = button.bezelStyle;
  emit({
    step: "bezelStyle",
    styles,
    bogus: attempt(() => (button.bezelStyle = "square" as never)),
    negative: attempt(() => (button.bezelStyle = -1)),
  });

  // The other readable props write through and read back from the button.
  button.keyEquivalent = "\r";
  button.bordered = false;
  button.hasDestructiveAction = true;
  const roles = {
    keyEquivalent: [button.keyEquivalent, `${button.native.keyEquivalent()}`],
    bordered: [button.bordered, button.native.isBordered()],
    hasDestructiveAction: [button.hasDestructiveAction, button.native.hasDestructiveAction()],
  };
  button.keyEquivalent = null;
  button.bordered = true;
  button.hasDestructiveAction = false;
  emit({ step: "roles", roles, after: [button.keyEquivalent, button.bordered, button.hasDestructiveAction] });

  // symbol, font and tint reach the button; they read back as given. The
  // image is placed by what the button has, so one set through `.native`
  // counts too.
  button.symbol = "star.fill";
  const imageOnlyWhenUntitled = ((button.title = ""), button.native.imagePosition());
  button.title = "Star";
  let nativeImagePlaced: unknown;
  {
    const other = new Button("plain");
    other.native.setImage_(button.native.image());
    other.title = "beside";
    nativeImagePlaced = other.native.imagePosition();
  }
  button.font = { size: 18, weight: "bold", design: "rounded" };
  button.tint = "red";
  emit({
    step: "kept",
    hasImage: button.native.image() !== null,
    imagePositions: [imageOnlyWhenUntitled, button.native.imagePosition(), nativeImagePlaced],
    pointSize: button.native.font().pointSize(),
    boldTrait: (button.native.font().fontDescriptor().symbolicTraits() & objc.enums.NSFontBoldTrait) !== 0,
    tinted: button.native.contentTintColor() !== null,
    reads: { symbol: button.symbol, font: button.font, tint: button.tint },
    cleared:
      ((button.symbol = null),
      (button.font = null),
      (button.tint = null),
      {
        image: button.native.image(),
        position: button.native.imagePosition(),
        pointSize: button.native.font().pointSize() === NSFont.systemFontSize(),
        tint: button.native.contentTintColor(),
      }),
    badSymbol: attempt(() => (button.symbol = "no.such.symbol.anywhere")),
    badFont: attempt(() => (button.font = { size: -2 } as never)),
    badTint: attempt(() => (button.tint = "rgb(nan,0,0)")),
    badTitle: attempt(() => ((button as { title: unknown }).title = 3)),
  });

  // Events are the control's target/action: a script object as target,
  // `action:` as the action, fired synchronously inside the click (NSControl's
  // performClick: keeps the button highlighted around the action); a throw is
  // reported and the click still returns.
  const log: string[] = [];
  button.onClick = () => log.push(`click:${button.native.isHighlighted()}`);
  check.onChange = on => log.push(`check:${on}`);
  toggle.onChange = on => log.push(`switch:${on}`);
  check.checked = false;
  button.click();
  log.push("after button.click()");
  check.click();
  toggle.click();
  button.onClick = () => {
    throw new Error("from onClick");
  };
  button.click();
  log.push("after throwing click");
  button.native.performClick_(null);
  await tick();
  emit({
    step: "events",
    log,
    uncaught: uncaught.splice(0),
    target: `${button.native.target().class()}`.startsWith("BunScriptObject"),
    action: button.native.action(),
    respondsToAction: button.native.target().respondsToSelector_("action:"),
    states: { check: check.checked, toggle: toggle.checked },
    notClickable: attempt(() => Button.prototype.click.call(new Text("t"))),
  });

  // `.native` is the one handle the view itself works through: the same one
  // every read, and releasing it ends the view's use of its NSButton too. The
  // third constructor argument is the module's: a subclass cannot hand View
  // an NSView.
  const savedNative = button.native;
  button.native.setTitle_("read");
  const ended = new Button({ title: "ended" });
  ended.native.release();
  class Mine extends (View as unknown as new (...args: unknown[]) => View) {
    constructor(...args: unknown[]) {
      super("Mine", undefined, ...args);
    }
  }
  emit({
    step: "native",
    same: savedNative === button.native,
    usable: button.title,
    released: attempt(() => ended.title),
    outsider: attempt(() => new Mine(objc.classes.NSView.new())),
    outsiderSymbol: attempt(() => new Mine(Symbol("built"))),
    unknownKind: attempt(() => new Mine()),
    // The view itself is not an argument; its handle is.
    asArgument: attempt(() => objc.classes.NSMutableArray.new().addObject_(button)),
    windowAsArgument: attempt(() => objc.classes.NSMutableArray.new().addObject_(win)),
  });

  // A control sits in containers and directly as window content, and
  // counts as a live view until it is collected.
  const solo = new Window({ width: 120, height: 60, content: new Button({ title: "solo" }) });
  const soloFrame = (solo.content as Button).frame;
  solo.close();
  const row = new HStack({ children: [new Button("a"), new Checkbox({ title: "b" }), new Switch()] });
  win.content = row;
  const laidOut = row.children.map(c => c.frame.width > 0 && c.frame.height > 0);
  win.content = null;

  // Views made and dropped by the steps above go first, so that the count
  // the forty are measured against holds only views something still refers to.
  let baseline = -1;
  await waitFor(
    () => {
      const last = baseline;
      Bun.gc(true);
      baseline = appKitInternals.liveViews();
      return baseline === last;
    },
    "the live view count to settle",
    3000,
  );
  const collected: string[] = [];
  const registry = new FinalizationRegistry<string>(what => collected.push(what));
  (() => {
    for (let i = 0; i < 40; i++) {
      // The handler closes over its own button, as handlers do.
      const b: Button = new Button({ title: `b${i}`, onClick: () => log.push(b.title) });
      if (i === 0) registry.register(b, "button with onClick");
    }
  })();
  const created = appKitInternals.liveViews() - baseline;
  let after = created;
  await waitFor(
    () => {
      Bun.gc(true);
      after = appKitInternals.liveViews() - baseline;
      return after === 0 && collected.length > 0;
    },
    "hosted buttons to be collected",
    3000,
  );
  // `solo` and `row` are read here so that they are not among the collected.
  emit({
    step: "hosting",
    soloFrame: soloFrame.width > 0,
    laidOut,
    pinned: [solo.closed, row.children.length],
    created,
    after,
    collected,
  });

  // A control (or any curated view) under a script-defined superview is
  // an NSView that superview holds: the View objects are let go by the
  // collector, their NSViews stay where they were put, and nothing of that
  // class runs inside the collection. Emptying the superview afterwards runs
  // the override once per view.
  const moves: string[] = [];
  const Watching = objc.defineClass({
    superclass: "NSView",
    methods: {
      "willRemoveSubview:": function (subview: { class(): unknown }) {
        moves.push(`${subview.class()}`);
      },
    },
  });
  const host = Watching.new();
  const heldBefore = appKitInternals.liveViews();
  let orphanClicks = 0;
  (() => {
    for (let i = 0; i < 20; i++)
      host.addSubview_(new Button({ title: `under ${i}`, onClick: () => orphanClicks++ }).native);
    host.addSubview_(new Text("t").native);
    // A natively built kind is no different.
    host.addSubview_(new TextEditor().native);
  })();
  const under = host.subviews().count();
  await waitFor(
    () => {
      Bun.gc(true);
      return appKitInternals.liveViews() <= heldBefore;
    },
    "views under a script-defined superview to be collected",
    3000,
  );
  await tick();
  const kept = host.subviews().count();
  // The NSButton is still there; the Button and its onClick are not.
  host.subviews().objectAtIndex_(0).performClick_(null);
  await tick();
  const movesBefore = moves.length;
  host.setSubviews_([]);
  emit({
    step: "script superview",
    under,
    kept,
    orphanClicks,
    movesBefore,
    left: host.subviews().count(),
    moves: moves.length,
    uncaught: uncaught.splice(0),
  });

  win.close();
});
