// Radios that share a container behave as one group natively; radios in
// separate containers do not.
import { app, HStack, Radio, Text, VStack, Window } from "bun:appkit";
import { emit, run, tick } from "./_util";

await run(async () => {
  app.activationPolicy = "accessory";

  const events: string[] = [];
  const radio = (title: string) => new Radio({ title, onChange: (on: boolean) => events.push(`${title}:${on}`) });

  const [a, b, c] = [radio("A"), radio("B"), radio("C")];
  const row = new HStack({ children: [a, b, c] });
  const [x, y] = [radio("X"), radio("Y")];
  const apart = new HStack({
    children: [new VStack({ children: [x, new Text("dx")] }), new VStack({ children: [y, new Text("dy")] })],
  });
  const win = new Window({ width: 300, height: 200, content: new VStack({ children: [row, apart] }) });
  const states = () => ({ a: a.checked, b: b.checked, c: c.checked });

  a.checked = true;
  await tick();
  emit({ step: "set A", ...states(), events: events.splice(0) });

  b.click();
  await tick();
  emit({ step: "click B", ...states(), events: events.splice(0) });

  c.checked = true;
  await tick();
  emit({ step: "set C", ...states(), events: events.splice(0) });

  x.checked = true;
  y.click();
  await tick();
  emit({ step: "separate containers", x: x.checked, y: y.checked, events: events.splice(0) });

  win.close();
});
