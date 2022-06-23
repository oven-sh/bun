const template1 = <div>{simple}</div>;

const template2 = <div>{state.dynamic}</div>;

const template3 = <div>{simple ? good : bad}</div>;

const template4 = <div>{simple ? good() : bad}</div>;

const template5 = <div>{state.dynamic ? good() : bad}</div>;

const template6 = <div>{state.dynamic && good()}</div>;

const template7 = (
  <div>{state.count > 5 ? (state.dynamic ? best : good()) : bad}</div>
);

const template8 = <div>{state.dynamic && state.something && good()}</div>;

const template9 = <div>{(state.dynamic && good()) || bad}</div>;

const template10 = (
  <div>{state.a ? "a" : state.b ? "b" : state.c ? "c" : "fallback"}</div>
);

const template11 = (
  <div>{state.a ? a() : state.b ? b() : state.c ? "c" : "fallback"}</div>
);

const template12 = <Comp render={state.dynamic ? good() : bad} />;

// no dynamic predicate
const template13 = <Comp render={state.dynamic ? good : bad} />;

const template14 = <Comp render={state.dynamic && good()} />;

// no dynamic predicate
const template15 = <Comp render={state.dynamic && good} />;

const template16 = <Comp render={state.dynamic || good()} />;

const template17 = <Comp render={state.dynamic ? <Comp /> : <Comp />} />;

const template18 = <Comp>{state.dynamic ? <Comp /> : <Comp />}</Comp>;

const template19 = <div innerHTML={state.dynamic ? <Comp /> : <Comp />} />;

const template20 = <div>{state.dynamic ? <Comp /> : <Comp />}</div>;

const template21 = <Comp render={state?.dynamic ? "a" : "b"} />;

const template22 = <Comp>{state?.dynamic ? "a" : "b"}</Comp>;

const template23 = <div innerHTML={state?.dynamic ? "a" : "b"} />;

const template24 = <div>{state?.dynamic ? "a" : "b"}</div>;

const template25 = <Comp render={state.dynamic ?? <Comp />} />;

const template26 = <Comp>{state.dynamic ?? <Comp />}</Comp>;

const template27 = <div innerHTML={state.dynamic ?? <Comp />} />;

const template28 = <div>{state.dynamic ?? <Comp />}</div>;

const template29 = <div>{(thing() && thing1()) ?? thing2() ?? thing3()}</div>;

const template30 = <div>{thing() || thing1() || thing2()}</div>;

const template31 = (
  <Comp value={count() ? (count() ? count() : count()) : count()} />
);
