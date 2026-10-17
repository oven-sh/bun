// An object literal whose members are getters satisfies a record type. It reaches a typed function through a callee of type `any`, and is read there as any object is: each read runs the getter.
import { createTool } from "./tool";
type Context = { useId: string | undefined; signal: number };
type AnyDefinition = { name: string; create: (deps: any) => any };
function build<D extends AnyDefinition>(definition: D) {
  const create = definition.create;
  const created = (context: Context, values?: { timing?: number }) => ({
    tool: create.call(definition, { name: definition.name }),
    call: {
      timing: values?.timing,
      ...(context.signal > 100 && { extra: 1 }),
      get useId() {
        return context.useId;
      },
      get signal() {
        return context.signal;
      },
      abort: (reason: string) => {
        context.useId = reason;
      },
    },
  });
  return {
    call: (input: { [key: string]: unknown }, context: Context) => {
      const { tool, call } = created(context, { timing: 7 });
      return tool.call(input, call);
    },
    describe: (context: Context) => {
      const { tool, call } = created(context);
      return tool.describe(call);
    },
  };
}
const built = build({ name: "search", create: createTool });
const context: Context = { useId: "id-1", signal: 5 };
console.log(await built.call({ q: "x" }, context), built.describe(context));
context.signal = 6;
console.log(await built.call({ q: "y" }, context), built.describe(context));
