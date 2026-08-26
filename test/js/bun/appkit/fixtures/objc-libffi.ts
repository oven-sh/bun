// The two ways the bridge sends a message: objc_msgSend called through the
// system libffi (the default), and NSInvocation (when
// BUN_FEATURE_FLAG_DISABLE_OBJC_LIBFFI=1). The test runs this under both;
// `libffi` below says which one this run expects. Variadic methods and
// messages to a block exist only with libffi.
import { appKitInternals } from "bun:internal-for-testing";
import { objc } from "bun:objc";
import { emit, run } from "./_util";

type Thrown =
  | { threw: false; value?: unknown }
  | { threw: true; isTypeError: boolean; isError: boolean; code?: string; name?: string; message: string };

const isHandle = (value: unknown) => Object.prototype.toString.call(value) === "[object ObjCObject]";

function tryCall(f: () => unknown): Thrown {
  try {
    const value = f();
    return { threw: false, value: isHandle(value) ? String(value) : value };
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err?.code === "ERR_OBJC_UNAVAILABLE") throw err;
    return {
      threw: true,
      isTypeError: err instanceof TypeError,
      isError: err instanceof Error,
      code: err?.code,
      name: err?.name,
      message: String(err?.message),
    };
  }
}

await run(() => {
  const libffi = process.env.BUN_FEATURE_FLAG_DISABLE_OBJC_LIBFFI !== "1";
  const path = appKitInternals.objcSendPath;
  const {
    NSArray,
    NSMutableArray,
    NSDictionary,
    NSSet,
    NSString,
    NSMutableString,
    NSNumber,
    NSValue,
    NSPredicate,
    NSSortDescriptor,
    NSScanner,
    NSFileManager,
    NSKeyedArchiver,
    NSException,
    NSPasteboard,
    NSDecimalNumber,
  } = objc.classes as any;

  const empty = NSArray.array();
  const hello = NSString.stringWithString_("hello world");

  // Which path each shape of message takes: every one of these is libffi's
  // unless the flag turned it off.
  emit({
    step: "paths",
    libffi,
    paths: {
      objectReturnIntegerArg: path(empty, "objectAtIndex:"),
      unsignedReturn: path(empty, "count"),
      classMethodObjectArg: path(NSString, "stringWithString:"),
      structReturn: path(hello, "rangeOfString:"),
      structArg: path(hello, "substringWithRange:"),
      doubleReturn: path(NSNumber.numberWithDouble_(1.5), "doubleValue"),
      floatArg: path(NSNumber, "numberWithFloat:"),
      boolReturnObjectArg: path(hello, "isEqual:"),
      selArg: path(hello, "respondsToSelector:"),
      selReturn: path(NSSortDescriptor.sortDescriptorWithKey_ascending_("k", true), "selector"),
      classReturn: path(hello, "class"),
      cStringReturn: path(hello, "UTF8String"),
      cStringArg: path(NSString, "stringWithUTF8String:"),
      outParam: path(NSScanner.scannerWithString_("42"), "scanInteger:"),
      voidReturn: path(NSMutableArray.new(), "removeAllObjects"),
      blockArg: path(empty, "enumerateObjectsUsingBlock:"),
      bigStructArg: path(NSValue, "valueWithRect:"),
    },
  });

  // The proof: an NSException raised under a libffi ffi_call of objc_msgSend
  // unwinds through libffi's frames to the catch frame and is a JS Error;
  // the receiver is fine afterwards. Through a plain method, a void one, an
  // init (which consumes its receiver either way) and a class method.
  emit({
    step: "exception",
    path: path(empty, "objectAtIndex:"),
    range: tryCall(() => empty.objectAtIndex_(3)),
    countAfter: Number(empty.count()),
    raise: tryCall(() =>
      NSException.exceptionWithName_reason_userInfo_("BunLibffiException", "raised under ffi_call", null).raise(),
    ),
    init: tryCall(() => NSString.alloc().initWithString_(null)),
    classMethod: tryCall(() => NSDictionary.dictionaryWithObject_forKey_("v", null)),
    // `+alloc` is sent when the first init arrives, on a class the script chose: one that refuses raises.
    alloc: tryCall(() => NSPasteboard.alloc().init()),
    allocWithZone: tryCall(() => NSPasteboard.allocWithZone_(null).init()),
    allocNew: tryCall(() => NSPasteboard.new()),
    allocClassUsable: String(NSPasteboard.superclass()),
  });

  // objc_msgSend messages a block like any object; NSInvocation would call
  // it instead, so that path refuses.
  const aBlock = objc.block(() => {}) as any;
  emit({
    step: "block receiver",
    description: tryCall(() => /Block/.test(objc.js(aBlock.description()) as string)),
    isKindOfClass: tryCall(() => aBlock.isKindOfClass_(objc.classes.NSObject)),
    invoke: typeof aBlock.invoke,
  });

  // Values of each kind out and back through whichever path this is.
  const scanned = objc.out();
  const isDirectory = objc.out();
  const seen: unknown[] = [];
  empty.arrayByAddingObject_("only").enumerateObjectsUsingBlock_((o: unknown, i: number) => seen.push([objc.js(o), i]));
  const compare = objc.block((a: unknown, b: unknown) => (String(a) < String(b) ? -1 : 1), "q@?@@") as any;
  emit({
    step: "roundtrip",
    range: hello.rangeOfString_("world"),
    substring: objc.js(hello.substringWithRange_({ location: 6, length: 5 })),
    rect: NSValue.valueWithRect_({ x: 1, y: 2, width: 3, height: 4 }).rectValue(),
    double: NSNumber.numberWithDouble_(1.5).doubleValue(),
    float: NSNumber.numberWithFloat_(0.25).floatValue(),
    short: NSNumber.numberWithShort_(-7).shortValue(),
    unsignedShort: NSNumber.numberWithUnsignedShort_(65535).unsignedShortValue(),
    longLongMin: String(NSNumber.numberWithLongLong_(-9223372036854775808n).longLongValue()),
    unsignedMax: String(NSNumber.numberWithUnsignedLongLong_(18446744073709551615n).unsignedLongLongValue()),
    bool: [hello.isEqual_(hello), hello.isEqual_(empty)],
    selArg: [hello.respondsToSelector_("length"), hello.respondsToSelector_("nope:")],
    selReturn: NSSortDescriptor.sortDescriptorWithKey_ascending_selector_("k", true, "localizedCompare:").selector(),
    classReturn: String(objc.classes.NSMutableString.superclass()),
    cStringReturn: hello.UTF8String(),
    cStringArg: objc.js(NSString.stringWithUTF8String_("héllo")),
    nilReturn: NSDictionary.dictionary().objectForKey_("missing"),
    outInteger: [NSScanner.scannerWithString_("42abc").scanInteger_(scanned), scanned.value],
    outBool: [NSFileManager.defaultManager().fileExistsAtPath_isDirectory_("/usr/lib", isDirectory), isDirectory.value],
    blockArg: seen,
    blockInvoke: [compare.invoke("a", "b"), compare.invoke("b", "a")],
    // A `char` is a number on both architectures, though x86_64 spells it like BOOL.
    char: [
      NSNumber.numberWithChar_(65).charValue(),
      objc.js(NSNumber.numberWithChar_(65)),
      NSNumber.alloc().initWithChar_(-3).charValue(),
    ],
    charFromBoolean: tryCall(() => NSNumber.numberWithChar_(true)),
    // NSDecimal is a struct with bit-fields: the bridge lays it out on neither side.
    decimalReturn: tryCall(() => NSNumber.numberWithDouble_(1.5).decimalValue()),
    decimalArgument: tryCall(() => NSDecimalNumber.decimalNumberWithDecimal_([1, 2])),
  });

  // Variadic methods whose variable arguments are a nil-terminated object
  // list: any number of objects (strings and numbers boxed), the nil added.
  emit({
    step: "variadic objects",
    array: tryCall(() => objc.js(NSArray.arrayWithObjects_("a", "b", 3))),
    none: tryCall(() => objc.js(NSArray.arrayWithObjects_(null))),
    set: tryCall(() => Number(NSSet.setWithObjects_("a", "b", "a").count())),
    dictionary: tryCall(() => objc.js(NSDictionary.dictionaryWithObjectsAndKeys_("v1", "k1", 2, "k2"))),
    init: tryCall(() => objc.js(NSMutableArray.alloc().initWithObjects_("x", "y"))),
    msgSend: tryCall(() => objc.js(NSArray.msgSend("arrayWithObjects:", "p", "q"))),
  });

  // Variadic methods that take a format: %@ (and NSPredicate's %K) only,
  // each given an object; the format may be a JS string or an NSString.
  const appended = NSMutableString.stringWithString_(">");
  emit({
    step: "variadic format",
    string: tryCall(() => objc.js(NSString.stringWithFormat_("%@ is %@", "bun", 1.5))),
    positional: tryCall(() => objc.js(NSString.stringWithFormat_("%2$@ %1$@", "world", "hello"))),
    percent: tryCall(() => objc.js(NSString.stringWithFormat_("100%%"))),
    noArguments: tryCall(() => objc.js(NSString.stringWithFormat_("plain"))),
    nsstringFormat: tryCall(() => objc.js(NSString.stringWithFormat_(NSString.stringWithString_("<%@>"), "o"))),
    appended: tryCall(() => (appended.appendFormat_("%@,%@", "a", 1), objc.js(appended))),
    predicate: tryCall(() =>
      objc.js(NSPredicate.predicateWithFormat_("name == %@ AND %K > %@", "x", "age", 3).predicateFormat()),
    ),
    initFamily: tryCall(() => objc.js(NSString.alloc().initWithFormat_("%@-%@", "a", "b"))),
    nilFormat: tryCall(() => NSString.stringWithFormat_(null)),
  });

  // What stays refused: conversions that read C values, a va_list, values
  // typed by another argument, something that is not an object, and fewer
  // values than the format uses (by count, or by the position it names).
  emit({
    step: "variadic refused",
    cConversion: tryCall(() => NSString.stringWithFormat_("%d", 1)),
    floatConversion: tryCall(() => NSString.stringWithFormat_("%@ %.2f", "x", 1)),
    width: tryCall(() => NSString.stringWithFormat_("%5@", "x")),
    tooFew: tryCall(() => NSString.stringWithFormat_("%@ %@", "x")),
    positionBeyond: tryCall(() => NSString.stringWithFormat_("%2$@", "a")),
    positionGap: tryCall(() => NSString.stringWithFormat_("%1$@ %3$@", "a", "b")),
    attributedFormat: tryCall(() => objc.classes.NSAttributedString.localizedAttributedStringWithFormat_("x")),
    vaList: tryCall(() => NSString.alloc().initWithFormat_arguments_("%@", null)),
    other: tryCall(() => NSKeyedArchiver.alloc().initRequiringSecureCoding_(false).encodeValuesOfObjCTypes_("i")),
    notAnObject: tryCall(() => NSArray.arrayWithObjects_("a", Symbol("nope"))),
    // A nil among the variable arguments of a nil-terminated list would end it early.
    nilMidList: tryCall(() => objc.js(NSArray.arrayWithObjects_("a", undefined, "b"))),
    nilLast: tryCall(() => objc.js(NSDictionary.dictionaryWithObjectsAndKeys_("v", "k", null))),
    tooManyNonVariadic: tryCall(() => hello.length(1)),
  });

  // The bridge's own application delegate and launch observer work either
  // way (nothing about them needs a closure); a `forwardingTargetForSelector:`
  // of your own does, since without closures every method is delivered by
  // forwarding and answering that question by forwarding would not end.
  {
    objc.app.start("accessory");
    const nsapp = objc.classes.NSApplication.sharedApplication();
    const reopens: boolean[] = [];
    objc.app.on("reopen", visible => void reopens.push(visible));
    const veto = (e: { preventDefault(): void }) => e.preventDefault();
    objc.app.on("beforequit", veto);
    const delegate = nsapp.delegate();
    emit({
      step: "delegate",
      className: String(delegate.className()),
      responds: [
        delegate.respondsToSelector_("applicationShouldTerminate:"),
        delegate.respondsToSelector_("applicationDidFinishLaunching:"),
      ],
      description: typeof objc.js(delegate.description()),
      terminate: Number(delegate.applicationShouldTerminate_(nsapp)),
      reopen: [delegate.applicationShouldHandleReopen_hasVisibleWindows_(nsapp, true), reopens],
      observer: objc.classes.BunApplicationObserver.instancesRespondToSelector_("launched:"),
      forwardingTarget: tryCall(() =>
        String(
          objc
            .defineClass({ methods: { "forwardingTargetForSelector:": () => null } })
            .new()
            .description(),
        ),
      ),
    });
    objc.app.off("beforequit", veto);
  }
});
