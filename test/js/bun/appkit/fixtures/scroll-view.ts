import { app, ScrollView, Text, VStack, Window } from "bun:appkit";
import { emit, run, waitFor } from "./_util";

await run(async () => {
  app.activationPolicy = "accessory";

  // A one-line label far wider than the window; it truncates (compression
  // resistance 250) unless something lets it keep its width.
  const wide = new Text({ text: Buffer.alloc(800, "scroll me sideways ").toString() });
  const scroll = new ScrollView({ scrollBars: "both" });
  scroll.append(wide);
  const win = new Window({ title: "scroll", width: 200, height: 120, content: scroll });
  win.show();
  const widths = () => ({ document: wide.frame.width, scroll: scroll.frame.width, window: win.width });

  // Horizontal scrolling on: the document keeps its natural width and the
  // window stays the size it was given.
  await waitFor(() => scroll.frame.width > 0 && wide.frame.width > 2 * scroll.frame.width, "both");
  emit({ step: "both", ...widths() });

  // Off: the document is held to the clip view's width, so the label truncates.
  scroll.scrollBars = "vertical";
  win.snapshot(); // lays out now
  await waitFor(() => wide.frame.width <= scroll.frame.width + 8, "vertical");
  emit({ step: "vertical", ...widths() });

  // And on again.
  scroll.scrollBars = { horizontal: true, vertical: true };
  win.snapshot();
  await waitFor(() => wide.frame.width > 2 * scroll.frame.width, "both again");
  emit({ step: "both again", ...widths() });

  // VStack takes top/bottom as aliases of leading/trailing; baseline alignment is HStack-only.
  const stack = new VStack();
  stack.align = "bottom";
  let threw: unknown = false;
  try {
    stack.align = "firstBaseline";
  } catch (e) {
    threw = { isTypeError: e instanceof TypeError, message: String((e as Error).message) };
  }
  emit({ step: "vstack align", align: stack.align, threw });

  win.close();
});
