// String methods as applications use them: replace with a regular expression and a callback, split and join, slice, indexOf, padding in a loop, and a query string parsed into an object.
function camelCase(name) {
  return name.replace(/[-_](\w)/g, function (match, letter) {
    return letter.toUpperCase();
  });
}

function dashed(name) {
  return name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

function padLeft(text, width, fill) {
  text = String(text);
  while (text.length < width) text = fill + text;
  return text;
}

function parseQuery(query) {
  var out = {};
  var pairs = query.split("&");
  for (var i = 0; i < pairs.length; i++) {
    var at = pairs[i].indexOf("=");
    if (at < 0) out[pairs[i]] = "";
    else out[pairs[i].slice(0, at)] = pairs[i].slice(at + 1);
  }
  return out;
}

function render(template, values) {
  return template.replace(/\{(\w+)\}/g, function (match, key) {
    return key in values ? values[key] : match;
  });
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function run(count) {
  var names = ["background-color", "border_top_width", "margin", "font-size-adjust"];
  var total = 0;
  for (var i = 0; i < count; i++) {
    var camel = camelCase(names[i & 3]);
    total += camel.length + dashed(camel).length;
    var query = parseQuery("id=" + i + "&name=" + camel + "&flag&page=" + (i % 9));
    total += query.id.length + query.page.charCodeAt(0);
    var line = render("{name}: {id} <{missing}> & {page}", query);
    total += escapeHtml(line).length + padLeft(i % 1000, 6, "0").length;
    var words = line.split(" ");
    total += words.join("+").length + words[0].trim().toUpperCase().lastIndexOf("R");
    if (/^\w+Color/.test(line)) total++;
  }
  return total;
}

console.log(run(150000));
