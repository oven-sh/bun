function helloWorld() {
  useEffect(() => {
    // do something
  }, [props.value])
  useEffect(() => {
    // do something
  }, [props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value])
}

function helloWorldWithReact() {
  React.useEffect(() => {
    // do something
  }, [props.value])
  React.useEffect(() => {
    // do something
  }, [props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value])
}

function MyComponent(props) {
  useEffect(
    () => {
      console.log("some code", props.foo);
    },

    // We need to disable the eslint warning here,
    // because of some complicated reason.
    // eslint-disable line react-hooks/exhaustive-deps
    []
  );

  return null;
}

function Comp1() {
  const { firstName, lastName } = useMemo(
    () => parseFullName(fullName),
    [fullName],
  );
}

function Comp2() {
  const { firstName, lastName } = useMemo(
    () => func(),
    [props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value]
  )
}

function Comp3() {
  const { firstName, lastName } = useMemo(
    (aaa, bbb, ccc, ddd, eee, fff, ggg, hhh, iii, jjj, kkk) => func(aaa, bbb, ccc, ddd, eee, fff, ggg, hhh, iii, jjj, kkk),
    [foo, bar, baz]
  );
}

function Comp4() {
  const { firstName, lastName } = useMemo(
    () => foo && bar && baz || baz || foo && baz(foo) + bar(foo) + foo && bar && baz || baz || foo && baz(foo) + bar(foo),
    [foo, bar, baz]
  )
}

function Comp5() {
  const { firstName, lastName } = useMemo(() => func(), [foo]);
}

function Component1() {
  useImperativeHandle(ref, () => {
    /* Function body */
  }, []);
  useImperativeHandle(ref, () => {
    /* Function body */
  }, [props.value]);
  useImperativeHandle(ref, () => {
    /* Function body */
  }, [props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value]);
}

function Component2() {
  React.useImperativeHandle(ref, () => {
    /* Function body */
  }, []);
  React.useImperativeHandle(ref, () => {
    /* Function body */
  }, [props.value]);
  React.useImperativeHandle(ref, () => {
    /* Function body */
  }, [props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value, props.value]);
}

function Component3() {
  useImperativeHandle(
    ref,
    () => {
      /* Function body */
    },
    [],
  );
}
