// The Objective-C classes, protocols and enumerations are declared in a
// separate file a project opts into; appkit-plain.ts checks what bun:objc
// and bun:appkit type like without it.
/// <reference types="bun-types/objc-sdk" />
import {
  app,
  Button,
  Checkbox,
  Divider,
  gpu,
  GpuCompileError,
  HStack,
  Image,
  MetalView,
  NativeView,
  Picker,
  Progress,
  ScrollView,
  SecureField,
  Segmented,
  Slider,
  Spacer,
  SplitView,
  Switch,
  Table,
  Text,
  TextEditor,
  TextField,
  VStack,
  Window,
  ZStack,
  type Align,
  type Color,
  type Container,
  type Font,
  type GpuBuffer,
  type GpuFrame,
  type Insets,
  type MenuItem,
  type MenuSpec,
  type NSImageScalingName,
  type NSLayoutAttributeName,
  type TableColumn,
  type View,
} from "bun:appkit";
import objcModule, {
  objc,
  app as objcApp,
  classes as objcClasses,
  defineClass as objcDefineClass,
  super as objcSuper,
  type ObjCClass,
  type ObjCEnum,
  type ObjCException,
  type ObjCObject,
  type ObjCOut,
  type ObjCSelector,
} from "bun:objc";
import { expectType } from "./utilities";

// The modules are builtins everywhere (loading one off macOS throws); there is no Bun.* global.
expectType(process.getBuiltinModule("bun:objc")).is<typeof import("bun:objc") | undefined>();
expectType(process.getBuiltinModule("bun:appkit")).is<typeof import("bun:appkit") | undefined>();
expectType(objcApp).is<typeof objc.app>();
// Every member of `objc` is a named export too; the default export is the whole module.
expectType(objcClasses).is<typeof objc.classes>();
expectType(objcDefineClass).is<typeof objc.defineClass>();
expectType(objcSuper).is<typeof objc.super>();
expectType(objcModule.objc).is<typeof objc>();
expectType(objcModule.app).is<typeof objc.app>();
expectType(objcModule.classes.NSString).is<typeof objc.classes.NSString>();
// @ts-expect-error the bridge is bun:objc's, not bun:appkit's
import { objc as notHere } from "bun:appkit";
void notHere;

app.activationPolicy = "accessory";
expectType(app.name).is<string>();
app.name = "Fixture";
app.name = null;
app.keepAlive = false;
expectType(app.badge).is<string | null>();
app.badge = 3;
app.badge = null;
expectType(app.isDark).is<boolean>();
expectType(app.hasDisplay).is<boolean>();
expectType(app.isRunning).is<boolean>();
expectType(app.windows).is<readonly Window[]>();
// @ts-expect-error not part of the public app object
app.liveViews;
app
  .on("beforequit", event => {
    expectType(event.preventDefault).is<() => void>();
  })
  .on("reopen", hasVisibleWindows => {
    expectType(hasVisibleWindows).is<boolean>();
  })
  .on("menu", item => {
    expectType(item.title).is<string>();
  });

const menus: MenuSpec[] = [
  { title: app.name, items: [{ title: `Quit ${app.name}`, key: "q", action: "terminate:" }] },
  {
    title: "File",
    items: [
      { title: "New", key: "n", onClick() {} },
      "separator",
      { title: "Export", submenu: [{ title: "PNG", key: "e", shift: true, onClick: () => {} }, "-"] },
      { title: "Wrap", checked: true, onClick() {} },
    ],
  },
];
const wrapItem: MenuItem = { title: "Wrap", checked: true, onClick() {} };
app.menu = menus;
expectType(app.menuItem(wrapItem)).is<ObjCObject | null>();
app.menuItem(wrapItem)?.setState_(0);
for (const menu of menus) app.menuItem(menu)?.submenu();
// @ts-expect-error an item object, not its title
app.menuItem("New");
app.menu = null;
// Any action method a responder implements, or a function.
app.menu = [
  {
    title: "X",
    items: [
      { title: "Mine", action: "scrollToTop:" },
      { title: "Run", action() {} },
    ],
  },
];
// @ts-expect-error an action is a selector or a function
app.menu = [{ title: "X", items: [{ title: "Bad", action: 3 }] }];

const accent: Color = "accent";
const hex: Color = "#ff8800";
const rgba: Color = "rgba(0, 0, 0, 0.5)";

