import { Suspense, lazy, useEffect, useState } from "react";
import { ComponentInAnotherFile1, MyList } from "./Component";
import { Item } from "./Item";

try {
  const x = <div>hello</div>;
  if (x.$$typeof !== Symbol.for("react.element")) {
    throw new Error("jsx element is not a react element");
  }
  if (x.type !== "div") {
    throw new Error("jsx element type is not div");
  }
  if (x.props.children !== "hello") {
    throw new Error("jsx element children is not set correctly");
  }
} catch (error) {
  console.log(
    "jsx element error. check the compilation of the above for if it is using jsxDEV in production, as react sets this to undefined to catch bundling errors.",
  );
}

const Lazy = lazy(() => import("./Lazy"));

const x = <div>static string</div>;

const dataArray = [1, 2, 3, 4, 5];

function ComponentInSameFile() {
  return <p className="same-file">Component in same file</p>;
}

function Loading(params) {
  console.log("render in <Loading/>");
  return <div>Loading...</div>;
}

export default function App() {
  console.log("render in <App/>", import.meta.url);
  const [count, setCount] = useState(0);
  useEffect(() => {
    console.log("useEffect1 in <App/>");
    return () => {
      console.log("useEffect1 cleanup in <App/>");
    };
  });
  useEffect(() => {
    console.log("useEffect2 in <App/>");
    return () => {
      console.log("useEffect2 cleanup in <App/>");
    };
  }, []);
  return (
    <div>
      <h1 className="title">Hello, world!</h1>
      <p className="class">React Application</p>
      {x}
      <p className="count">Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Increment</button>
      <ComponentInSameFile />
      <ComponentInAnotherFile1 />
      <MyList>
        {dataArray.map((item, i) => (
          <Item key={i + ""} />
        ))}
      </MyList>
      <Suspense fallback={<Loading />}>
        <Lazy />
      </Suspense>
    </div>
  );
}
