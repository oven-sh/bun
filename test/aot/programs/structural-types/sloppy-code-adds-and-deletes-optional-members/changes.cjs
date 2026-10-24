exports.addSize = function (settings, value) {
  settings.size = value;
  return settings.size;
};

exports.dropSize = function (settings) {
  return delete settings.size;
};

exports.dropTheme = function (settings) {
  return delete settings.theme;
};

exports.defaultSize = function (settings, value) {
  return (settings.size ??= value);
};

exports.addMany = function (list, value) {
  var added = 0;
  for (var i = 0; i < list.length; i++) {
    list[i].size = value;
    if ("size" in list[i]) added++;
  }
  return added;
};
