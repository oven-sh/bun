import { template as _$template } from "r-dom";
import { effect as _$effect } from "r-dom";
import { getOwner as _$getOwner } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";

const _tmpl$ = /*#__PURE__*/ _$template(`<my-element></my-element>`, 2),
  _tmpl$2 = /*#__PURE__*/ _$template(
    `<my-element><header slot="head">Title</header></my-element>`,
    4
  ),
  _tmpl$3 = /*#__PURE__*/ _$template(`<slot name="head"></slot>`, 2);

const template = (() => {
  const _el$ = document.importNode(_tmpl$, true);

  _el$.someAttr = name;
  _el$.notprop = data;

  _$setAttribute(_el$, "my-attr", data);

  _el$.someProp = data;
  _el$._$owner = _$getOwner();
  return _el$;
})();

const template2 = (() => {
  const _el$2 = document.importNode(_tmpl$, true);

  _el$2._$owner = _$getOwner();

  _$effect(
    (_p$) => {
      const _v$ = state.name,
        _v$2 = state.data,
        _v$3 = state.data,
        _v$4 = state.data;
      _v$ !== _p$._v$ && (_el$2.someAttr = _p$._v$ = _v$);
      _v$2 !== _p$._v$2 && (_el$2.notprop = _p$._v$2 = _v$2);
      _v$3 !== _p$._v$3 && _$setAttribute(_el$2, "my-attr", (_p$._v$3 = _v$3));
      _v$4 !== _p$._v$4 && (_el$2.someProp = _p$._v$4 = _v$4);
      return _p$;
    },
    {
      _v$: undefined,
      _v$2: undefined,
      _v$3: undefined,
      _v$4: undefined,
    }
  );

  return _el$2;
})();

const template3 = (() => {
  const _el$3 = document.importNode(_tmpl$2, true);

  _el$3._$owner = _$getOwner();
  return _el$3;
})();

const template4 = (() => {
  const _el$4 = _tmpl$3.cloneNode(true);

  _el$4._$owner = _$getOwner();
  return _el$4;
})();
