import { app, Button, Text, VStack, Window } from "bun:appkit";
import { emit, run, tick } from "./_util";

await run(async () => {
  app.activationPolicy = "accessory";

  let count = 0;
  const label = new Text({ text: "Count: 0" });
  const button = new Button({
    title: "Increment",
    onClick: () => {
      count++;
      label.text = `Count: ${count}`;
    },
  });
  const stack = new VStack();
  stack.append(label, button);
  const win = new Window({ title: "counter", width: 240, height: 120, content: stack });
  win.show();

  button.click();
  await tick();
  emit({ step: "clicked", count, text: label.text });

  button.onClick = undefined;
  button.click();
  await tick();
  emit({ step: "cleared", count });

  const png = win.snapshot();
  const viewPng = label.snapshot();
  emit({
    step: "snapshot",
    windowBytes: png?.byteLength ?? 0,
    isPng: !!png && png[0] === 0x89 && png[1] === 0x50,
    viewBytes: viewPng?.byteLength ?? 0,
  });

  win.close();
});
