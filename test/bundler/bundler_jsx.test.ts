import assert from "assert";
import dedent from "dedent";
import { itBundled, testForFile } from "./expectBundled";
var { describe, test, expect } = testForFile(import.meta.path);

const helpers = {
  "/node_modules/bun-test-helpers/index.js": `
    export function print(arg) {
      const replacer = (_, val) => {
        if(typeof val === "function") {
          if(val.name) return 'Function:' + val.name;
          return val.toString();
        }
        if(typeof val === "symbol") return val.toString();
        if(val === undefined) return "undefined";
        if(val === null) return "null";
        return val;
      }
      const stringified = JSON.stringify(arg, replacer);
      if(!process.env.IS_TEST_RUNNER) {
        console.log(arg);
      }
      console.log(stringified);
    }
  `,
  "/node_modules/react/jsx-dev-runtime.js": /* js */ `
    const $$typeof = Symbol.for("react.element");
    export function jsxDEV(type, props, key, source, self) {
      return {
        $$typeof, type, props, key, source, self
      } 
    }

  `,
};

describe("bundler", () => {
  itBundled("jsx/JSXDev", {
    files: {
      "index.jsx": /* js*/ `
        import { print } from 'bun-test-helpers'
        const Component = 'hello'
        print(<div>Hello World</div>)
        print(<div className="container"><Component prop={2}><h1 onClick={() => 1}>hello</h1></Component></div>)
      `,
      ...helpers,
    },
    platform: "bun",
    run: {
      stdout: `
        {"$$typeof":"Symbol(react.element)","type":"div","props":{"children":"Hello World"},"key":"undefined","source":false,"self":"undefined"}
        {"$$typeof":"Symbol(react.element)","type":"div","props":{"className":"container","children":{"$$typeof":"Symbol(react.element)","type":"hello","props":{"prop":2,"children":{"$$typeof":"Symbol(react.element)","type":"h1","props":{"onClick":"() => 1","children":"hello"},"key":"undefined","source":false,"self":"undefined"}},"key":"undefined","source":false,"self":"undefined"}},"key":"undefined","source":false,"self":"undefined"}
      `,
    },
  });
  itBundled("jsx/JSXProduction", {
    files: {
      "index.jsx": /* js*/ `
        import { print } from 'bun-test-helpers'
        function Component() {
          return <div>hello</div>
        }
        print(<div>Hello World</div>)
        print(<div className="container"><Component prop={2}><h1 onClick={() => 1}>hello</h1></Component></div>)
      `,
      ...helpers,
    },
    platform: "bun",
    env: {
      NODE_ENV: "production",
    },
    run: {
      stdout: `
        {"$$typeof":"Symbol(react.element)","type":"div","key":"null","ref":"null","props":{"children":"Hello World"},"_owner":"null"}
        {"$$typeof":"Symbol(react.element)","type":"div","key":"null","ref":"null","props":{"className":"container","children":{"$$typeof":"Symbol(react.element)","type":"Function:Component","key":"null","ref":"null","props":{"prop":2,"children":{"$$typeof":"Symbol(react.element)","type":"h1","key":"null","ref":"null","props":{"onClick":"Function:onClick","children":"hello"},"_owner":"null"}},"_owner":"null"}},"_owner":"null"}
      `,
    },
  });
});
