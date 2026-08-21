import {
  app,
  Button,
  Checkbox,
  HStack,
  Image,
  Picker,
  Progress,
  ScrollView,
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
  type MenuSpec,
  type View,
} from "bun:appkit";
import * as React from "bun:appkit/react";
import { expectType } from "./utilities";

expectType(Bun.AppKit.app).is<typeof app>();
expectType(Bun.AppKit.Window).is<typeof Window>();

app.activationPolicy = "accessory";
app.name = "Fixture";
app.keepAlive = false;
app.badge = null;
expectType(app.isDark).is<boolean>();
expectType(app.windows).is<readonly Window[]>();
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
      { title: "Export", submenu: [{ title: "PNG", key: "e", shift: true, onClick: () => {} }] },
    ],
  },
];
app.menu = menus;
app.menu = null;

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
expectType(button.enabled).is<boolean>();

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
expectType(win.snapshot()).is<Uint8Array | null>();
expectType(win.content).is<View | null>();
expectType(label.frame.width).is<number>();
expectType(label.window).is<Window | null>();
win.close();
expectType(win.closed).is<boolean>();

// bun:appkit/react without JSX or @types/react: host components are plain callables.
React.Window({ title: "Counter", width: 300, children: null, onClose() {} });
React.VStack({ padding: { top: 8 }, spacing: 12, children: [] });
React.Text({ font: { size: 24 }, children: "Count: 0" });
React.Button({ kind: "primary", onClick: () => {}, children: "Increment" });
React.TextField({ value: "", onChange: (value: string) => value });
React.Table({ columns: ["A"], rows: [], onSelect: (indexes: number[]) => indexes });
const root = React.render(null);
root.render(null);
root.unmount();
expectType(React.createRoot()).is<React.Root>();
expectType(React.flushSync(() => 1)).is<number>();
React.flushSync();
