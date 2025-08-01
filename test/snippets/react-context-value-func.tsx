// @ts-nocheck
import React from "react";

const Context = React.createContext({});

const ContextProvider = ({ children }) => {
  const [cb, setCB] = React.useState(function () {});
  const foo = true;

  return <Context.Provider value={cb}>{children(foo)}</Context.Provider>;
};

const ContextValue = () => (
  <Context.Consumer>
    {foo => {
      if (foo) {
        return <div>Worked!</div>;
      }

      throw `Value "${foo}"" should be true`;
    }}
  </Context.Consumer>
);

const TestComponent = () => (
  <ContextProvider>
    <ContextValue />
  </ContextProvider>
);

export function test() {
  const foo = <TestComponent />;

  return testDone(import.meta.url);
}
