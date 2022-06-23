var _tmpl$1 = _template$('<svg width="400" height="180"><rect stroke-width="2" x="50" y="20" rx="20" ry="20" width="150" height="150"/><linearGradient gradientTransform="rotate(25)"><stop offset="0%"/></linearGradient></svg>', 4), _tmpl$2 = _template$('<svg width="400" height="180"><rect rx="20" ry="20" width="150" height="150"/></svg>', 2), _tmpl$3 = _template$('<svg width="400" height="180"><rect/></svg>', 2), _tmpl$4 = _template$('<rect x="50" y="20" width="150" height="150"/>', 0), _tmpl$5 = _template$('<svg viewBox="0 0 160 40" xmlns="http://www.w3.org/2000/svg"><a><text x="10" y="25">MDN Web Docs</text></a></svg>', 6), _tmpl$6 = _template$('<svg viewBox="0 0 160 40" xmlns="http://www.w3.org/2000/svg"><text x="10" y="25"/></svg>', 2);
const template = _tmpl$1.cloneNode(true);
const template2 = () => {
  var _el = _tmpl$1.cloneNode(true);
  effect(() => {
    return setAttribute(_el, "className", state.name);
  });
  effect(() => {
    return setAttribute(_el, "stroke-width", state.width);
  });
  effect(() => {
    return setAttribute(_el, "x", state.x);
  });
  effect(() => {
    return setAttribute(_el, "y", state.y);
  });
  ;
  return _el;
};
const template3 = _tmpl$3.cloneNode(true);
const template4 = _tmpl$4.cloneNode(true);
const template5 = ;
const template6 = createComponent(Component, {});
const template7 = () => {
  var _el = _tmpl$4.cloneNode(true);
  setAttribute(_el, "xlink:href", url);
  return _el;
};
const template8 = () => {
  var _el = _tmpl$5.cloneNode(true);
  setAttribute(_el, "textContent", text);
  return _el;
};