const label = new Text({ text: "Count: 0", font: { size: 24, weight: "bold" }, color: accent });
label.text = "Count: 1";
label.lineLimit = 0;
label.font = 12;
label.font = { design: "monospaced", italic: true, weight: 600 };
// Apple's NSColor class colour names, and NSColor / NSFont / NSImage handles.
expectType(new Text("t").color).is<Color | null>();
expectType(new Text("t").font).is<Font | null>();
label.color = "systemIndigoColor";
label.color = objc.classes.NSColor.colorWithSRGBRed_green_blue_alpha_(0.2, 0.4, 1, 1);
label.font = objc.classes.NSFont.monospacedSystemFontOfSize_weight_(12, 0);
new Image({ image: objc.classes.NSImage.imageWithSystemSymbolName_accessibilityDescription_("star", null)! });

// objc.app: the lifecycle `app` is written on.
objc.app.start();
objc.app.start("accessory");
expectType(objc.app.isRunning).is<boolean>();
expectType(objc.app.delegate).is<ObjCObject | null>();
objc.app.delegate = objc.defineClass({ superclass: "BunApplicationDelegate", methods: {} }).new();
objc.app.delegate = null;
{
  using hold = objc.app.retain();
  expectType(hold.released).is<boolean>();
  hold.release();
}
objc.app
  .on("beforequit", event => {
    expectType(event.preventDefault).is<() => void>();
    return false;
  })
  .on("reopen", visible => {
    expectType(visible).is<boolean>();
  });
// @ts-expect-error the menu is the curated layer's
objc.app.on("menu", () => {});
objc.app.badge = 2;
expectType(objc.app.badge).is<string | null>();
objc.app.activate();
objc.app.hide();

const button = new Button({
  title: "Increment",
  keyEquivalent: "\r",
  onClick() {
    label.text = "clicked";
  },
});
button.click();
button.onClick = undefined;
button.onClick = null;
expectType(button.enabled).is<boolean>();
expectType(button.symbol).is<string | null>();
button.bezelStyle = "accessoryBarAction";
button.bezelStyle = "texturedRounded";
// @ts-expect-error not an NSBezelStyle member
button.bezelStyle = "square";
button.bezelStyle = objc.enums.NSBezelStyle!.glass!;
button.bezelStyle = null;
expectType(button.bezelStyle).is<import("bun:appkit").BezelStyle | number>();
expectType(button.bordered).is<boolean>();
expectType(button.hasDestructiveAction).is<boolean>();
new Button("label").keyEquivalent = "\r";
expectType(new Switch({ enabled: false }).enabled).is<boolean>();
// @ts-expect-error only Button, Checkbox, Radio and Switch click
label.click();
const secure: TextField = new SecureField({ placeholder: "Password" });
expectType(secure.continuous).is<boolean>();
expectType(new Divider().vertical).is<boolean | null>();

const field = new TextField({
  placeholder: "Name",
  onChange(value) {
    expectType(value).is<string>();
  },
  onSubmit: value => value.trim(),
});
expectType(field.value).is<string>();

const check = new Checkbox({
  title: "Remember",
  checked: true,
  onChange: checked => expectType(checked).is<boolean>(),
});
expectType(check.checked).is<boolean>();

const slider = new Slider({ min: 0, max: 100, step: 1, onChange: v => expectType(v).is<number>() });
slider.value = 50;

const picker = new Picker({ items: ["a", "b"], enabled: false, onChange: i => expectType(i).is<number>() });
expectType(picker.selectedIndex).is<number>();
expectType(picker.enabled).is<boolean>();
new Segmented({ items: ["x", "y"], selectedIndex: 1, enabled: true });

const table = new Table({
  columns: ["Name", { title: "Size", width: 80 }],
  rows: [["a", 1, true], "single"],
  multiple: true,
  onSelect: indexes => expectType(indexes).is<number[]>(),
  onActivate: row => expectType(row).is<number>(),
});
expectType(table.selectedIndexes).is<readonly number[]>();
expectType(table.rowHeight).is<number>();
table.rowHeight = null;
expectType(table.columns).is<readonly Required<TableColumn>[]>();
table.columns = ["A", { id: "b", title: "B" }];
table.rows = [["x", 1, true], "single", 3];
table.selectedIndexes = [0];
const editor = new TextEditor({
  value: "",
  font: { design: "monospaced" },
  grow: 1,
  onChange: value => expectType(value).is<string>(),
});
expectType(editor.value).is<string>();
editor.editable = false;

new Image({ image: { symbol: "star.fill" }, tint: "yellow", size: 32, scaling: "fit" });
const picture = new Image({ image: { data: new Uint8Array() }, scaling: "scaleAxesIndependently" });
picture.scaling = 2;
expectType(new Image().scaling).is<"down" | "fit" | "fill" | "none" | NSImageScalingName | number>();
new Image({ enabled: false }).enabled = true;
new Slider({ enabled: false }).enabled = true;
const caption = new Text("caption");
caption.textAlign = 4;
caption.textAlign = "center";
expectType(new Text().textAlign).is<"left" | "center" | "right" | "justified" | "natural" | number>();
new Progress({ indeterminate: true, spinner: true });

