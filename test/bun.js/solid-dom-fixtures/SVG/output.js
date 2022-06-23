import { template as _$template } from "r-dom";
import { setAttributeNS as _$setAttributeNS } from "r-dom";
import { createComponent as _$createComponent } from "r-dom";
import { spread as _$spread } from "r-dom";
import { setAttribute as _$setAttribute } from "r-dom";
import { effect as _$effect } from "r-dom";

const _tmpl$ = /*#__PURE__*/ _$template(
    `<svg width="400" height="180"><rect stroke-width="2" x="50" y="20" rx="20" ry="20" width="150" height="150" style="fill:red;stroke:black;stroke-width:5;opacity:0.5"></rect><linearGradient gradientTransform="rotate(25)"><stop offset="0%"></stop></linearGradient></svg>`,
    8
  ),
  _tmpl$2 = /*#__PURE__*/ _$template(
    `<svg width="400" height="180"><rect rx="20" ry="20" width="150" height="150"></rect></svg>`,
    4
  ),
  _tmpl$3 = /*#__PURE__*/ _$template(
    `<svg width="400" height="180"><rect></rect></svg>`,
    4
  ),
  _tmpl$4 = /*#__PURE__*/ _$template(
    `<svg><rect x="50" y="20" width="150" height="150"></rect></svg>`,
    4,
    true
  ),
  _tmpl$5 = /*#__PURE__*/ _$template(
    `<svg viewBox="0 0 160 40" xmlns="http://www.w3.org/2000/svg"><a><text x="10" y="25">MDN Web Docs</text></a></svg>`,
    6
  ),
  _tmpl$6 = /*#__PURE__*/ _$template(
    `<svg viewBox="0 0 160 40" xmlns="http://www.w3.org/2000/svg"><text x="10" y="25"></text></svg>`,
    4
  );

const template = _tmpl$.cloneNode(true);

const template2 = (() => {
  const _el$2 = _tmpl$2.cloneNode(true),
    _el$3 = _el$2.firstChild;

  _el$3.style.setProperty("fill", "red");

  _el$3.style.setProperty("stroke", "black");

  _el$3.style.setProperty("opacity", "0.5");

  _$effect(
    (_p$) => {
      const _v$ = state.name,
        _v$2 = state.width,
        _v$3 = state.x,
        _v$4 = state.y,
        _v$5 = props.stroke;
      _v$ !== _p$._v$ && _$setAttribute(_el$3, "class", (_p$._v$ = _v$));
      _v$2 !== _p$._v$2 &&
        _$setAttribute(_el$3, "stroke-width", (_p$._v$2 = _v$2));
      _v$3 !== _p$._v$3 && _$setAttribute(_el$3, "x", (_p$._v$3 = _v$3));
      _v$4 !== _p$._v$4 && _$setAttribute(_el$3, "y", (_p$._v$4 = _v$4));
      _v$5 !== _p$._v$5 &&
        _el$3.style.setProperty("stroke-width", (_p$._v$5 = _v$5));
      return _p$;
    },
    {
      _v$: undefined,
      _v$2: undefined,
      _v$3: undefined,
      _v$4: undefined,
      _v$5: undefined,
    }
  );

  return _el$2;
})();

const template3 = (() => {
  const _el$4 = _tmpl$3.cloneNode(true),
    _el$5 = _el$4.firstChild;

  _$spread(_el$5, props, true, false);

  return _el$4;
})();

const template4 = _tmpl$4.cloneNode(true);

const template5 = _tmpl$4.cloneNode(true);

const template6 = _$createComponent(Component, {
  get children() {
    return _tmpl$4.cloneNode(true);
  },
});

const template7 = (() => {
  const _el$9 = _tmpl$5.cloneNode(true),
    _el$10 = _el$9.firstChild;

  _$setAttributeNS(_el$10, "http://www.w3.org/1999/xlink", "xlink:href", url);

  return _el$9;
})();

const template8 = (() => {
  const _el$11 = _tmpl$6.cloneNode(true),
    _el$12 = _el$11.firstChild;

  _el$12.textContent = text;
  return _el$11;
})();
