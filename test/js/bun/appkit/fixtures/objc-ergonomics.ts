// The parts of `objc` beyond plain sends: out-parameters, exported constants,
// the enum tables, one handle per object, inspection, the `in`/keys traps,
// `using`, for...of over collections, and NSData/NSDate conversion.
import { Text, Window } from "bun:appkit";
import { appKitInternals } from "bun:internal-for-testing";
import { objc } from "bun:objc";
import { inspect } from "node:util";
import { emit, run, waitFor } from "./_util";

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

await run(async () => {
  const { NSFileManager, NSScanner, NSAttributedString, NSString, NSMutableArray, NSObject, NSIndexSet } = objc.classes;
  // Read before the application object exists; must not stick.
  const earlyApp = objc.constants.NSApp;

  // ^@: NSError ** filled on failure, left nil on success; null passes NULL.
  const missing = "/definitely/not/a/path/for/bun";
  const error = objc.out();
  const failed = NSFileManager.defaultManager().attributesOfItemAtPath_error_(missing, error);
  const plain: { value?: any } = {};
  NSFileManager.defaultManager().attributesOfItemAtPath_error_(missing, plain);
  const unused = objc.out();
  const root = NSFileManager.defaultManager().attributesOfItemAtPath_error_("/", unused);
  emit({
    step: "out error",
    failed,
    errorClass: error.value.isKindOfClass_(objc.classes.NSError),
    domain: String(error.value.domain()),
    code: error.value.code(),
    plainCode: plain.value.code(),
    unusedIsNull: unused.value === null,
    rootIsDictionary: root.isKindOfClass_(objc.classes.NSDictionary),
    withNull: NSFileManager.defaultManager().attributesOfItemAtPath_error_(missing, null),
    // A trailing out-parameter left off is NULL.
    omitted: NSFileManager.defaultManager().attributesOfItemAtPath_error_(missing),
  });
  attempt("omitted non-out", () => NSString.stringWithString_("a").compare_());

  // ^d, ^q, ^I, ^@ on NSScanner; a value set beforehand is the storage's initial contents.
  const scanner = NSScanner.scannerWithString_("3.25 -17 ff word");
  const d = objc.out();
  const q = objc.out(99);
  const hex = objc.out();
  const word = objc.out();
  const scanned = [
    scanner.scanDouble_(d),
    scanner.scanInteger_(q),
    scanner.scanHexInt_(hex),
    scanner.scanUpToString_intoString_("!", word),
  ];
  const exhausted = objc.out(7.5);
  emit({
    step: "out scalars",
    scanned,
    d: d.value,
    q: q.value,
    hex: hex.value,
    word: String(word.value),
    // Nothing left to scan: NSScanner leaves the storage alone, so the initial value comes back.
    again: scanner.scanDouble_(exhausted),
    exhausted: exhausted.value,
  });

  // ^{_NSRange=QQ}: NSRangePointer.
  const styled = NSAttributedString.alloc().initWithString_("hello");
  const range = objc.out();
  const font = styled.attribute_atIndex_effectiveRange_("NSFont", 1, range);
  const lineEnd = objc.out();
  NSString.stringWithString_("ab\ncd").getLineStart_end_contentsEnd_forRange_(null, lineEnd, null, {
    location: 0,
    length: 1,
  });
  emit({ step: "out struct", font, range: range.value, lineEnd: lineEnd.value });

  // Out-parameters of a defined method read and write the same `{ value }` cells.
  const Filler = objc.defineClass({
    methods: {
      "bump:": { types: "v@:^q", fn: (cell: { value: number }) => void (cell.value += 1) },
      "fill:": {
        types: "B@:^@",
        fn(cell: { value: unknown }) {
          const wasNull = cell.value === null;
          cell.value = "filled";
          return wasNull;
        },
      },
      "frame:": {
        types: "v@:^{CGRect={CGPoint=dd}{CGSize=dd}}",
        fn: (cell: { value: any }) => void (cell.value = { x: 1, y: 2, width: cell.value.size.width * 2, height: 4 }),
      },
    },
  });
  const filler = Filler.new();
  const counter = objc.out(41);
  filler.bump_(counter);
  const text = objc.out();
  const wasNull = filler.fill_(text);
  const frame = objc.out({ x: 0, y: 0, width: 21, height: 0 });
  filler.frame_(frame);
  emit({
    step: "out defined",
    counter: counter.value,
    wasNull,
    text: String(text.value),
    textIsString: text.value.isKindOfClass_(NSString),
    withNull: filler.fill_(null),
    // Object storage is not read on the way in (an NSError ** need not be initialised).
    presetReadsNull: filler.fill_(objc.out("preset")),
    frame: frame.value,
  });
  attempt("out number", () => scanner.scanDouble_(1.5 as any));
  attempt("out handle", () => scanner.scanDouble_(NSObject.new()));
  attempt("out bad initial", () => scanner.scanDouble_(objc.out("x")));

  // C arrays and buffers are not out-parameters: a typed array or NULL, nothing else.
  const abc = NSString.stringWithString_("abc");
  attempt("array objects", () => objc.ns(["x"])!.getObjects_range_(objc.out(), { location: 0, length: 1 }));
  attempt("array unichar", () => abc.getCharacters_range_(objc.out(), { location: 0, length: 3 }));
  attempt("array char", () => abc.getCString_maxLength_encoding_("", 1000, 4));
  attempt("array const", () => objc.classes.NSArray.arrayWithObjects_count_(objc.out(), 1));
  attempt("array no count", () => objc.classes.NSColor.redColor().getComponents_(objc.out()));
  attempt("array read", () =>
    objc.classes.NSInputStream.inputStreamWithData_(new Uint8Array(8)).read_maxLength_({}, 8),
  );
  emit({
    step: "array null",
    getCharacters: abc.getCharacters_range_(null, { location: 0, length: 0 }),
    constChar: String(NSString.stringWithUTF8String_("hi")),
    utf8: abc.UTF8String(),
  });

  // A class cluster allocates when the init is looked up; a failed init leaves an alloc that takes only an init.
  const clusterAlloc = NSAttributedString.alloc();
  attempt("cluster bad init", () => clusterAlloc.msgSend("initWithString:"));
  attempt("cluster not initialized", () => clusterAlloc.length());
  emit({
    step: "cluster alloc",
    inspect: Bun.inspect(clusterAlloc),
    keys: Object.keys(clusterAlloc).length,
    length: clusterAlloc.initWithString_("ok").length(),
    consumed: tryCall(() => clusterAlloc.length()).threw,
  });

  // Exported constants: objects by default, numbers and structs where the table says so.
  emit({
    step: "constants",
    fontAttribute: objc.js(objc.constants.NSFontAttributeName),
    didResize: objc.js(objc.constants.NSWindowDidResizeNotification),
    runLoopMode: objc.js(objc.constants.NSDefaultRunLoopMode),
    cached: objc.constants.NSFontAttributeName === objc.constants.NSFontAttributeName,
    viaFunction: objc.constant("NSFontAttributeName") === objc.constants.NSFontAttributeName,
    weightRegular: objc.constants.NSFontWeightRegular,
    weightBoldPositive: (objc.constants.NSFontWeightBold as number) > 0,
    typed: objc.constant("NSFontWeightRegular", { type: "d" }),
    noIntrinsicMetric: objc.constants.NSViewNoIntrinsicMetric,
    zeroRect: objc.constants.NSZeroRect,
    // A struct constant is a fresh object per read: changing one does not change the constant.
    zeroRectAfterWrite: (() => {
      (objc.constants.NSZeroRect as { size: { width: number } }).size.width = 9;
      return objc.constants.NSZeroRect;
    })(),
    zeroRectShared: objc.constants.NSZeroRect === objc.constants.NSZeroRect,
    zeroSize: objc.constant("NSZeroSize"),
    string: String(objc.constants),
    // A scoped read gives back that read; the constant reads again afterwards.
    afterUsing: (() => {
      {
        using scoped = objc.constants.NSFontAttributeName;
        void scoped;
      }
      return String(objc.constants.NSFontAttributeName);
    })(),
    // Outside AppKit's own dependencies: found in whatever the process has loaded.
    otherFramework: (() => {
      objc.classes.NSBundle.bundleWithPath_("/System/Library/Frameworks/AVFoundation.framework").load();
      return String(objc.constants.AVMediaTypeVideo);
    })(),
  });
  // Outside the table a global is read as an object only if it holds one;
  // CoreFoundation's and libc's numbers are in the table.
  emit({
    step: "constants wider",
    since1970: objc.constants.kCFAbsoluteTimeIntervalSince1970,
    pageSize: objc.constants.vm_page_size === 16384 || objc.constants.vm_page_size === 4096,
    identity: objc.constants.CGAffineTransformIdentity,
    debugEnabled: objc.constants.NSDebugEnabled,
    callbacks: tryCall(() => objc.constants.NSObjectMapKeyCallBacks),
    stdinp: tryCall(() => objc.constants.__stdinp),
    environ: tryCall(() => objc.constants.environ),
    explicit: tryCall(() => objc.constant("kCFAbsoluteTimeIntervalSince1970", { type: "@" })),
  });
  attempt("constant unknown", () => objc.constants.NSDefinitelyNotAConstant);
  attempt("constant function", () => objc.constants.NSBeep);

  // C functions: the generated table and objc.fn(), through libffi.
  {
    const { NSString, NSColor } = objc.classes;
    const NSBeep = objc.fn("NSBeep", { returns: "v", args: [] });
    const NSStringFromSelector = objc.fn("NSStringFromSelector", { returns: "@", args: [":"] });
    const CGRectInset = objc.functions.CGRectInset;
    const color = objc.functions.CGColorCreateGenericRGB(1, 0.5, 0.25, 1);
    // NSLog writes to stderr; the test reads it back.
    objc.functions.NSLog("functions %@ %@", 42, "logged");
    emit({
      step: "functions",
      fromClass: String(objc.functions.NSStringFromClass(NSString)),
      classFromString: objc.functions.NSClassFromString("NSColor") === NSColor,
      home: String(objc.functions.NSHomeDirectory()) === (process.env.HOME ?? Bun.env.HOME),
      beep: NSBeep() === undefined,
      beepName: NSBeep.name,
      same: objc.functions.NSStringFromClass === objc.functions.NSStringFromClass,
      selector: String(NSStringFromSelector("count")),
      inset: CGRectInset({ x: 0, y: 0, width: 10, height: 10 }, 2, 3),
      colorComponents: NSColor.colorWithCGColor_(color).greenComponent(),
      colorDescription: String(color).includes("CGColor"),
      mainDisplay: typeof objc.functions.CGMainDisplayID(),
      equalRects: objc.functions.NSEqualRects([0, 0, 1, 1], { x: 0, y: 0, width: 1, height: 1 }),
      unknown: tryCall(() => (objc.functions as any).NSNoSuchFunctionAnywhere),
      notExported: tryCall(() => objc.fn("NSNoSuchFunctionAnywhere")),
      aConstant: tryCall(() => objc.fn("NSViewNoIntrinsicMetric", { returns: "d" })),
      badTypes: tryCall(() => objc.fn("NSBeep", { returns: "v", args: [3 as any] })),
      badEncoding: tryCall(() => objc.fn("NSBeep", { returns: "{{" })),
      wrongCount: tryCall(() => objc.functions.NSStringFromClass()),
      wrongType: tryCall(() => objc.functions.NSStringFromClass(3)),
      formatValues: tryCall(() => objc.functions.NSLog("%d", 1)),
      // Reference counting belongs to the handles: the table leaves these out and objc.fn() refuses them.
      releaseListed: tryCall(() => (objc.functions as any).CGColorRelease),
      releaseByHand: tryCall(() => objc.fn("CGColorRelease", { args: ["^{CGColor=}"] })),
      retainByHand: tryCall(() => objc.fn("CFRetain", { returns: "@", args: ["@"] })),
      deallocateByHand: tryCall(() => objc.fn("NSDeallocateObject", { args: ["@"] })),
      displayRelease: typeof objc.functions.CGDisplayRelease,
      // A va_list is nothing a script can make: NSLogv and the …WithArguments functions are left out.
      vaList: tryCall(() => (objc.functions as any).NSLogv),
    });
  }
  // Who owns what a C function returns or stores, from its declaration and
  // Core Foundation's Create Rule, seen by every object deallocating once its
  // handle lets go: nothing leaks a reference and nothing releases one it
  // never had.
  {
    const { NSFileManager, NSHashTable, NSMapTable } = objc.classes;
    const fns = objc.functions;
    const gone = NSHashTable.weakObjectsHashTable();
    const classes: Record<string, string> = {};
    const reachable = objc.fn("CFURLResourceIsReachable", { returns: "C", args: ["@", "^^{__CFError=}"] });
    const missing = fns.CFURLCreateWithFileSystemPath(null, "/nonexistent/bun-objc-fixture", 0, 0);
    (() => {
      // A Copy function declared NS_RETURNS_RETAINED, and its twin the header leaves unmarked: both +1.
      const mapCopy = fns.NSCopyMapTableWithZone(NSMapTable.mapTableWithKeyOptions_valueOptions_(0, 0), null);
      const hashCopy = fns.NSCopyHashTableWithZone(NSHashTable.hashTableWithOptions_(0), null);
      // A Create-named function returning a +0 NSString.
      const pboardType = fns.NSCreateFilenamePboardType(`bun-objc-${process.pid}`);
      // A CFErrorRef * the function creates for the caller; through the table and typed by hand.
      const tableError = objc.out();
      const reachableByTable = fns.CFURLResourceIsReachable(missing, tableError);
      const handError = objc.out();
      const reachableByHand = reachable(missing, handError);
      // Out-parameters of a Create function that returns nothing.
      const reading = objc.out();
      const writing = objc.out();
      fns.CFStreamCreateBoundPair(null, reading, writing, 64);
      // An NSError ** a method fills in: autoreleased, retained for the handle.
      const methodError = objc.out();
      const attributes = NSFileManager.defaultManager().attributesOfItemAtPath_error_(
        "/nonexistent/bun-objc",
        methodError,
      );
      const made = {
        mapCopy,
        hashCopy,
        pboardType,
        tableError: tableError.value,
        handError: handError.value,
        reading: reading.value,
        writing: writing.value,
        methodError: methodError.value,
      };
      emit({
        step: "function ownership made",
        reachableByTable,
        reachableByHand,
        attributes,
        pboardType: String(pboardType),
        tableErrorCode: Number((tableError.value as { code(): unknown }).code()),
      });
      for (const [name, object] of Object.entries(made)) {
        classes[name] = String((object as { className(): unknown }).className());
        gone.addObject_(object);
        (object as { release(): void }).release();
      }
    })();
    await waitFor(
      () => {
        Bun.gc(true);
        return gone.anyObject() === null;
      },
      () => `every object a C function handed over to deallocate (still alive: ${inspect(gone.allObjects())})`,
    );
    emit({
      step: "function ownership",
      classes,
      deallocated: gone.anyObject() === null,
      badReturnsRetained: tryCall(() => objc.fn("NSBeep", { returnsRetained: "yes" as never })),
      badRetainedOuts: tryCall(() => objc.fn("NSBeep", { retainedOuts: [0] })),
      fractionalOut: tryCall(() =>
        objc.fn("CFURLResourceIsReachable", { returns: "C", args: ["@", "^^{__CFError=}"], retainedOuts: [0.5] }),
      ),
      fractionalFormat: tryCall(() => objc.fn("NSLog", { returns: "v", args: ["@"], format: 0.5 })),
      notAnOut: tryCall(() => objc.fn("NSStringFromClass", { returns: "@", args: ["#"], retainedOuts: [0] })),
      nestedNamed: (() => {
        const error = objc.out();
        objc.fn("CFURLResourceIsReachable", { returns: "C", args: ["@", "^^{__CFError}"] })(missing, error);
        const name = String((error.value as { className(): unknown }).className());
        (error.value as { release(): void }).release();
        return name;
      })(),
    });
  }

  // Every row of the generated function table prepares through the bridge:
  // the encodings the generator wrote are ones the runtime parses and lays
  // out. Only a symbol the running macOS lacks may fail, and it is named.
  {
    const { functions } = appKitInternals.enumTables();
    const names = Object.keys(functions);
    const failed: Record<string, string[]> = {};
    for (const name of names) {
      const outcome = tryCall(() => objc.functions[name]);
      if (!outcome.threw) continue;
      const bucket = outcome.message.replace(/"[^"]*"/, '"…"').replace(/^\w+\(\): /, "");
      (failed[bucket] ??= []).push(name);
    }
    emit({ step: "functions sweep", rows: names.length, failed });
  }
  // C arrays and raw pointers take an ArrayBuffer or typed array for the
  // length of the call; where the SDK says which argument counts the elements
  // (`count:`, `length:`, a `range:`) the buffer must be that large. Core
  // Foundation types cross as the objects they are: a toll-free bridged one
  // takes what its class takes, the rest an object of that CFTypeID.
  {
    const { NSString, NSData, NSMutableData, NSBezierPath, NSColor, NSArray } = objc.classes;
    // -[NSString getCharacters:range:] fills a unichar buffer sized by the range.
    const text = NSString.stringWithString_("héllo, buffer");
    const chars = new Uint16Array(5);
    text.getCharacters_range_(chars, { location: 0, length: 5 });
    // +[NSString stringWithCharacters:length:] reads one; length counts elements, not bytes.
    const roundTrip = objc.js(NSString.stringWithCharacters_length_(chars, chars.length));
    // A DataView over part of a larger buffer lends just that part.
    const backing = new ArrayBuffer(32);
    new Uint8Array(backing).set([1, 2, 3, 4], 8);
    const bytes = objc.js(NSData.dataWithBytes_length_(new DataView(backing, 8, 4), 4)) as Uint8Array;
    // NSPoint elements: 16 bytes each.
    const path = NSBezierPath.bezierPath();
    path.appendBezierPathWithPoints_count_(new Float64Array([0, 0, 10, 0, 10, 10]), 3);
    // `void *` sized by `length:` counts bytes; a pointer also takes the
    // address a pointer result gave. (A method that keeps the pointer past
    // the call, `…NoCopy…`, must not be given a typed array: `raw` copies.)
    const raw = NSData.dataWithBytes_length_(new Uint8Array([9, 8, 7]), 3);
    const address = raw.bytes();
    const again = objc.js(NSData.dataWithBytes_length_(address, 3));
    const room = NSMutableData.dataWithLength_(16);
    emit({
      step: "buffers",
      chars: Array.from(chars),
      roundTrip,
      bytes: Array.from(bytes),
      pathElements: path.elementCount(),
      addressType: typeof address,
      again: Array.from(again as Uint8Array),
      tooShort: tryCall(() => text.getCharacters_range_(new Uint16Array(2), { location: 0, length: 5 })),
      tooShortCount: tryCall(() => NSString.stringWithCharacters_length_(new Uint16Array(2), 3)),
      tooShortStruct: tryCall(() => path.appendBezierPathWithPoints_count_(new Float64Array(2), 2)),
      tooShortBytes: tryCall(() => NSData.dataWithBytes_length_(new Uint8Array(4), 1 << 20)),
      tooShortRoom: tryCall(() => room.getBytes_length_(new Uint8Array(8), room.length())),
      tooShortRange: tryCall(() => room.getBytes_range_(new Uint8Array(2), { location: 4, length: 3 })),
      shared: tryCall(() => NSData.dataWithBytes_length_(new Uint8Array(new SharedArrayBuffer(4)), 4)),
      resizable: tryCall(() =>
        NSData.dataWithBytes_length_(new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })), 4),
      ),
      // Lent storage is pinned for the send: a transfer() in a callout the
      // send reaches gets a copy, and the storage the callee reads stays.
      pinned: (() => {
        const backing = new ArrayBuffer(16);
        new Float64Array(backing).set([3, 4]);
        let transfer: Thrown | undefined;
        const Pinned = objc.defineClass({
          methods: {
            "sum:count:": {
              types: "d@:^dq",
              fn: (cell: { value: number }, count: number) => {
                transfer = tryCall(() => backing.transfer());
                return cell.value + count;
              },
            },
          },
        }) as any;
        const result = Pinned.new().sum_count_(new Float64Array(backing), 2);
        return {
          transferred: transfer !== undefined && !transfer.threw,
          result,
          detached: backing.detached,
          byteLength: backing.byteLength,
        };
      })(),
      notABuffer: tryCall(() => NSData.dataWithBytes_length_([1, 2], 2)),
      exactFit: objc.js(NSString.stringWithCharacters_length_(new Uint16Array([104, 105]), 2)),
      // A class the SDK tables were not generated from (here one defined in
      // JavaScript; MapKit's `getCoordinates:range:` is the same case) gets
      // the sizing rule the tables were built with: a pointer to a value that
      // `count:`/`length:`/`range:` follows is an array of that many.
      unlisted: (() => {
        const Unlisted = objc.defineClass({
          methods: {
            "first:count:": { types: "d@:^dq", fn: (cell: { value: number }) => cell.value },
            "sum:range:": { types: "d@:^d{_NSRange=QQ}", fn: (cell: { value: number }) => cell.value },
          },
        }) as any;
        const u = Unlisted.new();
        return {
          type: String(u.methodSignatureForSelector_("first:count:").getArgumentTypeAtIndex_(2)),
          fits: u.first_count_(new Float64Array([7, 8]), 2),
          tooShort: tryCall(() => u.first_count_(new Float64Array([7]), 4)),
          tooShortRange: tryCall(() => u.sum_range_(new Float64Array(2), { location: 0, length: 3 })),
          outRefused: tryCall(() => u.first_count_(objc.out(1), 1)),
        };
      })(),
      // Storage for one value does not take a buffer: nothing says that parameter is an array.
      oneValue: tryCall(() => objc.classes.NSScanner.scannerWithString_("1.5").scanDouble_(new Float64Array(1))),
    });

    const { CFStringGetLength, CFArrayGetCount, CGColorGetNumberOfComponents, CFGetTypeID, CFStringGetTypeID } =
      objc.functions;
    const cgColor = NSColor.systemBlueColor().CGColor();
    emit({
      step: "cf types",
      // CFStringRef is NSString: a string, or an NSString handle, is one.
      lengthOfString: CFStringGetLength("four"),
      lengthOfHandle: CFStringGetLength(NSString.stringWithString_("abc")),
      arrayCount: CFArrayGetCount(NSArray.arrayWithArray_([1, 2, 3])),
      // CGColorRef is only ever a CGColor.
      components: CGColorGetNumberOfComponents(cgColor),
      // CFTypeRef is any object.
      typeIDs: CFGetTypeID("x") === CFStringGetTypeID(),
      // A CF result is a handle like any object; a bridged one converts.
      created: objc.js(objc.functions.CFStringCreateCopy(null, "copied")),
      // A struct by value with no field names of its own (CFRange is `{?=qq}`) is an array of its members either way.
      substring: objc.js(objc.functions.CFStringCreateWithSubstring(null, "hello world", [6, 5])),
      found: objc.functions.CFStringFind("hello world", "o w", 0),
      directionalInsetsZero: objc.constants.NSDirectionalEdgeInsetsZero,
      // CFBundleRef and CFPlugInRef are one struct: a CFBundle is accepted where the encoding names it.
      bundle: tryCall(() =>
        objc.js(
          objc.functions.CFBundleGetIdentifier(objc.functions.CFBundleGetBundleWithIdentifier("com.apple.AppKit")),
        ),
      ),
      mainBundleLoaded: objc.functions.CFBundleIsExecutableLoaded(objc.functions.CFBundleGetMainBundle()),
      notThatType: tryCall(() => CGColorGetNumberOfComponents(NSString.stringWithString_("nope"))),
      numberForString: tryCall(() => CFStringGetLength(42)),
      wrongBridge: tryCall(() => CFArrayGetCount("not an array")),
    });
  }
  attempt("constant prototype name", () => objc.constants.constructor);
  attempt("constant void", () => objc.constant("NSFontAttributeName", { type: "v" }));
  attempt("constant bad name", () => (objc.constant as any)(3));
  attempt("constants read-only", () => ((objc.constants as any).NSFontAttributeName = 1));

  // Any struct of scalars passed by value crosses: the ones AppKit names
  // fields for as objects (or arrays going in), anonymous ones (CMTime is a
  // typedef of an unnamed struct with mixed member sizes) as arrays.
  {
    const { CALayer, NSValue } = objc.classes;
    const layer = CALayer.layer();
    const identity = layer.transform();
    layer.setTransform_([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]);
    const moved = layer.transform();
    layer.setTransform_({ ...identity, m41: 9 });
    const time = NSValue.valueWithCMTime_([90, 30, 1, 0]);
    const range = NSValue.valueWithRange_([3, 4]).rangeValue();
    emit({
      step: "structs",
      identityKeys: Object.keys(identity).join(","),
      identityDiagonal: [identity.m11, identity.m22, identity.m33, identity.m44],
      moved: [moved.m41, moved.m42, moved.m43],
      spread: layer.transform().m41,
      cmTime: time.CMTimeValue(),
      cmTimeText: String(time).includes("90"),
      rangeFromArray: range,
      badLength: tryCall(() => layer.setTransform_([1, 2, 3])),
      badMember: tryCall(() => NSValue.valueWithCMTime_([90, "x", 1, 0])),
      badBigint: tryCall(() => NSValue.valueWithCMTime_([90, 1n << 40n, 1, 0])),
      fraction: tryCall(() => NSValue.valueWithRange_({ location: 1.5, length: 1 })),
    });
  }

  // Enums: short and full member names per type, and every member and static constant flat.
  const {
    NSWindowStyleMask,
    NSTextAlignment,
    NSEventType,
    NSBitmapImageFileType,
    NSKeyValueObservingOptions,
    NSLineBreakMode,
  } = objc.enums as any;
  const label = new Text({ text: "t", textAlign: "center" });
  const win = new Window({ title: "h", visible: false, width: 120, height: 80 });
  emit({
    step: "NSApp",
    early: earlyApp === null || objc.same(earlyApp, objc.classes.NSApplication.sharedApplication()),
    now: objc.constants.NSApp === objc.classes.NSApplication.sharedApplication(),
  });
  emit({
    step: "enums",
    titled: NSWindowStyleMask.titled,
    resizable: NSWindowStyleMask.resizable,
    fullName: NSWindowStyleMask.NSWindowStyleMaskFullSizeContentView,
    flat: objc.enums.NSWindowStyleMaskTitled,
    keyDown: NSEventType.keyDown,
    png: NSBitmapImageFileType.png,
    kvoNew: NSKeyValueObservingOptions.new,
    byWordWrapping: NSLineBreakMode.byWordWrapping,
    // The one architecture-dependent enum agrees with what AppKit reads back.
    centerMatches: label.native.alignment() === NSTextAlignment.center,
    stateOn: objc.enums.NSControlStateValueOn,
    stateMixed: objc.enums.NSControlStateValueMixed,
    modalOK: objc.enums.NSModalResponseOK,
    upArrow: objc.enums.NSUpArrowFunctionKey,
    // Constants of an unnamed NS_ENUM(Type) block.
    utf8: objc.enums.NSUTF8StringEncoding,
    undefinedComponent: objc.enums.NSDateComponentUndefined === objc.NSNotFound,
    notFound: objc.enums.NSNotFound === objc.NSNotFound,
    frozen: Object.isFrozen(NSWindowStyleMask),
    has: ["titled" in NSWindowStyleMask, "NSWindowStyleMaskTitled" in NSWindowStyleMask, "nope" in NSWindowStyleMask],
    keyCount: Object.keys(NSTextAlignment).length,
    same: objc.enums.NSWindowStyleMask === NSWindowStyleMask,
    tag: Object.prototype.toString.call(NSWindowStyleMask),
    // A mask built from the table is what NSWindow reports.
    windowMask: win.native.styleMask() & NSWindowStyleMask.titled,
  });
  const enums = objc.enums as any;
  emit({
    step: "enum names",
    byTruncatingTail: enums.NSLineBreakMode.byTruncatingTail,
    initial: enums.NSKeyValueObservingOptions.initial,
    jpeg2000: enums.NSBitmapImageFileType.jpeg2000,
    slideUp: enums.NSTableViewAnimationOptions.slideUp,
    dtdKind: enums.NSXMLNodeKind.dtdKind,
    scaleToFitFull: enums.NSImageScaling.NSScaleToFit,
    scaleAxesIndependently: enums.NSImageScaling.scaleAxesIndependently,
    scaleToFitShort: "scaleToFit" in enums.NSImageScaling,
    // QuartzCore and Metal: a CoreFoundation-style `k` stays with the prefix; the value is what the layer reads.
    layerLeftEdge: enums.CAEdgeAntialiasingMask.layerLeftEdge,
    kCALayerLeftEdge: enums.kCALayerLeftEdge,
    constraintMinX: enums.CAConstraintAttribute.minX,
    bgra8Unorm: enums.MTLPixelFormat.bgra8Unorm,
    depth32Float: enums.MTLPixelFormatDepth32Float,
    edgeMask:
      objc.classes.CALayer.layer().edgeAntialiasingMask() ===
      (enums.kCALayerLeftEdge | enums.kCALayerRightEdge | enums.kCALayerBottomEdge | enums.kCALayerTopEdge),
  });
  attempt("enum unknown", () => objc.enums.NSDefinitelyNotAnEnum);
  attempt("enum prototype name", () => (objc.enums as any).hasOwnProperty);
  attempt("enums read-only", () => ((objc.enums as any).NSWindowStyleMask = 1));

  // One object, one handle.
  const list = NSMutableArray.new();
  // Boxed by the bridge, so no handle of it exists yet.
  list.addObject_("element");
  let receiver: unknown;
  const Echo = objc.defineClass({
    methods: {
      "ping:": {
        types: "v@:@",
        fn() {
          receiver = this;
        },
      },
    },
  });
  const echo = Echo.new();
  echo.ping_(null);
  const first = list.objectAtIndex_(0);
  first.release();
  const second = list.objectAtIndex_(0);
  emit({
    step: "identity",
    element: list.objectAtIndex_(0) === list.objectAtIndex_(0),
    window: win.native === win.native.contentView().window(),
    classFromMessage: NSObject.new().class() === NSObject && list.class() === objc.classes[String(list.class())],
    classFromArray: objc.ns([NSString]).objectAtIndex_(0) === NSString,
    classTag: Object.prototype.toString.call(objc.ns([NSString]).objectAtIndex_(0)),
    self: NSObject.class() === NSObject,
    receiver: receiver === echo,
    afterRelease: first !== second && second === list.objectAtIndex_(0),
    same: [objc.same(second, list.objectAtIndex_(0)), objc.same(first, second), objc.same(null, null)],
  });
  // Arguments with a `value` of their own are left alone after a send.
  const { NSURLQueryItem } = objc.classes;
  emit({
    step: "value arguments",
    queryItem: tryCall(() => list.addObject_(NSURLQueryItem.queryItemWithName_value_("a", "b"))).threw,
    frozen: tryCall(() => list.addObject_(Object.freeze({ value: 1 }))).threw,
    stillItem: String(list.objectAtIndex_(1).value()),
  });
  list.removeObjectsInRange_({ location: 1, length: 2 });

  // What console.log / util.inspect print.
  const hi = NSString.stringWithString_("hi");
  const allocated = NSString.alloc();
  emit({
    step: "inspect",
    string: Bun.inspect(hi),
    util: inspect(hi),
    klass: Bun.inspect(NSString),
    released: Bun.inspect(first),
    alloc: Bun.inspect(allocated),
    custom: (hi as any)[Symbol.for("nodejs.util.inspect.custom")](),
    inArray: Bun.inspect([NSString]),
  });
  allocated.init();

  // `in`, Object.keys, property descriptors.
  const keys = Object.keys(list);
  const classKeys = Object.keys(NSString);
  emit({
    step: "traps",
    hasCount: "count" in list,
    hasSetter: "addObject_" in list,
    hasNope: "definitelyNot_" in list,
    hasThen: "then" in list,
    hasMsgSend: "msgSend" in list,
    hasPointer: objc.pointer in list,
    hasIterator: Symbol.iterator in list,
    objectHasIterator: Symbol.iterator in NSObject.new(),
    classHasRelease: "release" in NSString,
    keysIncludeCount: keys.includes("count") && keys.includes("objectAtIndex_") && keys.includes("addObject_"),
    keysExcludePrivate: keys.every(k => !k.startsWith("_")),
    keysUnique: new Set(keys).size === keys.length,
    manyKeys: keys.length > 50,
    classKeys: classKeys.includes("stringWithString_") && !classKeys.includes("length"),
    descriptor: typeof Object.getOwnPropertyDescriptor(list, "count")?.value,
    noDescriptor: Object.getOwnPropertyDescriptor(list, "definitelyNot_"),
    releasedHas: "count" in first,
    releasedKeys: Object.keys(first).length,
    keysAnswerIn: keys.every(k => k in list) && classKeys.every(k => k in NSString),
    // A selector no property spells (`isNSArray__`: the `_` before its end
    // would read as colons) is not a key and is sent with msgSend.
    unspellable: (() => {
      const o = NSObject.new();
      return {
        responds: o.respondsToSelector_("isNSArray__"),
        inHandle: "isNSArray____" in o,
        listed: Object.keys(o).some(k => k.startsWith("isNSArray")),
        sent: o.msgSend("isNSArray__"),
      };
    })(),
  });

  // Symbol.dispose ends the handle like release(): for every variable that
  // holds it, since one object has one handle; the object itself stays where
  // something else retains it, and reads back as a fresh handle.
  const scoped = NSString.stringWithString_("scoped");
  {
    using inner = scoped;
    inner.length();
  }
  const holder = objc.ns(["kept"])!;
  const kept = holder.firstObject();
  {
    using again = holder.firstObject();
    void again;
  }
  const fresh = holder.firstObject();
  emit({
    step: "dispose",
    use: tryCall(() => scoped.length()),
    classDispose: typeof (NSString as any)[Symbol.dispose],
    sameHandle: kept !== fresh && fresh === holder.firstObject(),
    stillUsable: tryCall(() => fresh.length()),
    endedForAll: tryCall(() => kept.length()).threw,
    // Idempotent.
    twice: (fresh.release(), fresh.release(), tryCall(() => fresh.length()).threw),
  });

  // for...of over the collections.
  const letters = objc.ns(["a", "b", "c"])!;
  const dict = objc.ns({ x: 1, y: 2 })!;
  const set = objc.classes.NSSet.setWithArray_(["p", "q"]);
  const indexes = letters.indexesOfObjectsPassingTest_((o: unknown) => `${o}` !== "b");
  emit({
    step: "iterate",
    array: [...letters].map(String),
    dictionary: [...dict].map(String).sort(),
    set: [...set].map(String).sort(),
    indexes: [...indexes],
    emptyIndexes: [...NSIndexSet.indexSet()],
    enumerator: [...letters.reverseObjectEnumerator()].map(String),
    arrayFrom: Array.from(letters, o => objc.js(o)),
    identity: [...letters][0] === letters.objectAtIndex_(0),
  });
  attempt("iterate object", () => [...NSObject.new()]);

  // NSData <-> Uint8Array, NSDate <-> Date, both ways and nested.
  const bytes = objc.ns(new Uint8Array([1, 2, 3]))!;
  const when = objc.ns(new Date(1000))!;
  list.addObject_(new Date(2000));
  const back = objc.js(bytes) as Uint8Array;
  const nested = objc.js(
    objc.ns({ d: new Date(0), b: new Uint8Array([9]).buffer, v: new DataView(new Uint8Array([7, 8]).buffer) }),
  ) as any;
  const { NSNumber } = objc.classes;
  emit({
    step: "numbers",
    notFound: objc.js(objc.ns(objc.NSNotFound)) === objc.NSNotFound,
    maxUnsigned: String(objc.js(NSNumber.numberWithUnsignedLongLong_(18446744073709551615n))),
    maxUnsignedType: typeof objc.js(NSNumber.numberWithUnsignedLongLong_(18446744073709551615n)),
    small: objc.js(objc.ns(3)),
    negative: objc.js(NSNumber.numberWithInt_(-7)),
    fraction: objc.js(objc.ns(2.5)),
    unsignedType: String(objc.ns(18446744073709551615n)!.objCType()),
    bool: objc.js(objc.ns(true)),
    json: JSON.stringify({ n: objc.ns(12) }),
  });
  emit({
    step: "data date",
    dataClass: bytes.isKindOfClass_(objc.classes.NSData),
    dataLength: bytes.length(),
    back: back instanceof Uint8Array && [...back].join(","),
    dateClass: when.isKindOfClass_(objc.classes.NSDate),
    seconds: when.timeIntervalSince1970(),
    date: objc.js(when) instanceof Date && (objc.js(when) as Date).getTime(),
    argument: (objc.js(list.lastObject()) as Date).getTime(),
    nestedDate: nested.d instanceof Date && nested.d.getTime(),
    nestedBuffer: nested.b instanceof Uint8Array && [...nested.b].join(","),
    nestedView: [...nested.v].join(","),
    empty: (objc.js(objc.ns(new Uint8Array(0))) as Uint8Array).length,
    json: JSON.stringify({ when: objc.ns(new Date(0)) }),
  });

  win.close();
  emit({ step: "done" });
});
