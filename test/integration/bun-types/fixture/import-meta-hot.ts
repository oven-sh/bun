import { expectType } from "./utilities";

// The dev server defines `import.meta.hot`. Everywhere else it is `undefined`.
type Hot = NonNullable<ImportMeta["hot"]>;
expectType<ImportMeta["hot"]>().is<Hot | undefined>();
expectType(import.meta.hot).is<Hot | undefined>();

// @ts-expect-error unguarded access is an error under strict
import.meta.hot.accept();
// @ts-expect-error unguarded access is an error under strict
import.meta.hot.data;

if (import.meta.hot) {
  expectType(import.meta.hot).is<Hot>();
  expectType(import.meta.hot.data).is<any>();
  import.meta.hot.accept();
  import.meta.hot.accept(newModule => {
    expectType(newModule).is<any>();
  });
  import.meta.hot.accept("./foo", newModule => {
    expectType(newModule).is<any>();
  });
  import.meta.hot.accept(["./foo", "./bar"], newModules => {
    expectType(newModules).is<any[]>();
  });
  import.meta.hot.dispose(data => {
    expectType(data).is<any>();
  });
  import.meta.hot.dispose(async () => {});
  import.meta.hot.on("bun:beforeUpdate", () => {});
  import.meta.hot.on("vite:beforeUpdate", () => {});
  import.meta.hot.off("bun:afterUpdate", () => {});
  expectType(import.meta.hot.decline).is<(() => void) | undefined>();
  import.meta.hot.decline?.();
  // @ts-expect-error decline is optional
  import.meta.hot.decline();
  // @ts-expect-error the dev server does not implement invalidate
  import.meta.hot.invalidate();
}

// A non-null assertion keeps a line that also runs in production valid.
expectType(import.meta.hot!.data).is<any>();
import.meta.hot!.accept();

// Nothing can write it: the dev server throws on assignment and Bun folds it to `undefined` elsewhere.
function assign() {
  // @ts-expect-error hot is read-only
  import.meta.hot = undefined;
}
