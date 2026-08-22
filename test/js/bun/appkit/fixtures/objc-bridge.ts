// The `objc` escape hatch: classes and selectors by name, argument and return
// conversion by type encoding, ownership, `.native` on curated objects, and
// the errors for everything it refuses.
import { app, objc, ScrollView, Table, VStack, Window, ZStack } from "bun:appkit";
import { basename } from "node:path";
import { emit, run, waitFor } from "./_util";

type Thrown = { threw: false; value?: unknown } | { threw: true; isTypeError: boolean; code?: string; message: string };

function tryCall(f: () => unknown): Thrown {
  try {
    const value = f();
    return { threw: false, value: typeof value === "object" && value !== null ? String(value) : value };
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err?.code === "ERR_APPKIT_UNAVAILABLE") throw err;
    return { threw: true, isTypeError: err instanceof TypeError, code: err?.code, message: String(err?.message) };
  }
}

function attempt(name: string, f: () => unknown) {
  emit({ step: name, ...tryCall(f) });
}

const worker = new Worker(new URL("./_objc-worker.ts", import.meta.url).href);
const fromWorker = await new Promise<any>((resolve, reject) => {
  worker.onmessage = e => resolve(e.data);
  worker.onerror = e => reject(e);
});
worker.terminate();
emit({ step: "worker", ...fromWorker });

