"use strict";
const internals = { H: null, A: null, T: null, S: null };
exports.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = internals;
exports.version = "19.2.0";
exports.createElement = function (type, config, ...children) {
  const props = {};
  let key = null;
  for (const name in config) {
    if (name === "key") key = "" + config.key;
    else props[name] = config[name];
  }
  if (children.length === 1) props.children = children[0];
  else if (children.length > 1) props.children = children;
  return { $$typeof: Symbol.for("react.transitional.element"), type, key, ref: props.ref !== undefined ? props.ref : null, props };
};
exports.createContext = function (value) {
  const context = { $$typeof: Symbol.for("react.context"), _currentValue: value, _currentValue2: value, _threadCount: 0, Provider: null, Consumer: null };
  context.Provider = context;
  context.Consumer = { $$typeof: Symbol.for("react.consumer"), _context: context };
  return context;
};
exports.memo = (type, compare) => ({ $$typeof: Symbol.for("react.memo"), type, compare: compare === undefined ? null : compare });
exports.useState = initial => internals.H.useState(initial);
exports.useReducer = (reducer, argument, init) => internals.H.useReducer(reducer, argument, init);
exports.useEffect = (create, deps) => internals.H.useEffect(create, deps);
exports.useLayoutEffect = (create, deps) => internals.H.useLayoutEffect(create, deps);
exports.useMemo = (create, deps) => internals.H.useMemo(create, deps);
exports.useCallback = (callback, deps) => internals.H.useCallback(callback, deps);
exports.useRef = initial => internals.H.useRef(initial);
exports.useContext = context => internals.H.useContext(context);
