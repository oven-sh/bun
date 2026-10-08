function foo() {
  throw <Bar />;
}

function foo() {
  throw <Bar>baz</Bar>;
}

function foo() {
  throw <Bar baz={baz} />;
}

function foo() {
  throw <Bar baz={baz}>foo</Bar>;
}

function foo() {
  throw <></>;
}

function foo() {
  throw <>foo</>;
}
