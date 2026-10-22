// Widget is imported once with `import type` and once as a value; Gadget with an inline `type`; Shape is an interface and a function of one name, exported together; Only is imported as a value and used only as a type, while its module has an effect.
import type { Widget as WidgetType } from "./things";
import { Widget, type Gadget, makeGadget, Shape } from "./things";
import { Only } from "./effect";

const widget: WidgetType = new Widget();
const gadget: Gadget = makeGadget();
const shape: Shape = Shape();
let only: Only | undefined;
console.log(widget.run(), gadget.run(), shape.sides, only);
