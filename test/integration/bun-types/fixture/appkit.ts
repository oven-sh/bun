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
  objc,
  Picker,
  Progress,
  ScrollView,
  SecureField,
  Slider,
  Spacer,
  Table,
  Text,
  TextEditor,
  TextField,
  VStack,
  Window,
  type Color,
  type Container,
  type GpuBuffer,
  type GpuFrame,
  type MenuSpec,
  type ObjCClass,
  type ObjCObject,
  type ObjCSelector,
  type View,
} from "bun:appkit";
import * as React from "bun:appkit/react";
import { expectType } from "./utilities";

expectType(Bun.AppKit).is<typeof import("bun:appkit") | undefined>();
if (Bun.AppKit) {
  expectType(Bun.AppKit.app).is<typeof app>();
  expectType(Bun.AppKit.Window).is<typeof Window>();
}

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
app.menu = menus;
app.menu = null;
// @ts-expect-error only the standard responder-chain actions
app.menu = [{ title: "X", items: [{ title: "Bad", action: "doesNotRecognizeSelector:" }] }];

const accent: Color = "accent";
const hex: Color = "#ff8800";
const rgba: Color = "rgba(0, 0, 0, 0.5)";

const label = new Text({ text: "Count: 0", font: { size: 24, weight: "bold" }, color: accent });
label.text = "Count: 1";
label.lineLimit = 0;
label.font = 12;
label.font = { design: "monospaced", italic: true, weight: 600 };

const button = new Button({
  title: "Increment",
  kind: "primary",
  onClick() {
    label.text = "clicked";
  },
});
button.click();
button.onClick = undefined;
button.onClick = null;
expectType(button.enabled).is<boolean>();
expectType(button.symbol).is<string | null>();
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

const picker = new Picker({ items: ["a", "b"], onChange: i => expectType(i).is<number>() });
expectType(picker.selectedIndex).is<number>();

const table = new Table({
  columns: ["Name", { title: "Size", width: 80 }],
  rows: [["a", "1"]],
  multiple: true,
  onSelect: indexes => expectType(indexes).is<number[]>(),
  onActivate: row => expectType(row).is<number>(),
});
expectType(table.selectedIndexes).is<readonly number[]>();
expectType(table.rowHeight).is<number | null>();

new Image({ image: { symbol: "star.fill" }, tint: "yellow", size: 32, scaling: "fit" });
new Image({ image: { data: new Uint8Array() } });
new Progress({ indeterminate: true, spinner: true });
new TextEditor({ value: "", font: { design: "monospaced" }, grow: 1 });

const row = new HStack({ spacing: 4, align: "firstBaseline" });
row.append(label, new Spacer(), button);
const stack = new VStack({ padding: 20, spacing: 12, background: hex, border: { width: 1, color: rgba } });
stack.append(row, field, check, slider, picker);
stack.insertBefore(table, null);
stack.removeChild(table);
expectType(stack.children).is<readonly View[]>();
expectType(label.parent).is<Container | null>();

const scroll = new ScrollView({ grow: 1, scrollBars: { horizontal: false } });
scroll.append(stack);

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
// @ts-expect-error fixed once the window exists
win.resizable = false;
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

// bun:appkit/react without JSX or @types/react: host components are plain callables.
React.Window({ title: "Counter", width: 300, children: null, onClose() {} });
React.VStack({ padding: { top: 8 }, spacing: 12, children: [] });
React.Text({ font: { size: 24 }, children: "Count: 0" });
React.Button({ kind: "primary", onClick: () => {}, children: "Increment" });
React.TextField({ value: "", onChange: (value: string) => value });
React.Table({ columns: ["A"], rows: [], onSelect: (indexes: number[]) => indexes });
React.MetalView({ grow: 1, onFrame: (frame: GpuFrame) => frame.commit() });
const root = React.render(null);
root.render(null);
root.unmount();
expectType(React.createRoot()).is<React.Root>();
expectType(React.flushSync(() => 1)).is<number>();
React.flushSync();

// objc bridge
{
  // The common classes are listed by name; any other name reads as a class too (unknown ones throw at
  // runtime), hence `| undefined` under noUncheckedIndexedAccess.
  expectType(objc.classes.NSString).is<ObjCClass>();
  expectType(objc.classes.NSRulerMarker).is<ObjCClass | undefined>();
  const { NSString, NSMutableArray, NSProcessInfo } = objc.classes;
  expectType(`${NSProcessInfo.processInfo().processName()}`).is<string>();
  const s: ObjCObject = NSString.stringWithString_("hi");
  expectType(s.msgSend("length")).is<unknown>();
  expectType(s.length()).is<any>();
  expectType(`${s}`).is<string>();
  expectType(s.toString()).is<string>();
  expectType(s[objc.pointer]).is<bigint>();
  const list = NSMutableArray.new();
  expectType(list).is<ObjCObject>();
  list.addObject_(s);
  expectType(NSMutableArray.alloc().init()).is<any>();
  expectType(objc.sel("terminate:")).is<ObjCSelector>();
  expectType(objc.sel("length").name).is<string>();
  expectType(objc.js(list)).is<unknown>();
  expectType(objc.ns({ a: 1, b: ["x", true] })).is<ObjCObject | null>();
  expectType(objc.same(s, list)).is<boolean>();
  objc.same(null, s);
  // @ts-expect-error read-only
  objc.classes.NSString = NSString;
  const w = new Window({ visible: false });
  expectType(w.native).is<ObjCObject>();
  w.native.setFrame_display_({ origin: { x: 0, y: 0 }, size: { width: 300, height: 200 } }, true);
  expectType(new VStack().native).is<ObjCObject>();
  // @ts-expect-error read-only
  w.native = s;
}
