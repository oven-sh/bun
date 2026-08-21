// Dumps the runtime API surface (members of every exported class and of
// `app`, plus what unset getters read as) so the test can compare it with
// packages/bun-types/appkit.d.ts.
import * as appkit from "bun:appkit";
import { app, SearchField, SecureField, Text, TextField, VStack, View, Window } from "bun:appkit";
import { emit, run } from "./_util";

function membersOf(prototype: object) {
  const members: Record<string, "accessor" | "method" | "value"> = {};
  for (let proto = prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor" || name in members) continue;
      const d = Object.getOwnPropertyDescriptor(proto, name)!;
      members[name] = d.get || d.set ? "accessor" : typeof d.value === "function" ? "method" : "value";
    }
  }
  return members;
}

function defaultsOf(instance: Record<string, unknown>, members: Record<string, string>) {
  const defaults: Record<string, unknown> = {};
  for (const [name, kind] of Object.entries(members)) {
    if (kind !== "accessor") continue;
    try {
      const value = instance[name];
      if (typeof value !== "function" && !(value instanceof View)) defaults[name] = value;
    } catch (e) {
      defaults[name] = { threw: String((e as Error).message) };
    }
  }
  return defaults;
}

await run(() => {
  app.activationPolicy = "accessory";

  const classes: Record<string, { members: Record<string, string>; defaults: Record<string, unknown> }> = {};
  for (const [name, Class] of Object.entries(appkit)) {
    if (typeof Class !== "function" || !(Class === View || Class.prototype instanceof View)) continue;
    const members = membersOf(Class.prototype);
    // View and Container are abstract; everything else constructs with no arguments.
    const abstract = Class === View || Class === appkit.Container;
    classes[name] = { members, defaults: abstract ? {} : defaultsOf(new (Class as new () => never)(), members) };
  }
  const win = new Window();
  const windowMembers = membersOf(Window.prototype);
  classes.Window = { members: windowMembers, defaults: defaultsOf(win as never, windowMembers) };

  const appMembers: Record<string, string> = {};
  for (const name of Object.getOwnPropertyNames(app)) {
    const d = Object.getOwnPropertyDescriptor(app, name)!;
    appMembers[name] = d.get || d.set ? "accessor" : typeof d.value === "function" ? "method" : "value";
  }

  // `= null` resets to the same default an untouched view reads.
  const text = new Text({ text: "x", lineLimit: 3 });
  (text as { lineLimit: number | null }).lineLimit = null;
  const stack = new VStack({ spacing: 20 });
  (stack as { spacing: number | null }).spacing = null;

  emit({
    step: "surface",
    classes,
    app: appMembers,
    namespace: Object.keys(appkit).sort(),
    reset: { lineLimit: text.lineLimit, spacing: stack.spacing },
    instanceOf: {
      secureField: new SecureField() instanceof TextField,
      searchField: new SearchField() instanceof TextField,
      textFieldIsSecure: new TextField() instanceof SecureField,
    },
  });
  win.close();
});
