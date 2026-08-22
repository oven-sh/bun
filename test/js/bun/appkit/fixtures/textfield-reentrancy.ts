// A window's first text field has keyboard focus once the window is shown,
// with or without a display, so anything that ends its editing fires onBlur.
import { app, Button, HStack, Text, TextField, VStack, Window, ZStack } from "bun:appkit";
import { emit, run, tick } from "./_util";

const kinds = (views: readonly unknown[]) => views.map(v => (v as object).constructor.name);

await run(async () => {
  app.activationPolicy = "accessory";

  // onBlur runs while the container is removing the field, and calls back
  // into that container and into the field.
  {
    const log: string[] = [];
    const stack = new VStack();
    const field = new TextField({
      placeholder: "focused",
      onBlur: () => {
        log.push("blur");
        stack.append(new Text({ text: "added from onBlur" }));
        stack.spacing = 3;
        field.value = "edited from onBlur";
        log.push(`appended`);
      },
    });
    stack.append(field, new Button({ title: "other" }));
    const win = new Window({ width: 300, height: 200, content: stack });
    win.show();
    await tick();
    stack.removeChild(field);
    log.push("removed");
    await tick();
    emit({
      step: "remove while editing",
      log,
      children: kinds(stack.children),
      spacing: stack.spacing,
      value: field.value,
    });
    win.close();
  }

  // Hiding a focused field ends editing inside the setter; onBlur is still delivered.
  {
    const log: string[] = [];
    const field = new TextField({ onBlur: () => log.push("blur") });
    const stack = new VStack();
    stack.append(field, new Button({ title: "other" }));
    const win = new Window({ width: 300, height: 200, content: stack });
    win.show();
    await tick();
    field.hidden = true;
    log.push("hidden set");
    await tick();
    emit({ step: "hide while editing", log });
    win.close();
  }

  // Replacing a window's content while a field inside it is focused; the
  // handler touches the window that is halfway through the swap.
  {
    const log: string[] = [];
    const replacement = new Text({ text: "replacement" });
    let win: Window;
    const field = new TextField({
      onBlur: () => {
        log.push("blur");
        win.title = "blurred";
        log.push(`width=${typeof win.width}`);
      },
    });
    win = new Window({ width: 300, height: 200, content: field });
    win.show();
    await tick();
    win.content = replacement;
    log.push("replaced");
    await tick();
    emit({ step: "replace content while editing", log, title: win.title, content: kinds([win.content]) });
    win.close();
  }

  // Moving a focused field within its container keeps it focused (no blur),
  // in a stack and in a ZStack, and keeps the container's order.
  {
    const log: string[] = [];
    const field = new TextField({ placeholder: "moving", onBlur: () => log.push("blur") });
    const a = new Button({ title: "a" });
    const b = new Button({ title: "b" });
    const row = new HStack();
    row.append(field, a, b);
    const win = new Window({ width: 400, height: 120, content: row });
    win.show();
    await tick();
    row.insertBefore(field, null);
    const afterMoveToEnd = kinds(row.children);
    row.insertBefore(field, a);
    const afterMoveToFront = kinds(row.children);
    row.insertBefore(b, a);
    const afterSiblingMove = kinds(row.children);
    await tick();
    const frames = row.children.map(c => c.frame.x);
    emit({
      step: "reorder keeps focus",
      log,
      afterMoveToEnd,
      afterMoveToFront,
      afterSiblingMove,
      framesAscend: frames.every((x, i) => i === 0 || x > frames[i - 1]),
    });
    row.removeChild(field);
    await tick();
    emit({ step: "reorder then remove", log });
    win.close();
  }

  {
    const back = new Text({ text: "back" });
    const front = new TextField({ placeholder: "front" });
    const z = new ZStack();
    z.append(back, front);
    const win = new Window({ width: 200, height: 80, content: z });
    win.show();
    await tick();
    const before = front.frame;
    z.insertBefore(front, back);
    await tick();
    const after = front.frame;
    emit({
      step: "zstack reorder",
      children: kinds(z.children),
      sameFrame: before.width === after.width && before.height === after.height && after.width > 0,
    });
    win.close();
  }

  // Window geometry setters do not report their own change back.
  {
    const events: string[] = [];
    const win = new Window({
      width: 300,
      height: 200,
      onResize: () => events.push("resize"),
      onMove: () => events.push("move"),
    });
    win.show();
    await tick();
    await tick();
    events.length = 0;
    win.width = 360;
    win.height = 240;
    win.x = 40;
    win.y = 60;
    win.maxWidth = 320;
    win.center();
    await tick();
    emit({ step: "window setters", events, width: win.width, height: win.height });
    win.close();
  }
});
