import { app, Checkbox, Slider, TextEditor, TextField, VStack, Window } from "bun:appkit";
import { emit, run, tick } from "./_util";

await run(async () => {
  app.activationPolicy = "accessory";

  const events: string[] = [];
  const field = new TextField({ onChange: (v: string) => events.push(`field:${v}`) });
  const editor = new TextEditor({ onChange: (v: string) => events.push(`editor:${v}`) });
  const slider = new Slider({ min: 0, max: 1, onChange: (v: number) => events.push(`slider:${v}`) });
  const check = new Checkbox({ title: "check", onChange: (v: boolean) => events.push(`check:${v}`) });
  const stack = new VStack();
  stack.append(field, editor, slider, check);
  const win = new Window({ width: 300, height: 300, content: stack });
  win.show();

  field.value = "hello";
  editor.value = "multi\nline";
  slider.value = 0.5;
  check.checked = true;
  await tick();
  await tick();

  emit({
    step: "set",
    events,
    fieldValue: field.value,
    editorValue: editor.value,
    sliderValue: slider.value,
    checked: check.checked,
  });

  win.close();
});
