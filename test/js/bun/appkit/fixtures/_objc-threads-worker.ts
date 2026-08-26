// The bridge from a Worker: Foundation round trips, a block, a defined class,
// what is refused, and a burst of sends made while the main thread does the
// same, all reported back in one message.
import { objc } from "bun:objc";

function attempt(f: () => unknown) {
  try {
    const value = f();
    return { threw: false, value };
  } catch (e) {
    const err = e as Error & { code?: string };
    return { threw: true, code: err?.code ?? null, message: String(err?.message) };
  }
}

self.onmessage = ({ data }) => {
  if (data?.go !== "burst") return;
  const { NSMutableArray, NSString, NSProcessInfo } = objc.classes;
  // The same sends the main thread makes once it hears this has started,
  // tagged so either side reading the other's objects would show.
  const list = NSMutableArray.array();
  for (let i = 0; i < data.count; i++) {
    if (i === 10) postMessage({ started: true });
    list.addObject_(NSString.stringWithString_(`worker ${i}`));
  }
  let own = 0;
  for (let i = 0; i < data.count; i++) if (objc.js(list.objectAtIndex_(i)) === `worker ${i}`) own++;
  const info = NSProcessInfo.processInfo();
  postMessage({
    burst: { count: list.count(), own },
    processInfo: { same: info === NSProcessInfo.processInfo(), address: String(info[objc.pointer]) },
    // The main thread's script class cannot be extended here: its methods would run there, ours here.
    subclass: attempt(() => String(objc.defineClass({ superclass: "FixtureSharedName", methods: {} }))),
  });
};

const { NSString, NSMutableArray, NSFileManager, NSUserDefaults, NSJSONSerialization, NSData, NSThread } = objc.classes;

const text = NSString.stringWithString_("from a worker");
const list = NSMutableArray.array();
list.addObject_("a");
list.addObject_(2);
list.addObject_(true);

const defaults = NSUserDefaults.standardUserDefaults();
const suite = `bun-appkit-worker-${process.pid}`;
defaults.setObject_forKey_({ nested: [1, "two"] }, suite);
const readBack = objc.js(defaults.objectForKey_(suite));
defaults.removeObjectForKey_(suite);

const json = NSJSONSerialization.dataWithJSONObject_options_error_({ k: [1, 2, 3] }, 0, null);
const parsed = NSJSONSerialization.JSONObjectWithData_options_error_(json, 0, null);
const badJson = objc.out();
const failed = NSJSONSerialization.JSONObjectWithData_options_error_(NSData.data(), 0, badJson);

// A block made here and called here, synchronously, by Foundation.
const seen: unknown[] = [];
list.enumerateObjectsUsingBlock_((item: unknown, index: number, stop: { value: boolean }) => {
  seen.push([objc.js(item), index]);
  if (index === 1) stop.value = true;
});

// One class for every thread's targets; this one's function runs here.
let actions = 0;
const target = objc.target(() => actions++) as any;
target.action_(null);

// The main thread defines a class of this name too; a Worker's gets its own.
const Shared = objc.defineClass({
  name: "FixtureSharedName",
  methods: { "tag": { types: "q@:", fn: () => 2 } },
}) as any;
const instance = Shared.new();

postMessage({
  ready: {
    workerMultiThreaded: NSThread.isMultiThreaded(),
    string: { js: objc.js(text), length: text.length(), sameHandle: text === text.self() },
    array: objc.js(list),
    fileExists: {
      execPath: NSFileManager.defaultManager().fileExistsAtPath_(process.execPath),
      nowhere: NSFileManager.defaultManager().fileExistsAtPath_("/nowhere/at/all"),
    },
    defaults: readBack,
    json: {
      parsed: objc.js(parsed),
      nonEmpty: json.length() > 0,
      failed,
      error: String((badJson.value as any)?.domain?.()),
    },
    block: seen,
    defined: { name: String(Shared), tag: instance.tag(), isKind: instance.isKindOfClass_(Shared) },
    target: { className: String(target.className()), actions },
    refused: {
      windowAlloc: attempt(() => objc.classes.NSWindow.alloc()),
      viewNew: attempt(() => objc.classes.NSView.new()),
      menuClass: attempt(() => objc.classes.NSMenu.menuBarVisible()),
      subclass: attempt(() => objc.defineClass({ superclass: "NSView", methods: {} })),
      // Not a responder: allowed, as in native code.
      color: attempt(() => String(objc.classes.NSColor.redColor().className())),
    },
  },
});