const row = new HStack({ spacing: 4, align: "firstBaseline" });
row.append(label, new Spacer(), button);
const datePicker = new NativeView(
  objc.classes.NSDatePicker.alloc().initWithFrame_({ x: 0, y: 0, width: 0, height: 0 }),
  {
    width: 220,
  },
);
expectType(datePicker.native).is<objc.NSDatePicker>();
datePicker.native.setDateValue_(new Date());
row.append(datePicker);
// @ts-expect-error not an NSView
new NativeView(objc.classes.NSString.new());
const stack = new VStack({ padding: 20, spacing: 12, background: hex, border: { width: 1, color: rgba } });
stack.append(row, field, check, slider, picker);
stack.insertBefore(table, null);
stack.removeChild(table);
expectType(stack.children).is<readonly View[]>();
expectType(label.parent).is<Container | null>();

const scroll = new ScrollView({ grow: 1, scrollBars: { horizontal: false } });
scroll.append(stack);
expectType(scroll.scrollBars.horizontal).is<boolean | undefined>();
scroll.scrollBars = "both";
expectType(new VStack().distribution).is<
  "fill" | "fillEqually" | "fillProportionally" | "equalSpacing" | "equalCentering" | "gravity" | number
>();
stack.distribution = "equalSpacing";
stack.distribution = 1;
stack.distribution = "gravityAreas";
expectType(row.align).is<Align | NSLayoutAttributeName | number>();
expectType(stack.padding).is<Required<Insets>>();
row.align = "centerY";
row.align = 9;
stack.padding = { top: 1 };
// @ts-expect-error not an alignment
row.align = "middle";
new SplitView({ vertical: true, children: [new VStack(), new ZStack()] }).vertical = false;

const win = new Window({
  title: "Fixture",
  width: 300,
  height: 200,
  content: scroll,
  onResize(size) {
    expectType(size.width).is<number>();
  },
  shouldClose: () => true,
});
win.show();
win.onClose = () => {};
win.maxWidth = 800;
win.minHeight = null;
win.alpha = 0.9;
win.background = "underPageBackground";
expectType(win.maxHeight).is<number | null>();
expectType(win.resizable).is<boolean>();
expectType(win.restoreName).is<string | null>();
win.resizable = false;
win.restoreName = null;
win.x = null;
win.title = null;
win.width = null;
expectType(win.x).is<number>();
expectType(win.title).is<string>();
expectType(win.snapshot()).is<Uint8Array | null>();
expectType(win.content).is<View | null>();
expectType(label.frame.width).is<number>();
expectType(label.window).is<Window | null>();
win.close();
expectType(win.closed).is<boolean>();

