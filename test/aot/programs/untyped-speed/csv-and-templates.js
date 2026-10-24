// Text handled one character at a time and with regular expressions: a CSV parser that fills objects under computed names, and a template compiled into a closure that escapes HTML.
function parseLine(line) {
  var fields = [];
  var field = "";
  var quoted = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      fields.push(field);
      field = "";
    } else field += ch;
  }
  fields.push(field);
  return fields;
}

function parse(text) {
  var lines = text.split("\n");
  var header = parseLine(lines[0]);
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    var values = parseLine(lines[i]);
    var row = {};
    for (var j = 0; j < header.length; j++) row[header[j]] = values[j];
    rows.push(row);
  }
  return rows;
}

var escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, function (ch) {
    return escapes[ch];
  });
}

function compile(template) {
  var parts = template.split(/\{\{\s*([\w.]+)\s*\}\}/);
  return function (data) {
    var out = parts[0];
    for (var i = 1; i < parts.length; i += 2) {
      var value = data;
      var path = parts[i].split(".");
      for (var j = 0; j < path.length && value != null; j++) value = value[path[j]];
      out += escapeHtml(value == null ? "" : value) + parts[i + 1];
    }
    return out;
  };
}

function run(rounds) {
  var text = 'id,name,city,note\n1,Ann,"Paris, FR",plain\n2,"Bob ""B""",Oslo,<b>bold</b>\n3,Cy,Rome,"a & b"\n4,Di,,\n';
  var render = compile("<li id={{ row.id }}>{{row.name}} of {{ row.city }}: {{row.note}} ({{ meta.round }})</li>");
  var total = 0;
  for (var round = 0; round < rounds; round++) {
    var rows = parse(text);
    var meta = { round: round & 15 };
    for (var i = 0; i < rows.length; i++) total += render({ row: rows[i], meta: meta }).length;
    total += rows
      .map(function (row) {
        return row.name.toUpperCase();
      })
      .join("|").length;
  }
  return total;
}

console.log(run(60000));
