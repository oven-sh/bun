// objc.defineClass / objc.target: Objective-C classes whose methods are
// JavaScript functions, called by AppKit (a table asking its data source, a
// button firing its action) or through the bridge like any other method.
import { app, Window } from "bun:appkit";
import { objc } from "bun:objc";
import { emit, run, tick, waitFor } from "./_util";

type Thrown = { threw: false; value?: unknown } | { threw: true; isTypeError: boolean; code?: string; message: string };

function tryCall(f: () => unknown): Thrown {
  try {
    const value = f();
    return { threw: false, value: typeof value === "object" && value !== null ? String(value) : value };
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err?.code === "ERR_OBJC_UNAVAILABLE") throw err;
    return { threw: true, isTypeError: err instanceof TypeError, code: err?.code, message: String(err?.message) };
  }
}

function attempt(name: string, f: () => unknown) {
  emit({ step: name, ...tryCall(f) });
}

const uncaught: string[] = [];
process.on("uncaughtException", e => {
  uncaught.push(String((e as Error)?.message ?? e));
});

await run(async () => {
  app.activationPolicy = "accessory";
  const { NSObject, NSView, NSTableView, NSTableColumn, NSButton, NSMutableArray } = objc.classes;

  // A table data source: encodings come from the NSTableViewDataSource protocol.
  const calls: string[] = [];
  const rows = ["alpha", "beta", "gamma"];
  const DataSource = objc.defineClass({
    name: "FixtureDataSource",
    protocols: ["NSTableViewDataSource"],
    methods: {
      "numberOfRowsInTableView:"(table: any) {
        calls.push(`rows:${table.className()}`);
        return rows.length;
      },
      // Spelled the way sends are; the same selector as "tableView:objectValueForTableColumn:row:".
      tableView_objectValueForTableColumn_row_(_table: unknown, column: any, row: number) {
        calls.push(`value:${String(column.identifier())}:${row}`);
        return rows[row];
      },
    },
  });
  const ds = (DataSource as any).new();
  const table = NSTableView.alloc().initWithFrame_({ x: 0, y: 0, width: 200, height: 200 });
  const column = NSTableColumn.alloc().initWithIdentifier_("name");
  table.addTableColumn_(column);
  table.setDataSource_(ds);
  table.reloadData();
  const numberOfRows = table.numberOfRows();
  const direct = objc.js(ds.tableView_objectValueForTableColumn_row_(table, column, 2));
  emit({
    step: "data source",
    className: String(DataSource),
    sameClass: objc.classes.FixtureDataSource === DataSource,
    instanceClass: String(ds.className()),
    isKindOfNSObject: ds.isKindOfClass_(NSObject),
    numberOfRows,
    direct,
    askedRows: calls.some(c => c === "rows:NSTableView"),
    askedValue: calls.includes("value:name:2"),
    respondsRows: ds.respondsToSelector_("numberOfRowsInTableView:"),
    respondsValue: ds.respondsToSelector_("tableView:objectValueForTableColumn:row:"),
    respondsNope: ds.respondsToSelector_("tableView:nope:"),
    conforms: ds.conformsToProtocol_(objc.protocols.NSTableViewDataSource),
    conformsOther: ds.conformsToProtocol_(objc.protocols.NSTableViewDelegate),
    classConforms: (DataSource as any).conformsToProtocol_(objc.protocols.NSTableViewDataSource),
    instancesRespond: (DataSource as any).instancesRespondToSelector_("numberOfRowsInTableView:"),
    signature: String(ds.methodSignatureForSelector_("numberOfRowsInTableView:").methodReturnType?.() ?? ""),
    protocolsString: String(objc.protocols),
    sameProtocol: objc.protocols.NSTableViewDataSource === objc.protocols.NSTableViewDataSource,
  });

  // objc.target: an action receiver for a control.
  const senders: unknown[] = [];
  let thisInTarget: unknown;
  const target = objc.target(function (this: unknown, sender: unknown) {
    thisInTarget = this;
    senders.push(sender);
  });
  const win = new Window({ title: "define", width: 200, height: 100, visible: false });
  const button = NSButton.alloc().initWithFrame_({ x: 0, y: 0, width: 80, height: 24 });
  win.native.contentView().addSubview_(button);
  button.setTarget_(target);
  button.setAction_("action:");
  button.performClick_(null);
  (target as any).action_(null);
  // What the button holds weak reads back as the very handle that keeps it.
  const readBack = button.target() === target;
  button.performClick_(null);
  emit({
    step: "target",
    generatedClassName: /^BunScriptObject\d+$/.test(String((target as any).className())),
    stillTarget: readBack && objc.same(button.target(), target),
    clicks: senders.length,
    senderIsButton: objc.same(senders[0] as object, button),
    secondSender: senders[1],
    thisIsTarget: objc.same(thisInTarget as object, target),
    responds: (target as any).respondsToSelector_("action:"),
    buttonTarget: objc.same(button.target(), target),
  });

  // Subclassing a framework class: encodings read off the superclass.
  const Flipped = objc.defineClass({
    name: "FixtureFlippedView",
    superclass: "NSView",
    methods: {
      isFlipped: () => true,
      acceptsFirstResponder() {
        return true;
      },
      "viewDidMoveToSuperview"() {
        calls.push("moved");
      },
    },
  });
  const flipped = (Flipped as any).alloc().initWithFrame_({ x: 0, y: 0, width: 10, height: 10 });
  const plain = NSView.alloc().initWithFrame_({ x: 0, y: 0, width: 10, height: 10 });
  win.native.contentView().addSubview_(flipped);
  emit({
    step: "subclass",
    superclassName: String((Flipped as any).superclass()),
    flipped: flipped.isFlipped(),
    plainFlipped: plain.isFlipped(),
    accepts: flipped.acceptsFirstResponder(),
    plainAccepts: plain.acceptsFirstResponder(),
    moved: calls.includes("moved"),
    isKindOfNSView: flipped.isKindOfClass_(NSView),
    frameWidth: flipped.frame().size.width,
  });

  // A framework dealloc that messages an overridden method (NSView removing
  // its subviews) finds the receiver deallocating: JavaScript is not entered.
  const removals: string[] = [];
  const Parent = objc.defineClass({
    superclass: "NSView",
    methods: {
      willRemoveSubview_(subview: any) {
        removals.push(String(subview.className()));
      },
    },
  }) as any;
  let parent = Parent.alloc().initWithFrame_({ x: 0, y: 0, width: 10, height: 10 });
  const child = NSButton.alloc().initWithFrame_({ x: 0, y: 0, width: 5, height: 5 });
  parent.addSubview_(child);
  child.removeFromSuperview();
  const whileAlive = removals.slice();
  parent.addSubview_(child);
  parent.release();
  parent = undefined;
  Bun.gc(true);
  await new Promise(r => setImmediate(r));
  Bun.gc(true);
  emit({
    step: "dealloc",
    whileAlive,
    afterRelease: removals.slice(),
    childSuperview: child.superview(),
    childClass: String(child.className()),
  });

  // A subclass of a script class inherits and overrides its methods.
  const Base = objc.defineClass({
    methods: {
      greeting: { types: "@@:", fn: () => "base" },
      "twice:": { types: "q@:q", fn: (n: number) => n * 2 },
    },
  }) as any;
  const Derived = objc.defineClass({ superclass: Base, methods: { greeting: () => "derived" } }) as any;
  const derived = Derived.new();
  // A class that arrived as an `id` (here out of an array) is a superclass too.
  const classAsObject = NSMutableArray.arrayWithObject_(NSObject).objectAtIndex_(0);
  const FromObject = objc.defineClass({ superclass: classAsObject, methods: {} }) as any;
  emit({
    step: "inherit",
    fromObjectSuperclass: String(FromObject.superclass()),
    generatedNames: [String(Base), String(Derived)].every(n => /^BunScriptObject\d+$/.test(n)),
    base: objc.js(Base.new().greeting()),
    derived: objc.js(derived.greeting()),
    inheritedTwice: derived.twice_(21),
    derivedSuperclass: String(Derived.superclass()) === String(Base),
  });

  // A method given as a constant is a native method returning it: nothing
  // runs in JavaScript, so it answers on any thread too.
  {
    const Constants = objc.defineClass({
      name: "FixtureConstants",
      superclass: "NSView",
      methods: {
        isFlipped: true,
        isOpaque: { value: false },
        tag: -7,
        alphaValue: 0.25,
        menu: null,
        big: { types: "Q@:", value: 2n ** 64n - 1n },
        ratio: { types: "f@:", value: 1.5 },
        "level:": { types: "i@:@", value: 3 },
      },
    }) as any;
    const view = Constants.alloc().initWithFrame_({ x: 0, y: 0, width: 4, height: 4 });
    const Answers = objc.defineClass({
      name: "FixtureAnswers",
      methods: { level: { types: "q@:", value: 42 } },
    }) as any;
    const Asks = objc.defineClass({
      name: "FixtureAsks",
      methods: { level: { types: "q@:", fn: () => 1 } },
    }) as any;
    // KVC reads both on one background thread, the constant first; only the
    // function is refused there.
    const before = uncaught.length;
    const pair = NSMutableArray.new();
    pair.addObject_(Answers.new());
    pair.addObject_(Asks.new());
    pair.performSelectorInBackground_withObject_("valueForKey:", "level");
    await waitFor(() => uncaught.length > before, "the background read to be refused");
    emit({
      step: "constants",
      flipped: view.isFlipped(),
      opaque: view.isOpaque(),
      tag: view.tag(),
      alpha: view.alphaValue(),
      menu: view.menu(),
      big: String(view.big()),
      ratio: view.ratio(),
      level: view.level_(null),
      kvc: objc.js(view.valueForKey_("tag")),
      responds: Constants.instancesRespondToSelector_("big"),
      mainThread: objc.js(pair.valueForKey_("level")),
      uncaught: uncaught.splice(before),
      wrongBool: tryCall(() => objc.defineClass({ superclass: "NSView", methods: { isFlipped: 1 } })),
      wrongObject: tryCall(() => objc.defineClass({ superclass: "NSView", methods: { menu: true } })),
      wrongVoid: tryCall(() => objc.defineClass({ methods: { "poke:": { types: "v@:@", value: null } } })),
      wrongStruct: tryCall(() => objc.defineClass({ superclass: "NSView", methods: { frame: null } })),
      wrongRange: tryCall(() => objc.defineClass({ methods: { small: { types: "C@:", value: 300 } } })),
      wrongFraction: tryCall(() => objc.defineClass({ methods: { whole: { types: "q@:", value: 1.5 } } })),
      wrongKind: tryCall(() => objc.defineClass({ methods: { text: "yes" as never } })),
    });
  }

  // Return and argument conversions by encoding.
  const Types = objc.defineClass({
    name: "FixtureTypes",
    methods: {
      "rect:": {
        types: "{CGRect={CGPoint=dd}{CGSize=dd}}@:{CGRect={CGPoint=dd}{CGSize=dd}}",
        fn: (r: any) => ({ x: r.origin.x + 1, y: r.origin.y, width: r.size.width * 2, height: r.size.height }),
      },
      "add:to:": { types: "d@:dd", fn: (a: number, b: number) => a + b },
      "not:": { types: "B@:B", fn: (b: boolean) => !b },
      "sel:": { types: ":@::", fn: (s: string) => s + "extra:" },
      "cls": { types: "#@:", fn: () => objc.classes.NSString },
      "big:": { types: "Q@:Q", fn: (n: bigint) => n + 1n },
      "describe:": { types: "@@:@", fn: (o: any) => `got ${objc.js(o)}` },
      "list": { types: "@@:", fn: () => ["a", 1, true, null] },
      "nothing": { types: "@@:", fn: () => undefined },
      "keep:": {
        types: "@@:@",
        fn(this: any, o: unknown) {
          return o;
        },
      },
    },
  }) as any;
  const t = Types.new();
  const kept = NSMutableArray.new();
  emit({
    step: "types",
    rect: t.rect_({ x: 1, y: 2, width: 3, height: 4 }),
    add: t.add_to_(1.5, 2.25),
    not: [t.not_(true), t.not_(false)],
    sel: t.sel_("some:"),
    cls: t.cls() === objc.classes.NSString,
    big: String(t.big_(2n ** 60n)),
    describe: objc.js(t.describe_(42)),
    describeString: objc.js(t.describe_("s")),
    list: objc.js(t.list()),
    nothing: t.nothing(),
    keepSame: objc.same(t.keep_(kept), kept),
    keepNull: t.keep_(null),
  });

  // A throw inside a method is reported as an uncaught JavaScript error and
  // the sender reads zero / nil, whether the script's own send reached it or
  // AppKit did from the event loop (here a call handed over from another
  // thread): a delegate or target is a listener, not the caller's argument.
  const Throws = objc.defineClass({
    name: "FixtureThrows",
    methods: {
      boom: {
        types: "@@:",
        fn() {
          throw new Error("boom from js");
        },
      },
      boomLater: {
        types: "v@:",
        fn() {
          throw new Error("boom later");
        },
      },
      "count": {
        types: "q@:",
        fn: () => {
          throw new TypeError("count failed");
        },
      },
      "flag": { types: "B@:", fn: () => "not a boolean" },
      "rows": { types: "q@:", fn: () => 1.5 },
      "badSel": { types: ":@:", fn: () => "with\0nul:" },
      "badBlock": { types: "@?@:", fn: () => objc.ns("x") },
    },
  }) as any;
  const thrower = Throws.new();
  const boom = tryCall(() => thrower.boom());
  const count = tryCall(() => thrower.count());
  const flag = tryCall(() => thrower.flag());
  const badRows = tryCall(() => thrower.rows());
  const badSel = tryCall(() => thrower.badSel());
  const badBlock = tryCall(() => thrower.badBlock());
  await waitFor(() => uncaught.length >= 6, "six uncaught errors");
  const reported = uncaught.splice(0);
  thrower.performSelectorInBackground_withObject_("boomLater", null);
  await waitFor(() => uncaught.length >= 1, "the handed-over throw to be reported");
  emit({
    step: "throws",
    boom,
    count,
    flag,
    badRows,
    badSel,
    badBlock,
    direct: reported,
    uncaught: uncaught.splice(0),
  });

  // Each method is a real IMP of its own, not the forwarding trampoline:
  // forwardInvocation: is NSObject's (which raises for a selector nothing
  // implements), and the IMP differs from the one an undefined selector gets.
  {
    const forwardByHand = tryCall(() => {
      const { NSInvocation } = objc.classes;
      const invocation = NSInvocation.invocationWithMethodSignature_(ds.methodSignatureForSelector_("description"));
      invocation.setSelector_("neverDefined");
      return ds.forwardInvocation_(invocation);
    });
    const defined = DataSource.instanceMethodForSelector_("numberOfRowsInTableView:");
    const undefinedSelector = DataSource.instanceMethodForSelector_("neverDefined:");
    emit({
      step: "real imp",
      forwardByHand: { threw: forwardByHand.threw, code: forwardByHand.threw ? forwardByHand.code : undefined },
      distinct: defined !== undefinedSelector && typeof defined === "bigint",
    });
  }

  // Without `types`, a selector takes the encoding a listed protocol, the
  // superclass chain, or a protocol a class up that chain adopts declares;
  // one none of those declares is refused, naming the registered protocols
  // that do declare it. An explicit `types` must pass arguments the way the
  // declaration does.
  {
    const Conforming = objc.defineClass({ protocols: ["NSTableViewDataSource", "NSWindowDelegate"], methods: {} });
    const Untyped = objc.defineClass({
      superclass: Conforming,
      methods: {
        "numberOfRowsInTableView:": () => 7,
        "windowShouldClose:": () => false,
      },
    }) as any;
    const u = Untyped.new();
    const enc = (sel: string) =>
      String(u.methodSignatureForSelector_(sel).methodReturnType()) +
      String(u.methodSignatureForSelector_(sel).getArgumentTypeAtIndex_(2));
    emit({
      step: "untyped encodings",
      rows: enc("numberOfRowsInTableView:"),
      shouldClose: enc("windowShouldClose:"),
      rowsValue: NSTableView.alloc().initWithFrame_({ x: 0, y: 0, width: 10, height: 10 }).numberOfRows(),
    });
    // `B` spells BOOL on both architectures, whatever the runtime's own spelling there.
    attempt("typed bool", () =>
      objc.defineClass({
        protocols: ["NSWindowDelegate"],
        methods: { "windowShouldClose:": { types: "B@:@", fn: () => true } },
      }),
    );
    // A `c` a script writes is a char on both architectures (the runtime's own `c` is BOOL on x86_64).
    attempt("typed char", () => {
      const Chars = objc.defineClass({
        methods: {
          aChar: { types: "c@:", fn: () => 65 },
          "twice:": { types: "c@:c", fn: (c: number) => c * 2 },
          aBool: { types: "B@:", fn: () => true },
        },
      }) as any;
      const instance = Chars.new();
      return [instance.aChar(), instance.twice_(-20), instance.aBool(), instance.msgSend("aChar")];
    });
    attempt("untyped suggested", () => objc.defineClass({ methods: { "numberOfRowsInTableView:": () => 7 } }));
    attempt("untyped conflict", () => objc.defineClass({ methods: { state: () => 1 } }));
    attempt("untyped own", () => objc.defineClass({ methods: { "somethingOfMyOwn:": (x: unknown) => x } }));
    attempt("untyped class method", () => objc.defineClass({ methods: {}, classMethods: { ofMyOwn: () => 1 } }));
    // A protocol outside those frameworks is suggested the same way when it
    // is the only one registered that declares the selector.
    attempt("untyped elsewhere", () =>
      objc.defineClass({ methods: { "locationManager:didChangeAuthorizationStatus:": () => {} } }),
    );
    // `drawRect:` takes a CGRect by value: an encoding that says otherwise
    // would have the function read garbage, so it is refused; one that passes
    // arguments the same way (an object for a block) stands.
    attempt("types mismatch", () =>
      objc.defineClass({ superclass: "NSView", methods: { "drawRect:": { types: "v@:@", fn() {} } } }),
    );
    attempt("types mismatch protocol", () =>
      objc.defineClass({
        protocols: ["NSTableViewDataSource"],
        methods: { "numberOfRowsInTableView:": { types: "@@:@", fn: () => null } },
      }),
    );
    attempt("types same shape", () =>
      String(
        objc
          .defineClass({
            superclass: "NSView",
            methods: { "sortSubviewsUsingFunction:context:": { types: "v@:@@", fn() {} } },
          })
          .instanceMethodSignatureForSelector_("sortSubviewsUsingFunction:context:")
          .getArgumentTypeAtIndex_(2),
      ),
    );
  }

  // What defineClass refuses.
  attempt("name taken", () => objc.defineClass({ name: "NSObject", methods: {} }));
  attempt("name taken twice", () => objc.defineClass({ name: "FixtureTypes", methods: {} }));
  attempt("bad name", () => objc.defineClass({ name: "has space", methods: {} }));
  attempt("no protocol", () => objc.defineClass({ protocols: ["NSDefinitelyNotAProtocol"], methods: {} }));
  attempt("protocol lookup", () => objc.protocols.NSDefinitelyNotAProtocol);
  attempt("bad superclass", () => objc.defineClass({ superclass: "NSDefinitelyNotAClass", methods: {} }));
  attempt("bad types", () => objc.defineClass({ methods: { "x:": { types: "v@:{{{", fn() {} } } }));
  attempt("types arity", () => objc.defineClass({ methods: { "x:": { types: "v@:", fn() {} } } }));
  attempt("types no self", () => objc.defineClass({ methods: { x: { types: "v", fn() {} } } }));
  attempt("types bad self", () => objc.defineClass({ methods: { "x:": { types: "vq:@", fn() {} } } }));
  attempt("fn arity", () => objc.defineClass({ methods: { "x:": (_a: unknown, _b: unknown) => 0 } }));
  attempt("prefixed key", () => objc.defineClass({ methods: { "-isFlipped": true } }));
  attempt("prefixed class key", () => objc.defineClass({ methods: {}, classMethods: { "+version": 3 } }));
  attempt("alloc refused", () => objc.defineClass({ methods: {}, classMethods: { alloc: () => null } }));

  // super, init overrides and class methods: an NSView subclass whose
  // drawRect: and isFlipped call up, whose initWithFrame: hands the
  // allocated object to NSView's and sets the result up, and whose class
  // object answers methods of its own (one overriding NSView's, with super).
  {
    const log: string[] = [];
    const Drawn = objc.defineClass({
      name: "FixtureDrawn",
      superclass: "NSView",
      methods: {
        isFlipped() {
          log.push(`super isFlipped ${this.super.isFlipped()}`);
          return true;
        },
        drawRect_(dirty: { size: { width: number } }) {
          this.super.drawRect_(dirty);
          log.push(`drawRect ${dirty.size.width} ${String(this.className())}`);
        },
        initWithFrame_(frame: unknown) {
          const self = this.super.initWithFrame_(frame);
          log.push(`init consumed=${tryCall(() => this.frame()).threw} same=${self === this}`);
          self.setToolTip_("from init");
          return self;
        },
        "initWithNothing:": { types: "@@:@", fn: (_arg: unknown) => null },
      },
      classMethods: {
        requiresConstraintBasedLayout() {
          log.push(`super requires ${this.super.requiresConstraintBasedLayout()}`);
          return true;
        },
        "makeWithSide:": {
          types: "@@:d",
          fn(side: number) {
            return this.alloc().initWithFrame_({ x: 0, y: 0, width: side, height: side });
          },
        },
        version: 7,
      },
    }) as any;
    const view = Drawn.makeWithSide_(12);
    const rep = view.bitmapImageRepForCachingDisplayInRect_(view.bounds());
    view.cacheDisplayInRect_toBitmapImageRep_(view.bounds(), rep);
    const Sub = objc.defineClass({
      name: "FixtureDrawnSub",
      superclass: Drawn,
      methods: {
        isFlipped() {
          // super here is FixtureDrawn's isFlipped (which itself calls NSView's).
          return !this.super.isFlipped();
        },
      },
      classMethods: {
        version() {
          return this.super.version() + 1;
        },
      },
    }) as any;
    const sub = Sub.alloc().initWithFrame_({ x: 0, y: 0, width: 3, height: 3 });
    // A convenience initializer hands `this` on to another of the class's
    // own; that one (inherited here) hands it up.
    const Square = objc.defineClass({
      name: "FixtureSquare",
      superclass: Drawn,
      methods: {
        init() {
          return this.initWithFrame_({ x: 0, y: 0, width: 5, height: 5 });
        },
        "initWithSide:": {
          types: "@@:d",
          fn(side: number) {
            const self = this.msgSend("initWithFrame:", { x: 0, y: 0, width: side, height: side });
            log.push(`initWithSide consumed=${tryCall(() => this.frame()).threw}`);
            return self;
          },
        },
      },
    }) as any;
    const square = Square.alloc().init();
    const made = Square.new();
    const sided = Square.alloc().initWithSide_(9);
    emit({
      step: "super",
      className: String(view.className()),
      toolTip: String(view.toolTip()),
      width: view.frame().size.width,
      flipped: view.isFlipped(),
      requires: Drawn.requiresConstraintBasedLayout(),
      plainRequires: NSView.requiresConstraintBasedLayout(),
      version: Drawn.version(),
      responds: Drawn.respondsToSelector_("makeWithSide:"),
      instancesDoNot: Drawn.instancesRespondToSelector_("makeWithSide:"),
      initNil: Drawn.alloc().initWithNothing_(null),
      subFlipped: sub.isFlipped(),
      subToolTip: String(sub.toolTip()),
      subVersion: Sub.version(),
      // An inherited class method whose body sends super starts above the
      // defining class, not above the receiver.
      subRequires: Sub.requiresConstraintBasedLayout(),
      squareWidth: square.frame().size.width,
      squareToolTip: String(square.toolTip()),
      madeWidth: made.frame().size.width,
      sidedWidth: sided.frame().size.width,
      // Outside its own init… an initialized object takes no init…, by itself or through super.
      initAgain: tryCall(() => square.init()),
      superInitAgain: tryCall(() => (objc as any).super(square, Square).init()),
      outside: tryCall(() => (objc as any).super(view).isFlipped()),
      explicit: (objc as any).super(view, Drawn).isFlipped(),
      explicitSub: (objc as any).super(sub, Sub).isFlipped(),
      // The receiver must be of the class named: NSControl's methods are not run on an NSView.
      unrelated: tryCall(() => (objc as any).super(view, objc.classes.NSTextField).isFlipped()),
      unrelatedClass: tryCall(() => (objc as any).super(NSView, Drawn).version()),
      downTheChain: (objc as any).super(Sub, Drawn).requiresConstraintBasedLayout(),
      // AppKit asks isFlipped as often as it likes.
      log: [...new Set(log)].sort(),
    });
  }
  // `this.super` is resolved when it is read, to the class whose method is
  // running, and stays bound to it: kept across an await, called from a
  // timer, or captured in one class's method and run while a subclass's
  // method is on the stack, it still sends to that class's superclass. Read
  // where no method of the object is running it has no class to bind to.
  {
    const Base = objc.defineClass({
      name: "FixtureSuperBase",
      methods: {
        description: { types: "@@:", fn: (): string => "base" },
        "deferred": {
          types: "@@:",
          fn(this: any) {
            const sup = this.super;
            return objc.block(() => String(sup.description()), "@@?");
          },
        },
        "later": {
          types: "v@:",
          fn(this: any) {
            const sup = this.super;
            const readNow = String(this.super.description());
            (async () => {
              await 0;
              deferred.afterAwait = String(sup.description());
              deferred.readAfterAwait = tryCall(() => this.super.description());
              setTimeout(() => {
                deferred.inTimer = String(sup.description());
                deferred.done = true;
              }, 0);
            })();
            deferred.readNow = readNow;
          },
        },
      },
    }) as any;
    const Derived = objc.defineClass({
      name: "FixtureSuperDerived",
      superclass: Base,
      methods: {
        description: { types: "@@:", fn: (): string => "derived" },
        "runDeferred": {
          types: "@@:",
          fn(this: any) {
            return this.deferred().invoke();
          },
        },
      },
    }) as any;
    const deferred: Record<string, unknown> = { done: false };
    const instance = Derived.new();
    const nsObjectDescription = (text: string) => text.startsWith("<FixtureSuperDerived: ");
    instance.later();
    await waitFor(() => deferred.done === true, "the deferred super sends to run");
    emit({
      step: "super bound on read",
      // Base's method captured its super (NSObject's description), and it stays that under Derived's frame.
      underDerived: nsObjectDescription(String(instance.runDeferred())),
      readNow: nsObjectDescription(deferred.readNow as string),
      afterAwait: nsObjectDescription(deferred.afterAwait as string),
      inTimer: nsObjectDescription(deferred.inTimer as string),
      readAfterAwait: deferred.readAfterAwait,
      sameProxy: (() => {
        let first: unknown;
        let second: unknown;
        const Twice = objc.defineClass({
          name: "FixtureSuperTwice",
          methods: {
            "read": {
              types: "v@:",
              fn(this: any) {
                first = this.super;
                second = this.super;
              },
            },
          },
        }) as any;
        Twice.new().read();
        return first === second;
      })(),
    });
  }
  // An init… that answers with a substitute (a class cluster's shape): the
  // caller gets the substitute, the same handle as any made for it before,
  // and the allocated object the init was given deallocates.
  {
    const { NSHashTable } = objc.classes;
    const discarded = NSHashTable.weakObjectsHashTable();
    let substituted = 0;
    const Substituting = objc.defineClass({
      name: "FixtureSubstituting",
      methods: {
        init() {
          discarded.addObject_(this);
          substituted++;
          return NSObject.new();
        },
        initPlain: {
          types: "@@:",
          fn(this: any) {
            return this.super.init();
          },
        },
        "initLike:": {
          types: "@@:@",
          fn(this: any, other: unknown) {
            discarded.addObject_(this);
            substituted++;
            return other;
          },
        },
      },
    }) as any;
    // What the inits returned, held weakly once the handles are dropped: an
    // object that went through `this.super.init()` (its first wrapper
    // consumed by that call, its keeper let go) deallocates like any other.
    const made = NSHashTable.weakObjectsHashTable();
    const outcome = (() => {
      const keeper = Substituting.alloc().initPlain();
      const plain = Substituting.alloc().init();
      const like = Substituting.alloc().initLike_(keeper);
      const madeWithNew = Substituting.new();
      for (const o of [keeper, plain, madeWithNew]) made.addObject_(o);
      return {
        plainClass: String(plain.className()),
        plainCanonical: plain === plain.self() && objc.same(plain, plain.self()),
        likeIsKeeper: like === keeper,
        keeperClass: String(keeper.className()),
        newClass: String(madeWithNew.className()),
      };
    })();
    await waitFor(
      () => {
        Bun.gc(true);
        return discarded.anyObject() === null && made.anyObject() === null;
      },
      "the allocated objects an init substituted for, and the objects made, to deallocate",
      30_000,
    );
    emit({ step: "init substitute", ...outcome, substituted, deallocated: true });
  }

  // An init… reached on another thread than the defining one answers nil
  // and lets the object go, as the function returning null would: an
  // init's caller hands it a reference (alloc's), and the frame owns it.
  // Here the caller is NSThread, given a reference taken outside the
  // bridge to hand over; without that release it would never deallocate.
  {
    const { NSHashTable } = objc.classes;
    const { dlopen, FFIType } = await import("bun:ffi");
    const libobjc = dlopen("/usr/lib/libobjc.A.dylib", {
      objc_retain: { args: [FFIType.ptr], returns: FFIType.ptr },
    });
    const Elsewhere = objc.defineClass({
      name: "FixtureInitElsewhere",
      methods: {
        init() {
          return this.super.init();
        },
      },
    }) as any;
    const alive = NSHashTable.weakObjectsHashTable();
    const before = uncaught.length;
    (() => {
      const instance = Elsewhere.new();
      alive.addObject_(instance);
      libobjc.symbols.objc_retain(Number(instance[objc.pointer]));
      instance.performSelectorInBackground_withObject_("init", null);
    })();
    await waitFor(() => uncaught.length > before, "the background init to be refused");
    libobjc.close();
    await waitFor(
      () => {
        Bun.gc(true);
        return alive.anyObject() === null;
      },
      "the object whose init was refused to deallocate",
      30_000,
    );
    emit({ step: "init elsewhere", uncaught: uncaught.splice(before), deallocated: true });
  }
  // Ownership the headers state beyond the selector's name: a method that
  // takes over an argument's reference (NS_RELEASES_ARGUMENT), its
  // receiver's (NS_REPLACES_RECEIVER) or returns a retained result
  // (NS_RETURNS_RETAINED) hands references the same way whether the bridge
  // is the caller or the callee, so nothing leaks and nothing is released
  // twice.
  {
    const { NSHashTable, NSKeyedArchiver, NSKeyedUnarchiver, NSArray, NSDictionary, NSString, NSSet } = objc.classes;
    const consumed = NSHashTable.weakObjectsHashTable();
    const substitutes = NSHashTable.weakObjectsHashTable();
    const seen: string[] = [];
    // The unarchiver hands every decoded container to the delegate, which
    // here replaces each array with a plain object.
    const Delegate = objc.defineClass({
      name: "FixtureUnarchiverDelegate",
      protocols: ["NSKeyedUnarchiverDelegate"],
      methods: {
        "unarchiver:didDecodeObject:"(_unarchiver: unknown, object: any) {
          if (object === null || !object.isKindOfClass_(NSArray)) return object;
          seen.push("array");
          consumed.addObject_(object);
          const substitute = NSObject.new();
          substitutes.addObject_(substitute);
          return substitute;
        },
      },
    }) as any;
    const Awakening = objc.defineClass({
      name: "FixtureAwakening",
      methods: {
        "awakeAfterUsingCoder:"(this: any, _coder: unknown) {
          seen.push("awake");
          return this;
        },
      },
    }) as any;
    // Strings long enough not to be tagged pointers, which never deallocate.
    const text = "a string the archive carries, long enough to live on the heap";
    const data = NSKeyedArchiver.archivedDataWithRootObject_requiringSecureCoding_error_(
      NSDictionary.dictionaryWithObject_forKey_(objc.ns([text, `${text} 2`]), "k"),
      true,
      objc.out(),
    );
    const decoded = (() => {
      const unarchiver = NSKeyedUnarchiver.alloc().initForReadingFromData_error_(data, objc.out());
      const delegate = Delegate.new();
      unarchiver.setDelegate_(delegate);
      const root = unarchiver.decodeObjectOfClasses_forKey_(
        NSSet.setWithArray_(objc.ns([NSDictionary, NSArray, NSString])),
        "root",
      );
      unarchiver.finishDecoding();
      const value = root.objectForKey_("k");
      return {
        rootIsDictionary: root.isKindOfClass_(NSDictionary),
        valueClass: String(value.className()),
        substituted: substitutes.containsObject_(value),
      };
    })();
    // The bridge as the caller: the argument it hands over stays its own
    // handle's, and the retained result is taken as one.
    const direct = (() => {
      const delegate = Delegate.new();
      const given = objc.ns([`${text} 3`]) as any;
      consumed.addObject_(given);
      const substitute = delegate.unarchiver_didDecodeObject_(null, given);
      Bun.gc(true);
      return {
        givenUsable: Number(given.count()),
        substituteClass: String(substitute.className()),
        tracked: substitutes.containsObject_(substitute),
      };
    })();
    const awake = (() => {
      const instance = Awakening.new();
      consumed.addObject_(instance);
      const plain = NSObject.new();
      consumed.addObject_(plain);
      return {
        same: instance.awakeAfterUsingCoder_(null) === instance,
        plainSame: plain.awakeAfterUsingCoder_(null) === plain,
        usable: String(instance.className()),
      };
    })();
    await waitFor(
      () => {
        Bun.gc(true);
        return consumed.anyObject() === null && substitutes.anyObject() === null;
      },
      "the objects handed over and the substitutes to deallocate",
      30_000,
    );
    emit({
      step: "ownership",
      decoded,
      direct,
      awake,
      seen: [...new Set(seen)].sort(),
      deallocated: true,
    });
  }
  attempt("required missing", () => objc.defineClass({ protocols: ["NSCopying"], methods: {} }));
  attempt("required inherited", () =>
    String((objc.defineClass({ superclass: "NSCell", protocols: ["NSCopying"], methods: {} }) as any).superclass()),
  );
  attempt("required defined", () =>
    String(
      (
        objc.defineClass({ protocols: ["NSCopying"], methods: { copyWithZone_: (_zone: unknown) => null } }) as any
      ).superclass(),
    ),
  );
  // A block parameter arrives as a handle the method can call; a block
  // return takes a block handle.
  {
    const received: unknown[] = [];
    const WithBlocks = objc.defineClass({
      methods: {
        "run:with:": {
          types: "q@:@?q",
          fn(block: any, n: bigint | number) {
            received.push(typeof block.invoke, block.invoke(Number(n)), block.invoke(2));
            return block.invoke(10);
          },
        },
        "twiceOf:": { types: "@?@:@?", fn: (block: unknown) => block },
      },
    }) as any;
    const w = WithBlocks.new();
    const square = objc.block((x: unknown) => Number(objc.js(x)) * Number(objc.js(x)), "q@?@") as any;
    const result = w.run_with_(square, 7);
    const back = w.twiceOf_(square);
    emit({
      step: "block param",
      received,
      result,
      same: back === square,
      direct: square.invoke(9),
      // Two acquisitions (objc.block's and twiceOf's result), two releases.
      released: (square.release(), back.release(), tryCall(() => square.invoke(1)).threw),
    });
  }
  // A block argument is only lent for the call, and a capturing block a
  // caller passes lives on its stack; the handle a method keeps is to a heap
  // copy, so it still works once that frame is gone. The stack block here is
  // laid out by hand and wiped after the send, as a returning frame would.
  {
    let kept: any = null;
    const Keeper = objc.defineClass({
      methods: { "keep:": { types: "v@:@?", fn: (block: unknown) => void (kept = block) } },
    }) as any;
    const keeper = Keeper.new();
    const { dlopen, JSCallback, ptr } = await import("bun:ffi");
    const libobjc = dlopen("/usr/lib/libobjc.A.dylib", {
      sel_registerName: { args: ["cstring"], returns: "ptr" },
      objc_msgSend: { args: ["ptr", "ptr", "ptr"], returns: "void" },
    });
    let invoked = 0;
    const invoke = new JSCallback(() => void invoked++, { args: ["ptr"], returns: "void" });
    try {
      const signature = Buffer.from("v@?\0");
      // struct Block_descriptor { reserved; size; signature; layout } (no copy/dispose helpers).
      const descriptor = new BigUint64Array([0n, 32n, BigInt(ptr(signature)), 0n]);
      // struct Block_literal { isa; flags (BLOCK_HAS_SIGNATURE); invoke; descriptor }.
      const literal = new BigUint64Array([
        objc.classes.__NSStackBlock__[objc.pointer] as bigint,
        1n << 30n,
        BigInt(invoke.ptr!),
        BigInt(ptr(descriptor)),
      ]);
      libobjc.symbols.objc_msgSend(
        keeper[objc.pointer],
        libobjc.symbols.sel_registerName(Buffer.from("keep:\0")),
        ptr(literal),
      );
      literal.fill(0n);
      await new Promise<void>(resolve => setImmediate(resolve));
      kept.invoke();
      kept.invoke();
      const description = objc.js(kept.description()) as string;
      kept.release();
      emit({
        step: "block kept",
        heap: description.startsWith("<__NSMallocBlock__"),
        invoked,
        released: tryCall(() => String(kept)).threw,
      });
    } finally {
      invoke.close();
      libobjc.close();
    }
  }
  attempt("block return fn", () =>
    (objc.defineClass({ methods: { x: { types: "@?@:", fn: () => () => {} } } }) as any).new().x(),
  );
  attempt("reserved", () => objc.defineClass({ methods: { dealloc() {} } }));
  attempt("not a function", () => objc.defineClass({ methods: { x: "three" as any } }));
  attempt("no methods", () => (objc as any).defineClass({}));
  attempt("target not a function", () => (objc as any).target("nope"));
  // A refused definition leaves the name free.
  attempt("name reusable", () =>
    String(objc.defineClass({ name: "FixtureRetry", methods: { "x:": { types: "v@:{{{", fn() {} } } })),
  );
  attempt("name reused", () => String(objc.defineClass({ name: "FixtureRetry", methods: {} })));

  // An `inout` object pointer (`N^@`, KVC validation) arrives holding the
  // caller's object and stores what the method leaves.
  {
    const Validating = objc.defineClass({
      methods: {
        "validateValue:forKey:error:"(io: { value: any }, key: unknown) {
          const incoming = String(io.value);
          io.value = `${incoming}+${String(key)}`;
          return incoming.length > 0;
        },
      },
    }) as any;
    const v = Validating.new();
    const io = objc.out(objc.ns("in"));
    const ok = v.validateValue_forKey_error_(io, "k", null);
    emit({
      step: "inout",
      ok,
      out: String(io.value),
      types: String(v.methodSignatureForSelector_("validateValue:forKey:error:").getArgumentTypeAtIndex_(2)),
    });
  }

  // Identity: an instance of a defined class keeps its one handle for as
  // long as native code holds the object, so per-instance state kept in a
  // WeakMap keyed by `this` survives the script dropping every reference;
  // once nothing native holds it either, handle and state go.
  {
    const states = new WeakMap<object, { count: number }>();
    const handles = new FinalizationRegistry<string>(tag => collectedHandles.push(tag));
    const collectedHandles: string[] = [];
    const Counter = objc.defineClass({
      superclass: "NSObject",
      methods: {
        poke: {
          types: "q@:",
          fn(this: object) {
            let state = states.get(this);
            if (!state) states.set(this, (state = { count: 0 }));
            return ++state.count;
          },
        },
      },
    }) as any;
    const holder = NSMutableArray.new();
    await (async () => {
      const counter = Counter.new();
      handles.register(counter, "held");
      holder.addObject_(counter);
      counter.poke();
      counter.poke();
    })();
    for (let i = 0; i < 5; i++) {
      Bun.gc(true);
      await tick();
    }
    const third = Number(holder.objectAtIndex_(0).poke());
    holder.makeObjectsPerformSelector_("poke");
    const afterNative = Number(holder.objectAtIndex_(0).poke());
    const collectedWhileHeld = collectedHandles.slice();
    // A released handle is this script's word that it is done: the state may go then.
    await (async () => {
      const released = Counter.new();
      handles.register(released, "released");
      holder.addObject_(released);
      released.release();
    })();
    holder.removeAllObjects();
    await waitFor(
      () => {
        Bun.gc(true);
        return collectedHandles.includes("held") && collectedHandles.includes("released");
      },
      "the dropped instances' handles to be collected",
      30_000,
    );
    emit({ step: "identity", third, afterNative, collectedWhileHeld, collectedAfter: collectedHandles.sort() });
  }

  // Lifetime: the handle keeps the function while the script can reach the
  // handle, and the two go together once it cannot; a function that closes
  // over whatever holds the handle is a cycle like any other.
  let collectedFn = false;
  const registry = new FinalizationRegistry(() => {
    collectedFn = true;
  });
  let firedAfterGc = 0;
  const aliveWhileHeld = await (async () => {
    const owner: { target?: unknown } = {};
    const fn = () => (owner.target ? firedAfterGc++ : 0);
    registry.register(fn, "fn");
    const keeper = objc.target(fn) as any;
    owner.target = keeper;
    Bun.gc(true);
    await new Promise(r => setImmediate(r));
    Bun.gc(true);
    keeper.action_(null);
    return !collectedFn && firedAfterGc === 1;
  })();
  await waitFor(
    () => {
      Bun.gc(true);
      return collectedFn;
    },
    "the dropped target's function to be collected",
    30_000,
  );
  emit({ step: "lifetime", aliveWhileHeld, collectedAfterDrop: collectedFn });

  // While native code retains the target (a timer here), the function stays
  // although the script dropped the handle; invalidating the timer lets it go.
  {
    const { NSTimer, NSRunLoop } = objc.classes;
    let fired = 0;
    let collected = false;
    const gone = new FinalizationRegistry(() => {
      collected = true;
    });
    const timer = (() => {
      const fn = () => fired++;
      gone.register(fn, "fn");
      return NSTimer.timerWithTimeInterval_target_selector_userInfo_repeats_(
        60,
        objc.target(fn),
        "action:",
        null,
        true,
      );
    })();
    NSRunLoop.mainRunLoop().addTimer_forMode_(timer, objc.constants.NSDefaultRunLoopMode);
    for (let i = 0; i < 5; i++) {
      Bun.gc(true);
      await new Promise(r => setImmediate(r));
    }
    timer.fire();
    const whileScheduled = { collected, fired };
    timer.invalidate();
    await waitFor(
      () => {
        Bun.gc(true);
        return collected;
      },
      "the invalidated timer's target function to be collected",
      30_000,
    );
    emit({ step: "lifetime retained", whileScheduled, collectedAfterInvalidate: collected });
  }

  // A function that keeps reachable the handle of the object that natively
  // retains its target is a cycle through both heaps that neither collector
  // sees whole: it stays until the native side lets go (here, the array is
  // emptied through a WeakRef kept for that).
  {
    const { NSMutableArray } = objc.classes;
    let collected = false;
    const gone = new FinalizationRegistry(() => {
      collected = true;
    });
    const weak = (() => {
      const arr = NSMutableArray.new();
      const fn = () => arr.count();
      gone.register(fn, "fn");
      arr.addObject_(objc.target(fn));
      return new WeakRef(arr);
    })();
    for (let i = 0; i < 5; i++) {
      Bun.gc(true);
      await new Promise(r => setImmediate(r));
    }
    const heldByCycle = !collected && weak.deref() !== undefined;
    weak.deref()?.removeAllObjects();
    await waitFor(
      () => {
        Bun.gc(true);
        return collected;
      },
      "the function of a target whose array was emptied to be collected",
      30_000,
    );
    emit({ step: "lifetime cycle", heldByCycle, collectedAfterClear: collected });
  }

  // Held longest by an array another thread empties: the instance's
  // functions are still let go (on this one).
  {
    let collected = false;
    const gone = new FinalizationRegistry(() => {
      collected = true;
    });
    const holder = NSMutableArray.new();
    (() => {
      const fn = () => {};
      gone.register(fn, "fn");
      const held = objc.target(fn) as any;
      holder.addObject_(held);
      held.release();
    })();
    holder.performSelectorInBackground_withObject_("removeAllObjects", null);
    await waitFor(() => holder.count() === 0, "the background thread to empty the array");
    await waitFor(
      () => {
        Bun.gc(true);
        return collected;
      },
      "the function of a target deallocated on another thread to be collected",
      30_000,
    );
    emit({ step: "lifetime off thread", collected });
  }

  // NSXMLParser.delegate is one of the few properties still declared
  // `assign` rather than weak: the bridge has the parser hold what is set on
  // it, so a delegate whose handle is gone still answers instead of leaving
  // the parser a dangling pointer, and setting nil lets it go.
  {
    const { NSXMLParser, NSString, NSHashTable } = objc.classes;
    let elements = 0;
    const ParserDelegate = objc.defineClass({
      protocols: ["NSXMLParserDelegate"],
      methods: {
        "parser:didStartElement:namespaceURI:qualifiedName:attributes:": () => {
          elements++;
        },
      },
    });
    const xml = NSString.stringWithString_("<a><b/><b/></a>").dataUsingEncoding_(4);
    const parser = NSXMLParser.alloc().initWithData_(xml);
    const alive = NSHashTable.weakObjectsHashTable();
    (() => {
      const delegate = ParserDelegate.new();
      alive.addObject_(delegate);
      parser.setDelegate_(delegate);
      delegate.release();
    })();
    Bun.gc(true);
    await new Promise(r => setImmediate(r));
    Bun.gc(true);
    const heldWhileSet = alive.allObjects().count();
    const parsed = parser.parse();
    const sameObject = parser.delegate() === alive.anyObject();
    parser.setDelegate_(null);
    // Polled through anyObject(): allObjects() would copy the delegate into a
    // strong array each turn, and that array's wrapper, garbage by the next
    // collection but not yet swept, still holds the delegate while the
    // collector asks its keeper whether native code does.
    await waitFor(
      () => {
        Bun.gc(true);
        return alive.anyObject() === null;
      },
      "the cleared delegate to deallocate",
      30_000,
    );
    emit({ step: "assign delegate", heldWhileSet, parsed, elements, sameObject, goneAfterNil: true });
    // A second parser given the same kind of delegate and then released
    // itself takes the delegate with it.
    const other = NSXMLParser.alloc().initWithData_(xml);
    (() => {
      const delegate = ParserDelegate.new();
      alive.addObject_(delegate);
      other.setDelegate_(delegate);
      delegate.release();
    })();
    other.release();
    await waitFor(
      () => {
        Bun.gc(true);
        return alive.anyObject() === null;
      },
      "the released parser's delegate to deallocate",
      30_000,
    );
    emit({ step: "assign delegate owner released", gone: true });
  }

  // A property typed as a concrete class and declared assign (NSMenuItem.menu,
  // NSResponder.nextResponder) points back at an owner: the bridge leaves
  // those setters alone, so the receiver is not made to hold its owner. The
  // parser above is the other case: it holds its delegate under the setter's
  // selector.
  {
    const { NSMenu, NSMenuItem, NSView, NSXMLParser, NSObject } = objc.classes;
    const associated = objc.fn("objc_getAssociatedObject", { returns: "@", args: ["@", ":"] });
    const menu = NSMenu.new();
    const item = NSMenuItem.new();
    item.setMenu_(menu);
    const responder = NSView.new();
    const child = NSView.new();
    child.setNextResponder_(responder);
    const parser = NSXMLParser.new();
    const delegate = NSObject.new();
    parser.setDelegate_(delegate);
    emit({
      step: "assign back pointer",
      menuHeld: associated(item, "setMenu:") !== null,
      responderHeld: associated(child, "setNextResponder:") !== null,
      delegateHeld: associated(parser, "setDelegate:") === delegate,
    });
    item.setMenu_(null);
    child.setNextResponder_(null);
    parser.setDelegate_(null);
  }

  // A holder registered through a method (NSUndoManager's undo target)
  // keeps a plain pointer the bridge knows nothing about: the target is
  // unregistered before its handle is let go, and an undo afterwards finds
  // nothing to call.
  {
    const { NSUndoManager, NSHashTable } = objc.classes;
    const gone = NSHashTable.weakObjectsHashTable();
    let undone = 0;
    const Target = objc.defineClass({
      name: "FixtureUndoTarget",
      methods: { "undo:": { types: "v@:@", fn: () => void undone++ } },
    }) as any;
    const manager = NSUndoManager.new();
    (() => {
      const target = Target.new();
      gone.addObject_(target);
      manager.registerUndoWithTarget_selector_object_(target, "undo:", null);
      manager.undo();
      manager.registerUndoWithTarget_selector_object_(target, "undo:", null);
      manager.removeAllActionsWithTarget_(target);
    })();
    await waitFor(
      () => {
        Bun.gc(true);
        return gone.anyObject() === null;
      },
      "the unregistered undo target to deallocate",
      30_000,
    );
    manager.undo();
    emit({ step: "undo target", undone, canUndo: manager.canUndo(), deallocated: true });
  }

  win.close();
  emit({ step: "done" });
});