// Metal
expectType(gpu.available).is<boolean>();
expectType(gpu.name).is<string | null>();
const Uniforms = gpu.struct({ mvp: "float4x4", tint: "float3", time: "float", on: "bool" });
expectType(Uniforms.size).is<number>();
expectType(Uniforms.fields.tint.offset).is<number>();
expectType(Uniforms.msl).is<string>();
expectType(Uniforms.pack({ mvp: new Float32Array(16), tint: [1, 0, 0], time: 1, on: true })).is<ArrayBuffer>();
expectType(Uniforms.pack({ time: 1 }, new Float32Array(24), 0)).is<Float32Array<ArrayBuffer>>();
// @ts-expect-error a float is a number
Uniforms.pack({ time: [1] });
// @ts-expect-error unknown field
Uniforms.pack({ nope: 1 });
if (gpu.available) {
  const lib = gpu.library("kernel void twice(device float* v [[buffer(0)]], uint i [[thread_position_in_grid]]) {}");
  expectType(lib.functionNames).is<readonly string[]>();
  const data = gpu.buffer(new Float32Array([1, 2, 3]));
  const zeroed: GpuBuffer = gpu.buffer(64, { storage: "private", label: "scratch" });
  expectType(data.byteLength).is<number>();
  expectType(data.read()).is<Uint8Array>();
  zeroed.write(new Uint8Array(4), 0);
  const twice = gpu.computePipeline(lib.function("twice"));
  expectType(twice.threadExecutionWidth).is<number>();
  gpu.frame().computePass().pipeline(twice).buffer(0, data).dispatch(3).end().commitAndWait();
  gpu.frame().blit().copyBuffer(data, zeroed, { size: 12 }).commit();
  const target = gpu.texture({ width: 64, height: 64, format: "rgba8unorm", usage: ["render", "read"] });
  expectType(target.readPixels()).is<Uint8Array>();
  const pipeline = gpu.renderPipeline({
    vertex: lib.function("vs"),
    fragment: lib.function("fs"),
    colorFormats: [target.format],
    blend: "alpha",
    vertexLayout: { stride: 8, attributes: [{ format: "float2", offset: 0 }] },
  });
  expectType(pipeline.depthFormat).is<import("bun:appkit").PixelFormat | null>();
  gpu
    .frame()
    .renderPass({ color: target, clear: [0, 0, 1, 1] })
    .pipeline(pipeline)
    .vertexBuffer(0, data)
    .vertexBytes(1, Uniforms.pack({ time: 0 }))
    .fragmentSampler(0, gpu.sampler({ magFilter: "linear" }))
    .depthStencil(gpu.depthStencil({ compare: "lessEqual" }))
    .cull("back")
    .draw(3, { instances: 2, primitive: "triangleStrip" })
    .drawIndexed(6, data, { indexType: "uint32" })
    .end()
    .commitAndWait();
  try {
    gpu.library("garbage");
  } catch (e) {
    if (e instanceof GpuCompileError) expectType(e.name).is<"GpuCompileError">();
  }
}
const metal = new MetalView({
  grow: 1,
  clearColor: "#000",
  preferredFPS: 30,
  onFrame(frame, info) {
    expectType(frame).is<GpuFrame>();
    expectType(info.dt).is<number>();
    frame.renderPass(metal).draw(3);
  },
  onResize: ({ width, height }) => width * height,
});
metal.clearColor = "rgba(0, 0, 0, 1)";
metal.running = false;
metal.draw();
expectType(metal.drawableSize).is<import("bun:appkit").Size>();
expectType(metal.gpu).is<typeof gpu>();

