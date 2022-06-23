var _tmpl = template("<div</div>", 2), _tmpl$1 = template("<div/>", 0);
const template1 = () => {
  var _tmpl = _tmpl.cloneNode(true);
  insert(_tmpl, simple, null);
  return _tmpl;
};
const template2 = () => {
  var _tmpl = _tmpl.cloneNode(true);
  insert(_tmpl, state.dynamic, null);
  return _tmpl;
};
const template3 = () => {
  var _tmpl = _tmpl.cloneNode(true);
  insert(_tmpl, simple ? good : bad, null);
  return _tmpl;
};
const template4 = () => {
  var _tmpl = _tmpl.cloneNode(true);
  insert(_tmpl, simple ? good() : bad, null);
  return _tmpl;
};
const template5 = () => {
  var _tmpl = _tmpl.cloneNode(true);
  insert(_tmpl, state.dynamic ? good() : bad, null);
  return _tmpl;
};
const template6 = () => {
  var _tmpl = _tmpl.cloneNode(true);
  insert(_tmpl, state.dynamic && good(), null);
  return _tmpl;
};
const template7 = () => {
  var _tmpl = _tmpl.cloneNode(true);
  insert(_tmpl, state.count > 5 ? state.dynamic ? best : good() : bad, null);
  return _tmpl;
};
const template8 = () => {
  var _tmpl = _tmpl.cloneNode(true);
  insert(_tmpl, state.dynamic && state.something && good(), null);
  return _tmpl;
};
const template9 = () => {
  var _tmpl = _tmpl.cloneNode(true);
  insert(_tmpl, state.dynamic && good() || bad, null);
  return _tmpl;
};
const template10 = () => {
  var _tmpl = _tmpl.cloneNode(true);
  insert(_tmpl, state.a ? "a" : state.b ? "b" : state.c ? "c" : "fallback", null);
  return _tmpl;
};
const template11 = () => {
  var _tmpl = _tmpl.cloneNode(true);
  insert(_tmpl, state.a ? a() : state.b ? b() : state.c ? "c" : "fallback", null);
  return _tmpl;
};
const template12 = createComponent(Comp, {
  render: state.dynamic ? good() : bad
});
const template13 = createComponent(Comp, {
  render: state.dynamic ? good : bad
});
const template14 = createComponent(Comp, {
  render: state.dynamic && good()
});
const template15 = createComponent(Comp, {
  render: state.dynamic && good
});
const template16 = createComponent(Comp, {
  render: state.dynamic || good()
});
const template17 = createComponent(Comp, {
  render: state.dynamic ? createComponent(Comp, {}) : createComponent(Comp, {})
});
const template18 = createComponent(Comp, {
  get children: [
    state.dynamic ? createComponent(Comp, {}) : createComponent(Comp, {})
  ]
});
const template19 = () => {
  var _el = _tmpl$1.cloneNode(true);
  effect(() => {
    return setAttribute(_el, "innerHTML", state.dynamic ? createComponent(Comp, {}) : createComponent(Comp, {}));
  });
  return _el;
};
const template20 = () => {
  var _tmpl = _tmpl.cloneNode(true);
  insert(_tmpl, state.dynamic ? createComponent(Comp, {}) : createComponent(Comp, {}), null);
  return _tmpl;
};
const template21 = createComponent(Comp, {
  render: state?.dynamic ? "a" : "b"
});
const template22 = createComponent(Comp, {
  get children: [
    state?.dynamic ? "a" : "b"
  ]
});
const template23 = () => {
  var _el = _tmpl$1.cloneNode(true);
  effect(() => {
    return setAttribute(_el, "innerHTML", state?.dynamic ? "a" : "b");
  });
  return _el;
};
const template24 = () => {
  var _tmpl = _tmpl.cloneNode(true);
  insert(_tmpl, state?.dynamic ? "a" : "b", null);
  return _tmpl;
};
const template25 = createComponent(Comp, {
  render: state.dynamic ?? createComponent(Comp, {})
});
const template26 = createComponent(Comp, {
  get children: [
    state.dynamic ?? createComponent(Comp, {})
  ]
});
const template27 = () => {
  var _el = _tmpl$1.cloneNode(true);
  effect(() => {
    return setAttribute(_el, "innerHTML", state.dynamic ?? createComponent(Comp, {}));
  });
  return _el;
};
const template28 = () => {
  var _tmpl = _tmpl.cloneNode(true);
  insert(_tmpl, state.dynamic ?? createComponent(Comp, {}), null);
  return _tmpl;
};
const template29 = () => {
  var _tmpl = _tmpl.cloneNode(true);
  insert(_tmpl, (thing() && thing1()) ?? thing2() ?? thing3(), null);
  return _tmpl;
};
const template30 = () => {
  var _tmpl = _tmpl.cloneNode(true);
  insert(_tmpl, thing() || thing1() || thing2(), null);
  return _tmpl;
};
const template31 = createComponent(Comp, {
  value: count() ? count() ? count() : count() : count()
});