await run(async () => {
  app.activationPolicy = "accessory";
  const { NSString, NSMutableArray, NSObject, NSNumber, NSProcessInfo, NSControl, NSData, NSHashTable, NSButton } =
    objc.classes;

  const s = NSString.stringWithString_("hi");
  emit({
    step: "nsstring",
    length: s.length(),
    utf8: s.UTF8String(),
    template: `${s}`,
    string: String(s),
    description: String(s.description()),
    js: objc.js(s),
    memoized: s.length === s.length,
    tag: Object.prototype.toString.call(s),
    classTag: Object.prototype.toString.call(NSString),
    className: String(NSString),
    sameClass: objc.classes.NSString === NSString,
    pointer: typeof s[objc.pointer],
    classPointer: typeof NSString[objc.pointer],
    isEqual: s.isEqualToString_("hi"),
    hasPrefix: s.hasPrefix_("x"),
    unicode: String(NSString.stringWithUTF8String_("héllo")),
    unicodeLength: NSString.stringWithUTF8String_("héllo").length(),
    thenable: typeof s.then,
    resolvesToItself: (await Promise.resolve(s)) === s,
  });

  const list = NSMutableArray.new();
  const addReturns = list.addObject_(s);
  list.addObject_("there");
  emit({
    step: "array",
    count: list.count(),
    second: String(list.objectAtIndex_(1)),
    firstIsS: objc.same(list.objectAtIndex_(0), s),
    addReturns: typeof addReturns,
    js: objc.js(list),
    isKindOfArray: list.isKindOfClass_(objc.classes.NSArray),
    isKindOfString: list.isKindOfClass_(NSString),
    classIsSubclass: list.class().isSubclassOfClass_(objc.classes.NSMutableArray),
    superclassShared: NSMutableArray.superclass() === objc.classes.NSArray,
    respondsToCount: list.respondsToSelector_("count"),
    respondsToSel: list.respondsToSelector_(objc.sel("objectAtIndex:")),
    respondsToNope: list.respondsToSelector_("nope:"),
    instancesRespond: NSString.instancesRespondToSelector_("length"),
    selName: objc.sel("terminate:").name,
    selString: String(objc.sel("terminate:")),
  });

  const processName = `${NSProcessInfo.processInfo().processName()}`;
  emit({
    step: "processName",
    type: typeof processName,
    matchesExecutable: processName === basename(process.execPath),
  });

  const strings = NSMutableArray.new();
  strings.addObject_("a");
  strings.addObject_("b");
  const plain = NSObject.new();
  emit({
    step: "conversion",
    intValue: objc.ns(3).intValue(),
    doubleValue: objc.ns(2.5).doubleValue(),
    floatValue: objc.ns(2.5).floatValue(),
    boolValue: objc.ns(true).boolValue(),
    longLong: NSNumber.numberWithLongLong_(-5).longLongValue(),
    unsignedLongLong: String(NSNumber.numberWithUnsignedLongLong_(18446744073709551615n).unsignedLongLongValue()),
    unsignedLongLongType: typeof NSNumber.numberWithUnsignedLongLong_(18446744073709551615n).unsignedLongLongValue(),
    jsNumber: objc.js(objc.ns(3)),
    jsDouble: objc.js(objc.ns(2.5)),
    jsBool: objc.js(objc.ns(true)),
    jsString: objc.js(objc.ns("s")),
    jsStrings: objc.js(strings),
    jsNested: objc.js(objc.ns({ a: 1, b: [true, null, "s"] })),
    jsPassthrough: [objc.js(7), objc.js("x"), objc.js(null), objc.js(undefined) === undefined],
    nsNull: objc.ns(null),
    nsUndefined: objc.ns(undefined),
    nsHandle: objc.same(objc.ns(s), s),
    nsArrayCount: objc.ns([1, "two", s]).count(),
    nsDictLookup: String(objc.ns({ k: "v" }).objectForKey_("k")),
    nilReturn: objc.classes.NSMutableDictionary.new().objectForKey_("missing"),
    json: JSON.stringify({ s, strings, n: objc.ns(4) }),
    jsonPlain: JSON.parse(JSON.stringify({ plain })).plain,
    range: NSString.stringWithString_("hello world").rangeOfString_("world"),
    // NSNotFound is NSIntegerMax, past 2^53, so it arrives as a bigint and goes back in as one.
    notFound: String(NSString.stringWithString_("hello").rangeOfString_("x").location),
    notFoundType: typeof NSString.stringWithString_("hello").rangeOfString_("x").location,
    substring: String(NSString.stringWithString_("hello world").substringWithRange_({ location: 0, length: 5 })),
    bigRange: String(
      objc.classes.NSValue.valueWithRange_({ location: 9223372036854775807n, length: 2 }).rangeValue().location,
    ),
    badRange: tryCall(() => objc.classes.NSValue.valueWithRange_({ location: -1, length: 0 })).threw,
    // Lone surrogates survive the trip into an NSString argument, as they do through objc.ns().
    loneSurrogate: NSString.stringWithString_("a\ud800b").isEqualToString_(objc.ns("a\ud800b")),
    loneSurrogateLength: NSString.stringWithString_("a\ud800b").length(),
    selectorForId: tryCall(() => list.indexOfObject_(objc.sel("terminate:"))),
    nsSelector: tryCall(() => objc.ns(objc.sel("terminate:"))),
    classesProbes: {
      then: typeof (objc.classes as any).then,
      string: String(objc.classes),
      json: JSON.stringify({ c: objc.classes }),
      awaited: (await (async () => objc.classes)()) === objc.classes,
    },
  });

  const control = NSControl.new();
  control.setAction_("terminate:");
  const fromString = control.action();
  control.setAction_(objc.sel("hide:"));
  emit({ step: "selectors", fromString, fromSel: control.action() });

  // A detached plain NSView keeps whatever frame it is given.
  const detached = new ZStack();
  const view = detached.native;
  view.setFrame_({ origin: { x: 1, y: 2 }, size: { width: 30, height: 40 } });
  const frame = view.frame();
  view.setFrame_({ x: 5, y: 6, width: 70, height: 80 });
  const flat = view.frame();
  view.setFrameSize_({ width: 50, height: 60 });
  view.setFrameOrigin_({ x: 3, y: 4 });
  const table = new Table();
  emit({
    step: "view",
    frame,
    flat,
    moved: view.frame(),
    identity: detached.native === view,
    isView: view.isKindOfClass_(objc.classes.NSView),
    isWindow: view.isKindOfClass_(objc.classes.NSWindow),
    vstackIsStackView: new VStack().native.isKindOfClass_(objc.classes.NSStackView),
    tableOuter: String(table.native.className()),
    tableDocument: table.native.documentView().isKindOfClass_(objc.classes.NSTableView),
    scrollInsets: new ScrollView().native.contentInsets(),
  });

  const win = new Window({ title: "t", visible: false, width: 300, height: 200 });
  const native = win.native;
  const titleBefore = String(native.title());
  native.setTitle_("u");
  const winFrame = native.frame();
  native.setFrame_display_({ origin: winFrame.origin, size: { width: 320, height: winFrame.size.height } }, true);
  const widthAfterNested = win.width;
  native.setFrame_display_(
    { x: winFrame.origin.x, y: winFrame.origin.y, width: 340, height: winFrame.size.height },
    false,
  );
  emit({
    step: "window",
    titleBefore,
    titleAfter: win.title,
    isVisible: native.isVisible(),
    frameKeys: Object.keys(winFrame).sort(),
    frameWidth: winFrame.size.width,
    frameAtLeastContentHeight: winFrame.size.height >= 200,
    widthAfterNested,
    widthAfterFlat: win.width,
    nativeFrameWidth: native.frame().size.width,
    identity: win.native === native,
    isWindow: native.isKindOfClass_(objc.classes.NSWindow),
    contentViewIsView: native.contentView().isKindOfClass_(objc.classes.NSView),
    sameThroughContentView: objc.same(native, native.contentView().window()),
    samePointer: native[objc.pointer] === native.contentView().window()[objc.pointer],
    sameDifferent: objc.same(native, s),
    sameNulls: objc.same(null, null),
    sameStrings: objc.same("a" as any, "a" as any),
  });
  win.close();
  attempt("native after close", () => win.native);
  // The handle taken before the close still holds the NSWindow.
  emit({ step: "handle after close", title: String(native.title()) });

  attempt("unknown class", () => objc.classes.NSDefinitelyNotAClass);
  attempt("unrecognized selector", () => s.definitelyNotASelector_(1));
  attempt("unrecognized class selector", () => NSString.definitelyNot());
  attempt("wrong arg count", () => s.compare_());
  attempt("wrong arg count extra", () => s.length(1));
  attempt("wrong arg count msgSend", () => s.msgSend("compare:"));
  attempt("msgSend works", () => s.msgSend("compare:", "hi"));
  attempt("block arg", () => list.enumerateObjectsUsingBlock_(() => {}));
  attempt("pointer arg", () => NSData.dataWithBytes_length_("x", 1));
  attempt("fractional index", () => list.removeObjectAtIndex_(1.5));
  attempt("negative unsigned", () => list.removeObjectAtIndex_(-1));
  attempt("string for number", () => list.removeObjectAtIndex_("1"));
  attempt("symbol for object", () => NSData.dataWithData_(Symbol("no")));
  attempt("bad struct", () => view.setFrame_({ x: 1 }));
  attempt("assign property", () => ((s as any).foo = 1));
  attempt("bad msgSend selector", () => s.msgSend(""));
  attempt("bad sel", () => objc.sel(""));
  attempt("retainCount refused", () => plain.retainCount());
  attempt("retain refused", () => plain.msgSend("retain"));
  // Variadic selectors read arguments nobody passed; they are refused by name.
  attempt("variadic format", () => NSString.stringWithFormat_("%@ %s"));
  attempt("variadic objects", () => NSMutableArray.arrayWithObjects_(s));
  attempt("variadic append", () => s.stringByAppendingFormat_("%@"));
  attempt("variadic init", () => NSString.alloc().initWithFormat_("%@"));
  attempt("va_list", () => objc.classes.NSException.raise_format_arguments_("x", "%@", "y"));
  attempt("object arguments:", () =>
    String(objc.classes.NSExpression.expressionForFunction_arguments_("sum:", []).function()),
  );
  attempt("non-variadic format", () =>
    String(objc.classes.NSPredicate.predicateWithFormat_argumentArray_("SELF == %@", ["a"]).predicateFormat()),
  );
  attempt("init on class", () => NSString.init());
  attempt("init on class msgSend", () => NSMutableArray.msgSend("init"));
  // alloc() is not sent until an init reaches it, so an init that throws (or
  // never comes) leaves nothing half-made behind for a later collection.
  attempt("alloc then bad init", () => NSButton.alloc().initWithFrame_("bad"));
  attempt("alloc then wrong count", () => objc.classes.NSTextField.alloc().initWithFrame_());
  attempt("alloc then not init", () => NSString.alloc().length());
  attempt("alloc toString", () => String(NSMutableArray.alloc()));
  attempt("alloc json", () => JSON.stringify({ a: NSMutableArray.alloc() }));
  attempt("alloc as argument", () => list.addObject_(NSObject.alloc()));
  for (let i = 0; i < 20; i++) objc.classes.NSView.alloc();
  Bun.gc(true);
  Bun.gc(true);
  const allocOnly = NSMutableArray.alloc();
  emit({
    step: "alloc",
    pointer: String(allocOnly[objc.pointer]),
    sameAsItself: objc.same(allocOnly, allocOnly),
    sameAsOther: objc.same(allocOnly, NSMutableArray.alloc()),
    thenInit: allocOnly.initWithCapacity_(4).count(),
    consumed: tryCall(() => allocOnly.init()),
  });
  attempt("view for id", () => native.contentView().addSubview_(new VStack()));
  const other = new Window({ title: "x", visible: false });
  attempt("window for id", () => list.addObject_(other));
  other.close();
  attempt("class instance for id", () =>
    list.addObject_(
      new (class Foo {
        x = 1;
      })(),
    ),
  );
  attempt("null-proto object for id", () => objc.ns(Object.create(null)).count());
  attempt("date for id", () => list.addObject_(new Date(0)));
  attempt("NUL in char*", () => NSString.stringWithUTF8String_("a\u0000b"));
  attempt("NUL in SEL", () => list.respondsToSelector_("a\u0000b"));
  attempt("2^60 for Q", () => list.removeObjectAtIndex_(2 ** 60));
  emit({ step: "still two", count: list.count() });

  // Ownership, observed through a weak NSHashTable: an object deallocates the
  // moment the last reference goes, so a handle that gave up its reference
  // (release() or garbage collection) and was the only owner empties the table.
  const weak = NSHashTable.weakObjectsHashTable();
  const anyLeft = () => {
    const left = weak.anyObject();
    if (left === null) return false;
    left.release();
    return true;
  };
  // -allObjects, not -count: the count includes slots zeroed but not yet purged.
  const countLeft = () => {
    const all = weak.allObjects();
    const n = all.count();
    all.release();
    return n;
  };
  const raw = NSMutableArray.alloc();
  const owned = raw.init();
  owned.addObject_("x0");
  const single = NSObject.new();
  weak.addObject_(single);
  const heldBeforeRelease = anyLeft();
  single.release();
  const releasedNow = !anyLeft();
  const holder = NSMutableArray.new();
  holder.addObject_(NSObject.alloc().init());
  holder.objectAtIndex_(0).release();
  (() => {
    for (let i = 0; i < 200; i++) {
      weak.addObject_(NSObject.alloc().init());
      weak.addObject_(NSMutableArray.new());
      weak.addObject_(NSMutableArray.array());
    }
  })();
  // A handful may still be reachable from the stack after a collection; the
  // point is that dropped handles give their reference back, not that every
  // one is found in one pass.
  const STRAGGLERS = 5;
  await waitFor(
    () => {
      Bun.gc(true);
      return countLeft() <= STRAGGLERS;
    },
    `all but ${STRAGGLERS} of 600 dropped objc handles to be released`,
    30_000,
  );
  emit({
    step: "ownership",
    consumed: tryCall(() => raw.count()),
    owned: String(owned.objectAtIndex_(0)),
    heldBeforeRelease,
    releasedNow,
    useAfterRelease: tryCall(() => single.description()),
    sameAfterRelease: [objc.same(single, single), objc.same(single, holder)],
    // The array's own reference kept the element alive after the +0 handle let go of its one.
    stillInArray: String(holder.objectAtIndex_(0).className()),
    left: countLeft() <= STRAGGLERS,
  });
  // Anything over-released above would have crashed by now.
  Bun.gc(true);
  emit({ step: "done", length: s.length(), count: list.count() });
});
