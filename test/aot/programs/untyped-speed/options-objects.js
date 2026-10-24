// Options objects completed from defaults in four ways: field by field, with Object.assign, with object spread, and with a `for in` copy of every argument. The options may be undefined.
var defaults = { width: 80, indent: 2, tabs: false, newline: "\n", limit: 1000 };

function withDefaults(options) {
  options = options || {};
  return {
    width: options.width !== undefined ? options.width : defaults.width,
    indent: options.indent || defaults.indent,
    tabs: !!options.tabs,
    newline: options.newline || defaults.newline,
    limit: options.limit == null ? defaults.limit : options.limit,
  };
}

function merged(options) {
  return Object.assign({}, defaults, options);
}

function spreadOver(options) {
  return { ...defaults, ...options, seen: true };
}

function extend(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i];
    for (var key in source) target[key] = source[key];
  }
  return target;
}

function measure(options) {
  return options.width + options.indent * 3 + (options.tabs ? 5 : 0) + options.newline.length + options.limit;
}

function layout(text, options) {
  var settings = withDefaults(options);
  return text.length * settings.indent + measure(settings);
}

function run(count) {
  var given = [undefined, { width: 100 }, { indent: 4, tabs: true }, { newline: "\r\n", limit: 0 }, {}];
  var total = 0;
  for (var i = 0; i < count; i++) {
    var options = given[i % 5];
    total += layout("line", options);
    if ((i & 3) === 0) total += measure(merged(options));
    if ((i & 3) === 1) total += measure(spreadOver(options));
    if ((i & 3) === 2) total += measure(extend({}, defaults, options, { limit: i & 7 }));
  }
  return total;
}

console.log(run(1200000));
