({
  processors: [
    require("autoprefixer", {
      browsers: ["> 1%", "last 2 versions", "ie >= 11", "Firefox ESR"]
    }),
    require("postcss-url")({
      url: url =>
        url.startsWith("/") || /^[a-z]+:/.test(url) ? url : `/static/${url}`
    })
  ]
});

true
  ? test({
      a: 1
    })
  : <div
      a={123412342314}
      b={123412341234}
      c={123412341234}
      d={123412341234}
      e={123412341234}
      f={123412341234}
      g={123412341234}
    />;
