// `context.options.model`: two record types have a field `options` of different types, and a function that takes either reads it, so both fields may stand in one slot. Reads and stores through each type and through the common supertype answer as in plain Bun.
interface Options { model: string; depth: number }
interface Legend { label: string; wide: boolean }
interface Holder { id: number; options: Options | Legend }
interface Context extends Holder { options: Options }
interface Panel extends Holder { options: Legend }
function makeContext(id: number): Context { return { id, options: { model: "m" + id, depth: id } }; }
function makePanel(id: number): Panel { return { id, options: { label: "l" + id, wide: id > 1 } }; }
function keysOfOptions(holder: Holder): string { return Object.keys(holder.options).join(); }
function modelOf(context: Context): string { return context.options.model; }
function depthOf(context: Context): number { return context.options.depth + 1; }
function labelOf(panel: Panel): string { return panel.options.label; }
function replace(context: Context, model: string): void { context.options = { model, depth: 0 }; }
const contexts = [makeContext(1), makeContext(2)];
const panels = [makePanel(1), makePanel(2)];
console.log(contexts.map(modelOf).join(), contexts.map(depthOf).join(), panels.map(labelOf).join());
console.log(keysOfOptions(contexts[0]), keysOfOptions(panels[1]));
replace(contexts[1], "other");
console.log(modelOf(contexts[1]), depthOf(contexts[1]));
function swap(holder: Holder, options: Options | Legend): void { holder.options = options; }
swap(panels[0], { label: "swapped", wide: false });
console.log(labelOf(panels[0]), keysOfOptions(panels[0]));