// objc bridge
{
  // The common classes are declared with their methods; any other name reads as a class too (unknown
  // ones throw at runtime), hence `| undefined` under noUncheckedIndexedAccess.
  expectType(objc.classes.NSString).is<objc.classes.NSString>();
  expectType(objc.classes.NSRulerMarker).is<ObjCClass | undefined>();
  const { NSString, NSMutableArray, NSProcessInfo, NSWindow } = objc.classes;
  expectType(`${NSProcessInfo.processInfo().processName()}`).is<string>();
  const s: ObjCObject = NSString.stringWithString_("hi");
  expectType(s.msgSend("length")).is<unknown>();
  expectType(s.length()).is<any>();
  expectType(`${s}`).is<string>();
  expectType(s.toString()).is<string>();
  expectType(s[objc.pointer]).is<bigint>();
  const list = NSMutableArray.new();
  expectType(list).is<objc.NSMutableArray>();
  list.addObject_(s);
  expectType(NSMutableArray.alloc().init()).is<objc.NSMutableArray>();
  // Variadic methods take their variable arguments as objects after the named ones.
  expectType(NSString.stringWithFormat_("%@ of %@", 1, s)).is<objc.NSString>();
  expectType(NSMutableArray.arrayWithObjects_(s, "b", 3)).is<objc.NSMutableArray>();
  // The bridge adds the nil that ends the list; a null among the variable arguments would end it early.
  // @ts-expect-error
  NSMutableArray.arrayWithObjects_(s, null);
  expectType(NSMutableArray.arrayWithObjects_(null)).is<objc.NSMutableArray>();
  // The va_list variant is refused, so it is left to the index signature;
  // so is a format that is an NSAttributedString.
  expectType(NSString.stringWithFormat_arguments_).is<any>();
  expectType(objc.classes.NSAttributedString.localizedAttributedStringWithFormat_).is<any>();
  expectType(objc.sel("terminate:")).is<ObjCSelector>();
  expectType(objc.sel("length").name).is<string>();
  expectType(objc.js(list)).is<unknown>();
  expectType(objc.ns({ a: 1, b: ["x", true] })).is<ObjCObject | null>();
  expectType(objc.same(s, list)).is<boolean>();
  expectType(objc.NSNotFound).is<bigint>();
  list.indexOfObject_(s) === objc.NSNotFound;
  objc.same(null, s);
  try {
    list.objectAtIndex_(9);
  } catch (e) {
    const err = e as ObjCException;
    expectType(err.code).is<"ERR_OBJC_EXCEPTION">();
    expectType(err.name).is<string>();
    expectType(err.userInfo).is<string | undefined>();
    expectType(err.exception).is<ObjCObject | undefined>();
  }
  // @ts-expect-error read-only
  objc.classes.NSString = NSString;
  const DataSource = objc.defineClass({
    name: "MyDataSource",
    protocols: ["NSTableViewDataSource"],
    methods: {
      "numberOfRowsInTableView:": () => 3,
      "tableView:objectValueForTableColumn:row:"(_table: ObjCObject, _column: ObjCObject, row: number) {
        expectType(this).is<ObjCObject>();
        return `row ${row}`;
      },
    },
  });
  expectType(DataSource).is<ObjCClass>();
  expectType(DataSource.new()).is<ObjCObject>();
  objc.defineClass({ superclass: DataSource, methods: { "twice:": { types: "q@:q", fn: (n: number) => n * 2 } } });
  // @ts-expect-error methods are required
  objc.defineClass({ name: "Nope" });
  objc.defineClass({ superclass: "NSView", methods: { isFlipped: true, tag: { types: "q@:", value: 3 }, menu: null } });
  // @ts-expect-error a method is a function, a constant, { types, fn } or { types, value }
  objc.defineClass({ methods: { x: "three" } });
  // @ts-expect-error a constant is not an object
  objc.defineClass({ methods: { x: { value: {} } } });
  // super, init overrides and class methods.
  const Badge = objc.defineClass({
    superclass: "NSView",
    methods: {
      initWithFrame_(frame: objc.CGRect) {
        const self = this.super.initWithFrame_(frame);
        expectType(this.super).is<import("bun:objc").ObjCSuper>();
        expectType(this.super.msgSend("frame")).is<unknown>();
        return self;
      },
      drawRect_(dirty: objc.CGRect) {
        this.super.drawRect_(dirty);
        objc.functions.NSRectFill(this.bounds());
      },
    },
    classMethods: {
      version: 3,
      "sideOf:": { types: "d@:@", fn: view => view.frame().size.width },
      "makeWithSide:": {
        types: "@@:d",
        fn(side: number) {
          expectType(this).is<ObjCClass>();
          return this.alloc().initWithFrame_({ x: 0, y: 0, width: side, height: side });
        },
      },
      shared() {
        expectType(this.super).is<import("bun:objc").ObjCSuper>();
        return this.new();
      },
    },
  });
  expectType(objc.super(Badge.new()).isFlipped()).is<any>();
  objc.super(Badge.new(), Badge);
  // @ts-expect-error the class is a handle, not a name
  objc.super(Badge.new(), "NSView");
  // C functions: typed from the table under the reference, objc.fn() by hand.
  expectType(objc.functions.NSStringFromClass(NSString)).is<objc.NSString>();
  expectType(objc.functions.NSBeep()).is<void>();
  expectType(objc.functions.CGMainDisplayID()).is<number>();
  expectType(objc.functions.NSClassFromString("NSColor")).is<ObjCClass | null>();
  objc.functions.NSLog("%@ %@", 1, "two");
  expectType(objc.functions.NSIntersectionRect([0, 0, 1, 1], { x: 0, y: 0, width: 2, height: 2 })).is<objc.CGRect>();
  // @ts-expect-error a name the headers lack, under the reference
  objc.functions.NSNoSuchFunction;
  // @ts-expect-error a Class parameter
  objc.functions.NSStringFromClass("NSString");
  expectType(objc.fn("NSBeep")).is<(...args: any[]) => any>();
  objc.fn("NSLog", { args: ["@"], format: 0 })("%@", 1);
  // @ts-expect-error encodings are strings
  objc.fn("NSBeep", { returns: 1 });
  expectType(objc.protocols.NSWindowDelegate).is<ObjCObject | undefined>();
  const target = objc.target(sender => {
    expectType(sender).is<ObjCObject | null>();
  });
  expectType(target).is<ObjCObject>();
  expectType(objc.block(() => {})).is<ObjCObject>();
  const comparator = objc.block((a: ObjCObject, b: ObjCObject) => (objc.same(a, b) ? 0 : 1), "q@?@@");
  list.sortedArrayUsingComparator_(comparator);
  list.enumerateObjectsUsingBlock_((_obj: ObjCObject, _index: number | bigint, stop: ObjCOut<boolean>) => {
    stop.value = true;
  });
  // An NSUInteger a block is handed is a bigint above 2^53, as a result is, so `number` alone does not take it.
  // @ts-expect-error
  objc.classes.NSIndexSet.indexSetWithIndex_(1n << 60n).enumerateIndexesUsingBlock_((_index: number) => {});
  // Out-parameters, constants, enums, handle ergonomics.
  const error = objc.out<objc.NSError | null>();
  expectType(error).is<ObjCOut<objc.NSError | null>>();
  objc.classes.NSFileManager.defaultManager().attributesOfItemAtPath_error_("/nope", error);
  objc.classes.NSFileManager.defaultManager().attributesOfItemAtPath_error_("/nope", {});
  expectType(error.value).is<objc.NSError | null>();
  expectType(error.value?.localizedDescription()).is<objc.NSString | undefined>();
  // An `NSUInteger *` out-parameter reads back like an NSUInteger result.
  expectType<Parameters<objc.classes.NSString["stringWithContentsOfFile_usedEncoding_error_"]>[1]>().is<
    Partial<ObjCOut<number | bigint>> | null | undefined
  >();
  expectType(NSString.stringWithString_("hay").rangeOfString_("x").length).is<number | bigint>();
  // A trailing out-parameter may be left off; an earlier one may not.
  objc.classes.NSFileManager.defaultManager().contentsOfDirectoryAtPath_error_("/");
  // @ts-expect-error a C array parameter takes only null
  NSString.stringWithCharacters_length_("ab", 2);
  NSString.stringWithCharacters_length_(null, 0);
  expectType(objc.out().value).is<any>();
  expectType(objc.out(1.5)).is<ObjCOut<number>>();
  expectType(objc.constants.NSFontAttributeName).is<unknown>();
  expectType(objc.constant("NSFontWeightBold", { type: "d" })).is<unknown>();
  objc.constant("NSZeroRect");
  // @ts-expect-error type is a string
  objc.constant("NSZeroRect", { type: 1 });
  expectType(objc.enums.NSWindowStyleMask.titled).is<number>();
  const mask: number = objc.enums.NSWindowStyleMask.titled | objc.enums.NSWindowStyleMask.closable;
  list.count() === mask;
  expectType(objc.enums.NSModalResponseOK).is<number>();
  expectType(objc.enums.NSNotFound).is<bigint>();
  expectType(objc.enums.NSEventMask.any).is<bigint>();
  const someMasks: ObjCEnum<"titled" | "closable"> = objc.enums.NSWindowStyleMask;
  void someMasks;
  // Full member names on an enumeration, and names the table lacks, go through the index signatures.
  expectType(objc.enums.NSWindowStyleMask.NSWindowStyleMaskTitled).is<number | undefined>();
  expectType(objc.enums.NSWindowStyleMaskTitled).is<number>();
  expectType(objc.enums.NSEventMaskAny).is<bigint>();
  expectType(objc.enums.MTLPixelFormat.bgra8Unorm).is<number>();
  expectType(objc.enums.CAEdgeAntialiasingMask.layerLeftEdge).is<number>();
  // @ts-expect-error not a name the SDK declares (without the reference it is `any`)
  objc.enums.NSSomethingLater;
  // @ts-expect-error nor is a mistyped one
  objc.enums.NSWindowStyleMsk;
  // @ts-expect-error read-only
  objc.enums.NSWindowStyleMask = {};
  for (const item of list) expectType(item).is<ObjCObject>();
  expectType([...list]).is<ObjCObject[]>();
  for (const index of objc.classes.NSIndexSet.indexSetWithIndex_(3)) expectType(index).is<number>();
  for (const key of NSProcessInfo.processInfo().environment()) expectType(key).is<ObjCObject>();
  for (const left of list.objectEnumerator()) expectType(left).is<ObjCObject>();
  {
    const untyped: ObjCObject = list;
    for (const item of untyped) expectType(item).is<any>();
  }
  {
    using scoped = NSString.stringWithString_("x");
    scoped.length();
  }
  list[Symbol.dispose]();
  "count" in list;
  expectType(objc.block((a: unknown) => a, "@@?@").invoke("x")).is<any>();
  // @ts-expect-error fn is a function
  objc.block("v@?");
  // @ts-expect-error types is a string
  objc.block(() => {}, 3);
  const w = new Window({ visible: false });
  expectType(w.native).is<objc.NSWindow>();
  w.native.setFrame_display_({ origin: { x: 0, y: 0 }, size: { width: 300, height: 200 } }, true);
  w.native.setFrame_display_({ x: 0, y: 0, width: 300, height: 200 }, true);
  expectType(new VStack().native).is<objc.NSStackView>();
  // @ts-expect-error read-only
  w.native = s;

  // Generated declarations: selectors complete with one argument per colon, converted by their C types.
  const str = NSString.stringWithString_("hi");
  expectType(str).is<objc.NSString>();
  expectType(str.length()).is<number | bigint>();
  expectType(str.UTF8String()).is<string | null>();
  expectType(str.isEqualToString_("hi")).is<boolean>();
  expectType(str.stringByAppendingString_(str)).is<objc.NSString>();
  expectType(str.description()).is<objc.NSString>();
  expectType(str.hash()).is<number | bigint>();
  // @ts-expect-error one argument per colon
  str.isEqualToString_();
  // @ts-expect-error one argument per colon
  NSString.stringWithString_("a", "b");
  // @ts-expect-error an NSString parameter takes a string or a handle
  NSString.stringWithString_(3);
  // A selector these declarations lack still goes through the index signature.
  expectType(str.selectorFromTheFuture_(1, 2)).is<any>();
  expectType(NSMutableArray.array()).is<objc.NSMutableArray>();
  expectType(NSMutableArray.alloc().initWithCapacity_(3)).is<objc.NSMutableArray>();
  expectType(NSMutableArray.arrayWithArray_([1, "two"])).is<objc.NSMutableArray>();
  expectType(list.count()).is<number | bigint>();
  expectType(list.indexOfObject_(s)).is<number | bigint>();
  // A signed index that is -1 for no match stays a number; the one documented as NSNotFound does not.
  const menu = objc.classes.NSMenu.new();
  expectType(menu.indexOfItemWithTitle_("Quit")).is<number>();
  menu.itemAtIndex_(menu.indexOfItemWithTag_(1) + 1);
  expectType(objc.classes.NSPopUpButton.new().indexOfSelectedItem()).is<number>();
  expectType(objc.classes.NSSlider.new().indexOfTickMarkAtPoint_([0, 0])).is<number | bigint>();
  expectType(list.firstObject()).is<ObjCObject | null>();
  expectType(list.objectEnumerator()).is<objc.NSEnumerator>();
  list.addObject_("boxed");
  list.addObject_(3);
  list.addObject_(NSString);
  // @ts-expect-error nil is not an object to add
  list.addObject_(null);
  // @ts-expect-error a block parameter in audited headers is nonnull unless it says otherwise
  list.enumerateObjectsUsingBlock_(null);
  objc.classes.NSOperationQueue.mainQueue().addBarrierBlock_(() => {});
  list.enumerateObjectsUsingBlock_((object, index, stop) => {
    expectType(object).is<ObjCObject>();
    expectType(index).is<number | bigint>();
    expectType(stop).is<ObjCOut<boolean>>();
  });
  expectType(list.sortedArrayUsingComparator_((a, b) => (objc.same(a, b) ? 0 : -1))).is<objc.NSArray>();
  str.enumerateLinesUsingBlock_((line, stop) => {
    expectType(line).is<objc.NSString>();
    stop.value = true;
  });
  // Any block type the table knows takes a plain function, typed by its encoding, or a block object.
  str.enumerateSubstringsInRange_options_usingBlock_({ location: 0, length: 1 }, 0, (sub, range, enclosing, stop) => {
    expectType(sub).is<objc.NSString | null>();
    expectType(range).is<objc.NSRange>();
    expectType(enclosing).is<objc.NSRange>();
    stop.value = true;
  });
  str.enumerateSubstringsInRange_options_usingBlock_(
    { location: 0, length: 1 },
    0,
    objc.block(() => {}, "v@?"),
  );
  expectType(w.native.title()).is<objc.NSString>();
  expectType(w.native.contentView()).is<objc.NSView | null>();
  expectType(w.native.frame()).is<objc.CGRect>();
  expectType(w.native.frame().origin.x).is<number>();
  expectType(w.native.styleMask()).is<objc.NSWindowStyleMask>();
  expectType(w.native.styleMask()).is<number>();
  w.native.setStyleMask_(w.native.styleMask() | objc.enums.NSWindowStyleMask.resizable);
  expectType(w.native.isVisible()).is<boolean>();
  expectType(w.native.delegate()).is<ObjCObject | null>();
  expectType(w.native.screen()).is<objc.NSScreen | null>();
  expectType(w.native.initialFirstResponder()).is<objc.NSView | null>();
  w.native.makeFirstResponder_(null);
  w.native.setTitle_("plain");
  w.native.setTitle_(str);
  // @ts-expect-error a BOOL is a boolean
  w.native.setFrame_display_({ x: 0, y: 0, width: 1, height: 1 }, 1);
  // @ts-expect-error an NSRect is an object
  w.native.setFrame_display_(3, true);
  expectType(
    NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(w.native.frame(), mask, 2, false),
  ).is<objc.NSWindow>();
  NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
    [0, 0, 100, 100],
    objc.enums.NSWindowStyleMaskTitled | objc.enums.NSWindowStyleMaskClosable,
    objc.enums.NSBackingStoreBuffered,
    false,
  );
  // A 64-bit enumeration parameter takes the bigint masks; a result of such a type may be one.
  const NSApp = objc.classes.NSApplication.sharedApplication();
  NSApp.nextEventMatchingMask_(objc.enums.NSEventMask.any);
  NSApp.nextEventMatchingMask_(objc.enums.NSEventMask.keyDown | objc.enums.NSEventMask.keyUp);
  expectType(objc.classes.NSEvent.new().associatedEventsMask()).is<number | bigint>();
  new Table().native.documentView()!.setDraggingSourceOperationMask_forLocal_?.(objc.enums.NSDragOperation.every, true);
  // Index results are NSNotFound, a bigint, when there is nothing to find.
  const indexes = objc.classes.NSIndexSet.indexSet();
  expectType(indexes.firstIndex()).is<number | bigint>();
  indexes.firstIndex() === objc.NSNotFound;
  expectType(indexes.count()).is<number | bigint>();
  // Optional protocol methods are declared optional: an object typed by the protocol may not answer them.
  const delegate: objc.protocols.NSWindowDelegate = objc.classes.NSObject.new();
  // @ts-expect-error possibly undefined
  delegate.windowShouldClose_(w.native);
  if ("windowShouldClose_" in delegate) expectType(delegate.windowShouldClose_!(w.native)).is<boolean>();
  expectType(delegate.windowDidResize_).is<((notification: ObjCObject) => void) | undefined>();
  const source: objc.protocols.NSTableViewDataSource = objc.classes.NSObject.new();
  expectType(source.numberOfRowsInTableView_?.(new Table().native.documentView()!)).is<number | undefined>();
  expectType(NSWindow.windowNumbersWithOptions_(0)).is<objc.NSArray | null>();
  const button = new Button("b");
  expectType(button.native).is<objc.NSButton>();
  expectType(button.native.bezelStyle()).is<objc.NSBezelStyle>();
  button.native.setBezelStyle_(objc.enums.NSBezelStyle.push);
  expectType(button.native.target()).is<ObjCObject | null>();
  expectType(button.native.action()).is<string | null>();
  button.native.setAction_("click:");
  button.native.setAction_(objc.sel("click:"));
  expectType(button.native.superview()).is<objc.NSView | null>();
  expectType(button.native.window()).is<objc.NSWindow | null>();
  expectType(new TextEditor().native.documentView()).is<objc.NSView | null>();
  expectType(new Text("t").native.font()).is<objc.NSFont | null>();
  expectType(objc.classes.NSColor.systemRedColor()).is<objc.NSColor>();
  expectType(objc.classes.NSColor.systemRedColor().CGColor()).is<ObjCObject>();
  // C arrays and pointers take ArrayBuffers; CF types are objects (toll-free bridged ones what their class takes).
  objc.classes.NSString.stringWithString_("abc").getCharacters_range_(new Uint16Array(3), { location: 0, length: 3 });
  objc.classes.NSData.dataWithBytes_length_(new Uint8Array(4), 4);
  objc.classes.NSData.dataWithBytes_length_(0n, 0);
  // @ts-expect-error not a buffer
  objc.classes.NSData.dataWithBytes_length_([1, 2], 2);
  expectType(objc.functions.CFStringGetLength("abc")).is<number>();
  expectType(objc.functions.CFStringCreateCopy(null, "abc")).is<objc.NSString>();
  objc.functions.CFGetTypeID(objc.classes.NSColor.systemRedColor().CGColor());
  objc.functions.CGColorGetNumberOfComponents(objc.classes.NSColor.systemRedColor().CGColor());
  expectType(objc.classes.NSApplication.sharedApplication()).is<objc.NSApplication>();
  expectType(objc.classes.NSApp).is<ObjCClass | undefined>();
  expectType(NSProcessInfo.processInfo().environment()).is<objc.NSDictionary>();
  expectType(objc.classes.NSData.data().length()).is<number | bigint>();
  expectType(objc.classes.NSDate.date().timeIntervalSince1970()).is<number>();
  objc.classes.NSDate.date().timeIntervalSinceDate_(new Date());
  expectType(objc.classes.NSTimer).is<objc.classes.NSTimer>();
  objc.classes.NSTimer.scheduledTimerWithTimeInterval_repeats_block_(1, false, timer => {
    expectType(timer).is<objc.NSTimer>();
  });
  const handle: ObjCObject = button.native;
  const typed: objc.NSButton = button.native;
  const conforming: objc.protocols.NSAccessibilityButton = button.native;
  expectType(conforming.accessibilityLabel()).is<objc.NSString | null>();
  expectType(typed.conformsToProtocol_(objc.protocols.NSAccessibilityButton!)).is<boolean>();
  void handle;
}
