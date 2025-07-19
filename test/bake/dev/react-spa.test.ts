// these tests involve ensuring react (html loader + single page app) works
// react is big and we do lots of stuff like fast refresh.
import { expect } from "bun:test";
import { devTest, emptyHtmlFile, minimalFramework } from "../bake-harness";

/** To test react refresh's registration system */
const reactAndRefreshStub = {
  "node_modules/react-refresh/runtime.js": /* js */ `
    exports.performReactRefresh = () => {};
    exports.injectIntoGlobalHook = () => {};
    exports.isLikelyComponentType = () => true;
    exports.register = require("bun-devserver-react-mock").register;
    exports.createSignatureFunctionForTransform = require("bun-devserver-react-mock").createSignatureFunctionForTransform;
  `,
  "node_modules/react/index.js": /* js */ `
    exports.useState = (y) => [y, x => {}];
  `,
  "node_modules/bun-devserver-react-mock/index.js": /* js */ `
    globalThis.components = new Map();
    globalThis.functionToComponent = new Map();
    exports.expectComponent = function(fn, filename, exportId) {
      const name = filename + ":" + exportId;
      try {
        if (!components.has(name)) {
          for (const [k, v] of components) {
            if (v.fn === fn) throw new Error("Component registered under name " + k + " instead of " + name);
          }
          throw new Error("Component not registered: " + name);
        }
        if (components.get(name).fn !== fn) throw new Error("Component registered with wrong name: " + name);
      } catch (e) {
        console.log(components);
        throw e;
      }
    }
    exports.expectHook = function(fn) {
      if (!functionToComponent.has(fn)) throw new Error("Hook not registered: " + fn.name);
      const entry = functionToComponent.get(fn);
      const { calls, hash, name } = entry;
      fn();
      if (calls === entry.calls) throw new Error("Hook " + (name ?? fn.name) + " was not called");
      return hash;
    }
    exports.expectHookComponent = function(fn, filename, exportId) {
      exports.expectComponent(fn, filename, exportId);
      exports.expectHook(fn);
    }
    exports.hashFromFunction = function(fn) {
      if (!keyFromFunction.has(fn)) throw new Error("Function not registered: " + fn);
      return keyFromFunction.get(fn).hash;
    }
    exports.register = function(fn, name) {
      if (typeof name !== "string") throw new Error("name must be a string");
      if (typeof fn !== "function") throw new Error("fn must be a function");
      if (components.has(name)) console.warn("WARNING: Component already registered: " + name + ". Read its hash from test harness first");
      const entry = functionToComponent.get(fn) ?? { fn, calls: 0, hash: undefined, name: undefined, customHooks: undefined };
      entry.name = name;
      components.set(name, entry);
      functionToComponent.set(fn, entry);
    }
    exports.createSignatureFunctionForTransform = function(fn) {
      let entry = null;
      return function(fn, hash, force, customHooks) {
        if (fn !== undefined) {
          entry = functionToComponent.get(fn) ?? { fn, calls: 0, hash: undefined, name: undefined, customHooks: undefined };
          functionToComponent.set(fn, entry);
          entry.hash = hash;
          entry.calls = 0;
          entry.customHooks = customHooks;
          return fn;
        } else {
          if (!entry) throw new Error("Function not registered");
          entry.calls++;
          return entry.fn;
        }
      }
    }
    exports.getCustomHooks = function(fn) {
      const entry = functionToComponent.get(fn);
      if (!entry) throw new Error("Function not registered");
      if (!entry.customHooks) throw new Error("Function has no custom hooks");
      return entry.customHooks();
    }
  `,
  "node_modules/react/jsx-dev-runtime.js": /* js */ `
    export const $$typeof = Symbol.for("react.element");
    export const jsxDEV = (tag, props, key) => ({
      $$typeof,
      props,
      key,
      ref: null,
      type: tag,
    });
  `,
};
devTest("react in html", {
  fixture: "react-spa-simple",
  async test(dev) {
    await using c = await dev.client();

    expect(await c.elemText("h1")).toBe("Hello World");

    await dev.write(
      "App.tsx",
      `
        console.log('reload');
        export default function App() {
          return <h1>Yay</h1>;
        }
      `,
    );
    await c.expectMessage("reload");
    expect(await c.elemText("h1")).toBe("Yay");

    await c.hardReload();
    await c.expectMessage("reload");

    expect(await c.elemText("h1")).toBe("Yay");
  },
});
// https://github.com/oven-sh/bun/issues/17447
devTest("react refresh should register and track hook state", {
  framework: minimalFramework,
  files: {
    ...reactAndRefreshStub,
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.tsx"],
    }),
    "index.tsx": `
      import { expectHookComponent } from 'bun-devserver-react-mock';
      import App from './App.tsx';
      expectHookComponent(App, "App.tsx", "default");
    `,
    "App.tsx": `
      import { useState } from "react";
      export default function App() {
        let [a, b] = useState(1);
        return <div>Hello, world!</div>;
      }
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {});
    const firstHash = await c.reactRefreshComponentHash("App.tsx", "default");
    expect(firstHash).toBeDefined();

    // hash does not change when hooks stay same
    await dev.write(
      "App.tsx",
      `
        import { useState } from "react";
        export default function App() {
          let [a, b] = useState(1);
          return <div>Hello, world! {a}</div>;
        }
      `,
    );
    const secondHash = await c.reactRefreshComponentHash("App.tsx", "default");
    expect(secondHash).toEqual(firstHash);

    // hash changes when hooks change
    await dev.write(
      "App.tsx",
      `
        export default function App() {
          let [a, b] = useState(2);
          return <div>Hello, world! {a}</div>;
        }
      `,
    );
    const thirdHash = await c.reactRefreshComponentHash("App.tsx", "default");
    expect(thirdHash).not.toEqual(firstHash);
  },
});
devTest("react refresh cases", {
  framework: minimalFramework,
  files: {
    ...reactAndRefreshStub,
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.tsx"],
    }),
    "index.tsx": `
      import { expectComponent, expectHookComponent } from 'bun-devserver-react-mock';

      expectComponent((await import("./default_unnamed")).default, "default_unnamed.tsx", "default");
      expectComponent((await import("./default_named")).default, "default_named.tsx", "default");
      expectComponent((await import("./default_arrow")).default, "default_arrow.tsx", "default");
      expectComponent((await import("./local_var")).LocalVar, "local_var.tsx", "LocalVar");
      expectComponent((await import("./local_const")).LocalConst, "local_const.tsx", "LocalConst");
      await import("./non_exported");

      expectHookComponent((await import("./default_unnamed_hooks")).default, "default_unnamed_hooks.tsx", "default");
      expectHookComponent((await import("./default_named_hooks")).default, "default_named_hooks.tsx", "default");
      expectHookComponent((await import("./default_arrow_hooks")).default, "default_arrow_hooks.tsx", "default");
      expectHookComponent((await import("./local_var_hooks")).LocalVar, "local_var_hooks.tsx", "LocalVar");
      expectHookComponent((await import("./local_const_hooks")).LocalConst, "local_const_hooks.tsx", "LocalConst");
      await import("./non_exported_hooks");

      console.log("PASS");
    `,
    "default_unnamed.tsx": `
      export default function() {
        return <div></div>;
      }
    `,
    "default_named.tsx": `
      export default function Hello() {
        return <div></div>;
      }
    `,
    "default_arrow.tsx": `
      export default () => {
        return <div></div>;
      }
    `,
    "local_var.tsx": `
      export var LocalVar = () => {
        return <div></div>;
      }
    `,
    "local_const.tsx": `
      export const LocalConst = () => {
        return <div></div>;
      }
    `,
    "non_exported.tsx": `
      import { expectComponent } from 'bun-devserver-react-mock';

      function NonExportedFunc() {
        return <div></div>;
      }

      const NonExportedVar = () => {
        return <div></div>;
      }

      // Anonymous function with name
      const NonExportedAnon = (function MyNamedAnon() {
        return <div></div>;
      });

      // Anonymous function without name
      const NonExportedAnonUnnamed = (function() {
        return <div></div>;
      });

      expectComponent(NonExportedFunc, "non_exported.tsx", "NonExportedFunc");
      expectComponent(NonExportedVar, "non_exported.tsx", "NonExportedVar");
      expectComponent(NonExportedAnon, "non_exported.tsx", "NonExportedAnon");
      expectComponent(NonExportedAnonUnnamed, "non_exported.tsx", "NonExportedAnonUnnamed");
    `,
    "default_unnamed_hooks.tsx": `
      import { useState } from "react";
      export default function() {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      }
    `,
    "default_named_hooks.tsx": `
      import { useState } from "react";
      export default function Hello() {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      }
    `,
    "default_arrow_hooks.tsx": `
      import { useState } from "react";
      export default () => {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      }
    `,
    "local_var_hooks.tsx": `
      import { useState } from "react";
      export var LocalVar = () => {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      }
    `,
    "local_const_hooks.tsx": `
      import { useState } from "react";
      export const LocalConst = () => {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      }
    `,
    "non_exported_hooks.tsx": `
      import { useState } from "react";
      import { expectHookComponent } from 'bun-devserver-react-mock';

      function NonExportedFunc() {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      }

      const NonExportedVar = () => {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      }

      // Anonymous function with name
      const NonExportedAnon = (function MyNamedAnon() {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      });

      // Anonymous function without name
      const NonExportedAnonUnnamed = (function() {
        const [count, setCount] = useState(0);
        return <div>{count}</div>;
      });

      expectHookComponent(NonExportedFunc, "non_exported_hooks.tsx", "NonExportedFunc");
      expectHookComponent(NonExportedVar, "non_exported_hooks.tsx", "NonExportedVar");
      expectHookComponent(NonExportedAnon, "non_exported_hooks.tsx", "NonExportedAnon");
      expectHookComponent(NonExportedAnonUnnamed, "non_exported_hooks.tsx", "NonExportedAnonUnnamed");
    `,
  },
  async test(dev) {
    await using c = await dev.client("/");
    await c.expectMessage("PASS");
  },
});
devTest("two functions with hooks should be independently tracked", {
  framework: minimalFramework,
  files: {
    ...reactAndRefreshStub,
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.tsx"],
    }),
    "index.tsx": `
      import { useState } from "react";
      import { expectHook } from 'bun-devserver-react-mock';

      function method1() {
        const _ = useState(1);
      }
      const method2 = function method2() {
        const _ = useState(2);
      }
      const method3 = () => {
        const _ = useState(3);
      }

      expectHook(method1);
      expectHook(method2);
      expectHook(method3);

      console.log("PASS");
    `,
  },
  async test(dev) {
    await using c = await dev.client("/", {});
    await c.expectMessage("PASS");
  },
});
devTest("custom hook tracking", {
  framework: minimalFramework,
  files: {
    ...reactAndRefreshStub,
    "index.html": emptyHtmlFile({
      styles: [],
      scripts: ["index.tsx"],
    }),
    "index.tsx": `
      import { useCustom1, useCustom2 } from "./custom-hook";
      import { expectHook, getCustomHooks } from 'bun-devserver-react-mock';

      function method1() {
        const _ = useCustom1();
      }
      function method2() {
        const _ = useCustom1();
      }
      function method3() {
        const _ = useCustom2();
      }
      function method4() {
        const a = useCustom1();
        const b = useCustom2();
      }

      const hash1 = expectHook(method1);
      const hash2 = expectHook(method2);
      const hash3 = expectHook(method3);
      const hash4 = expectHook(method4);

      if (hash1 !== hash2) throw new Error("hash1 and hash2 should be the same: " + hash1 + " " + hash2);
      if (hash1 === hash3) throw new Error("hash1 and hash3 should be different: " + hash1 + " " + hash3);
      if (hash1 === hash4) throw new Error("hash1 and hash4 should be different: " + hash1 + " " + hash4);
      if (hash3 === hash4) throw new Error("hash3 and hash4 should be different: " + hash3 + " " + hash4);

      const customHooks1 = getCustomHooks(method1);
      const customHooks2 = getCustomHooks(method2);
      const customHooks3 = getCustomHooks(method3);

      function assertCustomHooks(method, expected) {
        const customHooks = getCustomHooks(method);
        if (customHooks.length !== expected.length) throw new Error("customHooks should have " + expected.length + " hooks: " + customHooks.length);
        for (let i = 0; i < expected.length; i++) {
          if (customHooks[i] !== expected[i]) throw new Error(\`customHooks[\${i}] should be \${expected[i]} but got \${customHooks[i]}\`);
        }
      }

      assertCustomHooks(method1, [useCustom1]);
      assertCustomHooks(method2, [useCustom1]);
      assertCustomHooks(method3, [useCustom2]);
      assertCustomHooks(method4, [useCustom1, useCustom2]);

      console.log("PASS");
    `,
    "custom-hook.ts": `
      export function useCustom1() {
        return 1;
      }
      export function useCustom2() {
        return 2;
      }
    `,
  },

  async test(dev) {
    await using c = await dev.client("/", {});
    await c.expectMessage("PASS");
  },
});

devTest("react component with hooks and mutual recursion renders without error", {
  files: {
    ...reactAndRefreshStub,
    "index.tsx": `
      import ComponentWithConst, { helper } from './component-with-const';
      import ComponentWithLet, { getCounter } from './component-with-let';
      import ComponentWithVar, { getGlobalState } from './component-with-var';
      import MathComponent, { utilityFunction } from './component-with-function';
      import ProcessorComponent, { DataProcessor } from './component-with-class';
      
      function useThis() {
        return null;
      }

      function useFakeState(initial) {
        return [initial, () => {}];
      }

      function useFakeEffect(fn) {
        fn();
      }

      export default function AA({ depth = 0 }: { depth: number }) {
        const [count, setCount] = useFakeState(0);
        useThis();
        useFakeEffect(() => {});
        return depth === 0 && <B />
      }

      function B() {
        const [value, setValue] = useFakeState(42);
        useFakeEffect(() => {});
        return <AA depth={1} />
      }

      // Call B outside the function body to test statement -> expression transform
      B();
      
      // Call all imported default functions outside their bodies
      ComponentWithConst();
      ComponentWithLet();
      ComponentWithVar();
      MathComponent({ input: 10 });
      ProcessorComponent({ text: "test" });
      
      // Use all the imported components and their non-default exports
      console.log("ComponentWithConst:", ComponentWithConst());
      console.log("helper:", helper());
      
      console.log("ComponentWithLet:", ComponentWithLet());
      console.log("getCounter:", getCounter());
      
      console.log("ComponentWithVar:", ComponentWithVar());
      console.log("getGlobalState:", getGlobalState());
      
      console.log("MathComponent:", MathComponent({ input: 10 }));
      console.log("utilityFunction:", utilityFunction(15));
      
      console.log("ProcessorComponent:", ProcessorComponent({ text: "test" }));
      const processor = new DataProcessor();
      console.log("DataProcessor:", processor.process("world"));
      
      console.log("PASS");
    `,
    "component-with-const.tsx": `
      const helperValue = "helper-result";
      
      function useFakeState(initial) {
        return [initial, () => {}];
      }

      function useFakeCallback(fn) {
        return fn;
      }
      
      export default function Component() {
        const [state, setState] = useFakeState(helperValue);
        const [count, setCount] = useFakeState(0);
        const callback = useFakeCallback(() => {});
        return helperValue;
      }
      
      export const helper = () => helperValue;
      
      // Call Component outside its body to test statement -> expression transform
      Component();
      const result1 = Component();
      helper();
    `,
    "component-with-let.tsx": `
      let counter = 0;
      
      function useFakeState(initial) {
        return [initial, () => {}];
      }

      function useFakeEffect(fn, deps) {
        fn();
      }

      function useFakeMemo(fn, deps) {
        return fn();
      }
      
      export default function Counter() {
        const [localCount, setLocalCount] = useFakeState(0);
        const [multiplier, setMultiplier] = useFakeState(1);
        useFakeEffect(() => {
          setLocalCount(counter * multiplier);
        }, [multiplier]);
        const memoized = useFakeMemo(() => counter * 2, [counter]);
        return ++counter;
      }
      
      export const getCounter = () => counter;
      
      // Call Counter outside its body multiple times
      Counter();
      Counter();
      const currentCount = Counter();
      getCounter();
      
      // Test with different call patterns
      [1, 2, 3].forEach(() => Counter());
      const counters = [Counter, Counter, Counter].map(fn => fn());
    `,
    "component-with-var.tsx": `
      var globalState = { value: 42 };
      
      function useFakeState(initial) {
        return [initial, () => {}];
      }

      function useFakeMemo(fn, deps) {
        return fn();
      }

      function useFakeRef(initial) {
        return { current: initial };
      }
      
      export default function StateComponent() {
        const [localState, setLocalState] = useFakeState(globalState.value);
        const [factor, setFactor] = useFakeState(2);
        const computed = useFakeMemo(() => localState * factor, [localState, factor]);
        const ref = useFakeRef(null);
        return globalState.value;
      }
      
      export const getGlobalState = () => globalState;
      
      // Call StateComponent outside its body
      StateComponent();
      const state1 = StateComponent();
      const state2 = StateComponent();
      getGlobalState();
      
      // Test with object method calls
      const obj = { fn: StateComponent };
      obj.fn();
      
      // Test with array of functions
      const fns = [StateComponent, getGlobalState];
      fns[0]();
      fns[1]();
    `,
    "component-with-function.tsx": `
      function multiply(x: number) {
        return x * 2;
      }
      
      function useFakeState(initial) {
        return [initial, () => {}];
      }

      function useFakeCallback(fn, deps) {
        return fn;
      }

      function useFakeReducer(reducer, initial) {
        return [initial, () => {}];
      }
      
      export default function MathComponent({ input }: { input: number }) {
        const [result, setResult] = useFakeState(0);
        const [operations, setOperations] = useFakeState(0);
        const [state, dispatch] = useFakeReducer((s, a) => s, {});
        
        const calculate = useFakeCallback(() => {
          const value = multiply(input);
          setResult(value);
          setOperations(prev => prev + 1);
          return value;
        }, [input]);
        
        return multiply(input);
      }
      
      export const utilityFunction = multiply;
      
      // Call MathComponent outside its body with various patterns
      MathComponent({ input: 5 });
      MathComponent({ input: 10 });
      const result1 = MathComponent({ input: 15 });
      utilityFunction(20);
      
      // Test with function composition
      const compose = (fn: Function) => fn({ input: 25 });
      compose(MathComponent);
      
      // Test with conditional calls
      const shouldCall = true;
      if (shouldCall) {
        MathComponent({ input: 30 });
      }
      
      // Test with ternary
      const ternaryResult = true ? MathComponent({ input: 35 }) : null;
      
      // Test with logical operators
      true && MathComponent({ input: 40 });
      false || MathComponent({ input: 45 });
    `,
    "component-with-class.tsx": `
      class Processor {
        process(data: string) {
          return data.toUpperCase();
        }
      }
      
      function useFakeState(initial) {
        return [initial, () => {}];
      }

      function useFakeReducer(reducer, initial) {
        return [initial, () => {}];
      }

      function useFakeRef(initial) {
        return { current: initial };
      }

      function useFakeContext() {
        return {};
      }
      
      const reducer = (state: any, action: any) => {
        switch (action.type) {
          case 'process':
            return { ...state, processed: action.payload };
          default:
            return state;
        }
      };
      
      export default function ProcessorComponent({ text }: { text: string }) {
        const [state, setState] = useFakeState({ text, processed: '' });
        const [history, dispatch] = useFakeReducer(reducer, { processed: [] });
        const processorRef = useFakeRef(new Processor());
        const context = useFakeContext();
        
        const processor = new Processor();
        const result = processor.process(text);
        
        dispatch({ type: 'process', payload: result });
        
        return processor.process(text);
      }
      
      export const DataProcessor = Processor;
      
      // Call ProcessorComponent outside its body
      ProcessorComponent({ text: "hello" });
      ProcessorComponent({ text: "world" });
      const processed1 = ProcessorComponent({ text: "test1" });
      const processed2 = ProcessorComponent({ text: "test2" });
      
      // Test with new DataProcessor
      const proc1 = new DataProcessor();
      const proc2 = new DataProcessor();
      proc1.process("data1");
      proc2.process("data2");
      
      // Test with function binding
      const boundProcessor = ProcessorComponent.bind(null);
      boundProcessor({ text: "bound" });
      
      // Test with apply/call
      ProcessorComponent.call(null, { text: "called" });
      ProcessorComponent.apply(null, [{ text: "applied" }]);
      
      // Test with destructuring
      const { process } = new DataProcessor();
      
      // Test with spread operator
      const args = [{ text: "spread" }];
      ProcessorComponent(...args);
    `,
    "index.html": emptyHtmlFile({
      scripts: ["index.tsx"],
      body: `<div id="root"></div>`,
    }),
  },
  async test(dev) {
    await using c = await dev.client("/", {});
    await c.expectMessage(
      "ComponentWithConst:",
      "helper:",
      "ComponentWithLet:",
      "getCounter:",
      "ComponentWithVar:",
      "getGlobalState:",
      "MathComponent:",
      "utilityFunction:",
      "ProcessorComponent:",
      "DataProcessor:",
      "PASS",
    );
  },
});
