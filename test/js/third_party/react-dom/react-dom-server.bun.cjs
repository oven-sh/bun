/**
 * @license React
 * react-dom-server.bun.production.min.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

"use strict";
var ba = require("react"),
  ca = require("react-dom");
function l(a, b) {
  0 !== b.length && a.write(b);
}
function da(a, b) {
  "function" === typeof a.error ? a.error(b) : a.close();
}
var r = Object.prototype.hasOwnProperty,
  ea =
    /^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/,
  fa = {},
  ha = {};
function ia(a) {
  if (r.call(ha, a)) return !0;
  if (r.call(fa, a)) return !1;
  if (ea.test(a)) return (ha[a] = !0);
  fa[a] = !0;
  return !1;
}
function t(a, b, c, d, e, f, g) {
  this.acceptsBooleans = 2 === b || 3 === b || 4 === b;
  this.attributeName = d;
  this.attributeNamespace = e;
  this.mustUseProperty = c;
  this.propertyName = a;
  this.type = b;
  this.sanitizeURL = f;
  this.removeEmptyString = g;
}
var v = {},
  ja =
    "children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(
      " ",
    );
ja.push("innerText", "textContent");
ja.forEach(function (a) {
  v[a] = new t(a, 0, !1, a, null, !1, !1);
});
[
  ["acceptCharset", "accept-charset"],
  ["className", "class"],
  ["htmlFor", "for"],
  ["httpEquiv", "http-equiv"],
].forEach(function (a) {
  var b = a[0];
  v[b] = new t(b, 1, !1, a[1], null, !1, !1);
});
["contentEditable", "draggable", "spellCheck", "value"].forEach(function (a) {
  v[a] = new t(a, 2, !1, a.toLowerCase(), null, !1, !1);
});
["autoReverse", "externalResourcesRequired", "focusable", "preserveAlpha"].forEach(function (a) {
  v[a] = new t(a, 2, !1, a, null, !1, !1);
});
"allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope"
  .split(" ")
  .forEach(function (a) {
    v[a] = new t(a, 3, !1, a.toLowerCase(), null, !1, !1);
  });
["checked", "multiple", "muted", "selected"].forEach(function (a) {
  v[a] = new t(a, 3, !0, a, null, !1, !1);
});
["capture", "download"].forEach(function (a) {
  v[a] = new t(a, 4, !1, a, null, !1, !1);
});
["cols", "rows", "size", "span"].forEach(function (a) {
  v[a] = new t(a, 6, !1, a, null, !1, !1);
});
["rowSpan", "start"].forEach(function (a) {
  v[a] = new t(a, 5, !1, a.toLowerCase(), null, !1, !1);
});
var ka = /[\-:]([a-z])/g;
function la(a) {
  return a[1].toUpperCase();
}
"accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height"
  .split(" ")
  .forEach(function (a) {
    var b = a.replace(ka, la);
    v[b] = new t(b, 1, !1, a, null, !1, !1);
  });
"xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(function (a) {
  var b = a.replace(ka, la);
  v[b] = new t(b, 1, !1, a, "http://www.w3.org/1999/xlink", !1, !1);
});
["xml:base", "xml:lang", "xml:space"].forEach(function (a) {
  var b = a.replace(ka, la);
  v[b] = new t(b, 1, !1, a, "http://www.w3.org/XML/1998/namespace", !1, !1);
});
["tabIndex", "crossOrigin"].forEach(function (a) {
  v[a] = new t(a, 1, !1, a.toLowerCase(), null, !1, !1);
});
v.xlinkHref = new t("xlinkHref", 1, !1, "xlink:href", "http://www.w3.org/1999/xlink", !0, !1);
["src", "href", "action", "formAction"].forEach(function (a) {
  v[a] = new t(a, 1, !1, a.toLowerCase(), null, !0, !0);
});
var ma = {
    animationIterationCount: !0,
    aspectRatio: !0,
    borderImageOutset: !0,
    borderImageSlice: !0,
    borderImageWidth: !0,
    boxFlex: !0,
    boxFlexGroup: !0,
    boxOrdinalGroup: !0,
    columnCount: !0,
    columns: !0,
    flex: !0,
    flexGrow: !0,
    flexPositive: !0,
    flexShrink: !0,
    flexNegative: !0,
    flexOrder: !0,
    gridArea: !0,
    gridRow: !0,
    gridRowEnd: !0,
    gridRowSpan: !0,
    gridRowStart: !0,
    gridColumn: !0,
    gridColumnEnd: !0,
    gridColumnSpan: !0,
    gridColumnStart: !0,
    fontWeight: !0,
    lineClamp: !0,
    lineHeight: !0,
    opacity: !0,
    order: !0,
    orphans: !0,
    tabSize: !0,
    widows: !0,
    zIndex: !0,
    zoom: !0,
    fillOpacity: !0,
    floodOpacity: !0,
    stopOpacity: !0,
    strokeDasharray: !0,
    strokeDashoffset: !0,
    strokeMiterlimit: !0,
    strokeOpacity: !0,
    strokeWidth: !0,
  },
  na = ["Webkit", "ms", "Moz", "O"];
Object.keys(ma).forEach(function (a) {
  na.forEach(function (b) {
    b = b + a.charAt(0).toUpperCase() + a.substring(1);
    ma[b] = ma[a];
  });
});
var oa = /["'&<>]/;
function w(a) {
  if ("boolean" === typeof a || "number" === typeof a) return "" + a;
  a = "" + a;
  var b = oa.exec(a);
  if (b) {
    var c = "",
      d,
      e = 0;
    for (d = b.index; d < a.length; d++) {
      switch (a.charCodeAt(d)) {
        case 34:
          b = "&quot;";
          break;
        case 38:
          b = "&amp;";
          break;
        case 39:
          b = "&#x27;";
          break;
        case 60:
          b = "&lt;";
          break;
        case 62:
          b = "&gt;";
          break;
        default:
          continue;
      }
      e !== d && (c += a.substring(e, d));
      e = d + 1;
      c += b;
    }
    a = e !== d ? c + a.substring(e, d) : c;
  }
  return a;
}
var pa = /([A-Z])/g,
  qa = /^ms-/,
  ra = Array.isArray,
  x = Object.assign,
  y = null,
  sa = [],
  va = { preload: ta, preinit: ua };
function ta(a, b) {
  if (y) {
    var c = y;
    if ("string" === typeof a && a && "object" === typeof b && null !== b) {
      var d = b.as,
        e = c.preloadsMap.get(a);
      e ||
        (e = z(c, a, d, {
          href: a,
          rel: "preload",
          as: d,
          crossOrigin: "font" === d ? "" : b.crossOrigin,
          integrity: b.integrity,
        }));
      switch (d) {
        case "font":
          c.fontPreloads.add(e);
          break;
        case "style":
          c.explicitStylePreloads.add(e);
          break;
        case "script":
          c.explicitScriptPreloads.add(e);
      }
    }
  }
}
function ua(a, b) {
  if (y) {
    var c = y;
    if ("string" === typeof a && a && "object" === typeof b && null !== b)
      switch (b.as) {
        case "style":
          var d = c.stylesMap.get(a);
          d ||
            ((d = b.precedence || "default"),
            (d = wa(c, a, d, {
              rel: "stylesheet",
              href: a,
              "data-precedence": d,
              crossOrigin: b.crossOrigin,
            })));
          d.set.add(d);
          c.explicitStylePreloads.add(d.hint);
          break;
        case "script":
          (d = c.scriptsMap.get(a)),
            d ||
              ((d = xa(c, a, {
                src: a,
                async: !0,
                crossOrigin: b.crossOrigin,
                integrity: b.integrity,
              })),
              c.scripts.add(d));
      }
  }
}
function ya(a, b) {
  return {
    rel: "preload",
    as: "style",
    href: a,
    crossOrigin: b.crossOrigin,
    integrity: b.integrity,
    media: b.media,
    hrefLang: b.hrefLang,
    referrerPolicy: b.referrerPolicy,
  };
}
function za(a, b) {
  return {
    rel: "preload",
    as: "script",
    href: a,
    crossOrigin: b.crossOrigin,
    integrity: b.integrity,
    referrerPolicy: b.referrerPolicy,
  };
}
function z(a, b, c, d) {
  c = { type: "preload", as: c, href: b, flushed: !1, props: d };
  a.preloadsMap.set(b, c);
  return c;
}
function wa(a, b, c, d) {
  var e = a.stylesMap,
    f = a.preloadsMap,
    g = a.precedences,
    h = g.get(c);
  h || ((h = new Set()), g.set(c, h));
  (f = f.get(b))
    ? ((a = f.props),
      null == d.crossOrigin && (d.crossOrigin = a.crossOrigin),
      null == d.referrerPolicy && (d.referrerPolicy = a.referrerPolicy),
      null == d.title && (d.title = a.title))
    : ((f = ya(b, d)), (f = z(a, b, "style", f)), a.explicitStylePreloads.add(f));
  c = {
    type: "style",
    href: b,
    precedence: c,
    flushed: !1,
    inShell: !1,
    props: d,
    hint: f,
    set: h,
  };
  e.set(b, c);
  return c;
}
function xa(a, b, c) {
  var d = a.scriptsMap,
    e = a.preloadsMap.get(b);
  e
    ? ((a = e.props),
      null == c.crossOrigin && (c.crossOrigin = a.crossOrigin),
      null == c.referrerPolicy && (c.referrerPolicy = a.referrerPolicy),
      null == c.integrity && (c.integrity = a.integrity))
    : ((e = za(b, c)), (e = z(a, b, "script", e)), a.explicitScriptPreloads.add(e));
  c = { type: "script", src: b, flushed: !1, props: c, hint: e };
  d.set(b, c);
  return c;
}
function Aa(a, b) {
  if (!y) throw Error('"currentResources" was expected to exist. This is a bug in React.');
  var c = y;
  switch (a) {
    case "title":
      var d = b.children;
      Array.isArray(d) && 1 === d.length && (d = d[0]);
      if ("string" === typeof d || "number" === typeof d) {
        var e = "title::" + d;
        a = c.headsMap.get(e);
        a ||
          ((b = x({}, b)),
          (b.children = d),
          (a = { type: "title", props: b, flushed: !1 }),
          c.headsMap.set(e, a),
          c.headResources.add(a));
      }
      return !0;
    case "meta":
      if ("string" === typeof b.charSet) e = "charSet";
      else if ("string" === typeof b.content)
        if (((a = "::" + b.content), "string" === typeof b.httpEquiv)) e = "httpEquiv::" + b.httpEquiv + a;
        else if ("string" === typeof b.name) e = "name::" + b.name + a;
        else if ("string" === typeof b.itemProp) e = "itemProp::" + b.itemProp + a;
        else if ("string" === typeof b.property) {
          var f = b.property;
          e = "property::" + f + a;
          d = f;
          a = f.split(":").slice(0, -1).join(":");
          (a = c.structuredMetaKeys.get(a)) && (e = a.key + "::child::" + e);
        }
      e &&
        !c.headsMap.has(e) &&
        ((b = { type: "meta", key: e, props: x({}, b), flushed: !1 }),
        c.headsMap.set(e, b),
        "charSet" === e ? (c.charset = b) : (d && c.structuredMetaKeys.set(d, b), c.headResources.add(b)));
      return !0;
    case "base":
      return (
        (e = b.target),
        (d = b.href),
        (e =
          "base" +
          ("string" === typeof d ? '[href="' + d + '"]' : ":not([href])") +
          ("string" === typeof e ? '[target="' + e + '"]' : ":not([target])")),
        c.headsMap.has(e) ||
          ((b = { type: "base", props: x({}, b), flushed: !1 }), c.headsMap.set(e, b), c.bases.add(b)),
        !0
      );
  }
  return !1;
}
function Ba(a) {
  if (!y) throw Error('"currentResources" was expected to exist. This is a bug in React.');
  var b = y,
    c = a.rel,
    d = a.href;
  if (!d || "string" !== typeof d || !c || "string" !== typeof c) return !1;
  switch (c) {
    case "stylesheet":
      var e = a.onLoad,
        f = a.onError;
      c = a.precedence;
      var g = a.disabled;
      if ("string" !== typeof c || e || f || null != g)
        return (c = b.preloadsMap.get(d)), c || ((c = z(b, d, "style", ya(d, a))), b.usedStylePreloads.add(c)), !1;
      e = b.stylesMap.get(d);
      e ||
        ((a = x({}, a)),
        (a.href = d),
        (a.rel = "stylesheet"),
        (a["data-precedence"] = c),
        delete a.precedence,
        (e = wa(y, d, c, a)),
        b.usedStylePreloads.add(e.hint));
      b.boundaryResources ? b.boundaryResources.add(e) : e.set.add(e);
      return !0;
    case "preload":
      switch (((e = a.as), e)) {
        case "script":
        case "style":
        case "font":
          c = b.preloadsMap.get(d);
          if (!c)
            switch (
              ((a = x({}, a)),
              (a.href = d),
              (a.rel = "preload"),
              (a.as = e),
              "font" === e && (a.crossOrigin = ""),
              (c = z(b, d, e, a)),
              e)
            ) {
              case "script":
                b.explicitScriptPreloads.add(c);
                break;
              case "style":
                b.explicitStylePreloads.add(c);
                break;
              case "font":
                b.fontPreloads.add(c);
            }
          return !0;
      }
  }
  if (a.onLoad || a.onError) return !0;
  d =
    "rel:" +
    c +
    "::href:" +
    d +
    "::sizes:" +
    ("string" === typeof a.sizes ? a.sizes : "") +
    "::media:" +
    ("string" === typeof a.media ? a.media : "");
  e = b.headsMap.get(d);
  if (!e)
    switch (((e = { type: "link", props: x({}, a), flushed: !1 }), b.headsMap.set(d, e), c)) {
      case "preconnect":
      case "dns-prefetch":
        b.preconnects.add(e);
        break;
      default:
        b.headResources.add(e);
    }
  return !0;
}
function Ca(a, b) {
  var c = a.boundaryResources;
  c &&
    (b.forEach(function (a) {
      return c.add(a);
    }),
    b.clear());
}
function Da(a, b) {
  b.forEach(function (a) {
    return a.set.add(a);
  });
  b.clear();
}
var Ea = ca.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.Dispatcher,
  Fa = /(<\/|<)(s)(cript)/gi;
function Ga(a, b, c, d) {
  return "" + b + ("s" === c ? "\\u0073" : "\\u0053") + d;
}
function Ha(a, b, c, d, e) {
  a = void 0 === a ? "" : a;
  b = void 0 === b ? "<script>" : '<script nonce="' + w(b) + '">';
  var f = [];
  void 0 !== c && f.push(b, ("" + c).replace(Fa, Ga), "\x3c/script>");
  if (void 0 !== d)
    for (c = 0; c < d.length; c++) {
      var g = d[c],
        h = "string" === typeof g ? void 0 : g.integrity;
      f.push('<script src="', w("string" === typeof g ? g : g.src));
      h && f.push('" integrity="', w(h));
      f.push('" async="">\x3c/script>');
    }
  if (void 0 !== e)
    for (d = 0; d < e.length; d++)
      (c = e[d]),
        (g = "string" === typeof c ? void 0 : c.integrity),
        f.push('<script type="module" src="', w("string" === typeof c ? c : c.src)),
        g && f.push('" integrity="', w(g)),
        f.push('" async="">\x3c/script>');
  return {
    bootstrapChunks: f,
    startInlineScript: b,
    placeholderPrefix: a + "P:",
    segmentPrefix: a + "S:",
    boundaryPrefix: a + "B:",
    idPrefix: a,
    nextSuspenseID: 0,
    sentCompleteSegmentFunction: !1,
    sentCompleteBoundaryFunction: !1,
    sentClientRenderFunction: !1,
    sentStyleInsertionFunction: !1,
  };
}
function A(a, b, c) {
  return { insertionMode: a, selectedValue: b, noscriptTagInScope: c };
}
function Ia(a) {
  return A("http://www.w3.org/2000/svg" === a ? 2 : "http://www.w3.org/1998/Math/MathML" === a ? 3 : 0, null, !1);
}
function Ja(a, b, c) {
  switch (b) {
    case "noscript":
      return A(1, null, !0);
    case "select":
      return A(1, null != c.value ? c.value : c.defaultValue, a.noscriptTagInScope);
    case "svg":
      return A(2, null, a.noscriptTagInScope);
    case "math":
      return A(3, null, a.noscriptTagInScope);
    case "foreignObject":
      return A(1, null, a.noscriptTagInScope);
    case "table":
      return A(4, null, a.noscriptTagInScope);
    case "thead":
    case "tbody":
    case "tfoot":
      return A(5, null, a.noscriptTagInScope);
    case "colgroup":
      return A(7, null, a.noscriptTagInScope);
    case "tr":
      return A(6, null, a.noscriptTagInScope);
  }
  return 4 <= a.insertionMode || 0 === a.insertionMode ? A(1, null, a.noscriptTagInScope) : a;
}
function Ka(a, b, c, d) {
  if ("" === b) return d;
  d && a.push("\x3c!-- --\x3e");
  a.push(w(b));
  return !0;
}
var La = new Map();
function Ma(a, b, c) {
  if ("object" !== typeof c)
    throw Error(
      "The `style` prop expects a mapping from style properties to values, not a string. For example, style={{marginRight: spacing + 'em'}} when using JSX.",
    );
  b = !0;
  for (var d in c)
    if (r.call(c, d)) {
      var e = c[d];
      if (null != e && "boolean" !== typeof e && "" !== e) {
        if (0 === d.indexOf("--")) {
          var f = w(d);
          e = w(("" + e).trim());
        } else {
          f = d;
          var g = La.get(f);
          void 0 !== g
            ? (f = g)
            : ((g = w(f.replace(pa, "-$1").toLowerCase().replace(qa, "-ms-"))), La.set(f, g), (f = g));
          e = "number" === typeof e ? (0 === e || r.call(ma, d) ? "" + e : e + "px") : w(("" + e).trim());
        }
        b ? ((b = !1), a.push(' style="', f, ":", e)) : a.push(";", f, ":", e);
      }
    }
  b || a.push('"');
}
function C(a, b, c, d) {
  switch (c) {
    case "style":
      Ma(a, b, d);
      return;
    case "defaultValue":
    case "defaultChecked":
    case "innerHTML":
    case "suppressContentEditableWarning":
    case "suppressHydrationWarning":
      return;
  }
  if (!(2 < c.length) || ("o" !== c[0] && "O" !== c[0]) || ("n" !== c[1] && "N" !== c[1]))
    if (((b = v.hasOwnProperty(c) ? v[c] : null), null !== b)) {
      switch (typeof d) {
        case "function":
        case "symbol":
          return;
        case "boolean":
          if (!b.acceptsBooleans) return;
      }
      c = b.attributeName;
      switch (b.type) {
        case 3:
          d && a.push(" ", c, '=""');
          break;
        case 4:
          !0 === d ? a.push(" ", c, '=""') : !1 !== d && a.push(" ", c, '="', w(d), '"');
          break;
        case 5:
          isNaN(d) || a.push(" ", c, '="', w(d), '"');
          break;
        case 6:
          !isNaN(d) && 1 <= d && a.push(" ", c, '="', w(d), '"');
          break;
        default:
          b.sanitizeURL && (d = "" + d), a.push(" ", c, '="', w(d), '"');
      }
    } else if (ia(c)) {
      switch (typeof d) {
        case "function":
        case "symbol":
          return;
        case "boolean":
          if (((b = c.toLowerCase().slice(0, 5)), "data-" !== b && "aria-" !== b)) return;
      }
      a.push(" ", c, '="', w(d), '"');
    }
}
function D(a, b, c) {
  if (null != b) {
    if (null != c) throw Error("Can only set one of `children` or `props.dangerouslySetInnerHTML`.");
    if ("object" !== typeof b || !("__html" in b))
      throw Error(
        "`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. Please visit https://reactjs.org/link/dangerously-set-inner-html for more information.",
      );
    b = b.__html;
    null !== b && void 0 !== b && a.push("" + b);
  }
}
function Na(a) {
  var b = "";
  ba.Children.forEach(a, function (a) {
    null != a && (b += a);
  });
  return b;
}
function F(a, b, c) {
  var d = "stylesheet" === b.rel;
  a.push(G("link"));
  for (var e in b)
    if (r.call(b, e)) {
      var f = b[e];
      if (null != f)
        switch (e) {
          case "children":
          case "dangerouslySetInnerHTML":
            throw Error(
              "link is a self-closing tag and must neither have `children` nor use `dangerouslySetInnerHTML`.",
            );
          case "precedence":
            if (d) continue;
          default:
            C(a, c, e, f);
        }
    }
  a.push("/>");
  return null;
}
function I(a, b, c, d) {
  a.push(G(c));
  for (var e in b)
    if (r.call(b, e)) {
      var f = b[e];
      if (null != f)
        switch (e) {
          case "children":
          case "dangerouslySetInnerHTML":
            throw Error(
              c + " is a self-closing tag and must neither have `children` nor use `dangerouslySetInnerHTML`.",
            );
          default:
            C(a, d, e, f);
        }
    }
  a.push("/>");
  return null;
}
function Oa(a, b, c) {
  a.push(G("title"));
  var d = null,
    e;
  for (e in b)
    if (r.call(b, e)) {
      var f = b[e];
      if (null != f)
        switch (e) {
          case "children":
            d = f;
            break;
          case "dangerouslySetInnerHTML":
            throw Error("`dangerouslySetInnerHTML` does not make sense on <title>.");
          default:
            C(a, c, e, f);
        }
    }
  a.push(">");
  b = Array.isArray(d) && 2 > d.length ? d[0] || null : d;
  ("string" !== typeof b && "number" !== typeof b) || a.push(w(b));
  a.push("</", "title", ">");
  return null;
}
function Pa(a, b, c) {
  a.push(G("script"));
  var d = null,
    e = null,
    f;
  for (f in b)
    if (r.call(b, f)) {
      var g = b[f];
      if (null != g)
        switch (f) {
          case "children":
            d = g;
            break;
          case "dangerouslySetInnerHTML":
            e = g;
            break;
          default:
            C(a, c, f, g);
        }
    }
  a.push(">");
  D(a, e, d);
  "string" === typeof d && a.push(w(d));
  a.push("</", "script", ">");
  return null;
}
function J(a, b, c, d) {
  a.push(G(c));
  var e = (c = null),
    f;
  for (f in b)
    if (r.call(b, f)) {
      var g = b[f];
      if (null != g)
        switch (f) {
          case "children":
            c = g;
            break;
          case "dangerouslySetInnerHTML":
            e = g;
            break;
          default:
            C(a, d, f, g);
        }
    }
  a.push(">");
  D(a, e, c);
  return "string" === typeof c ? (a.push(w(c)), null) : c;
}
var Qa = /^[a-zA-Z][a-zA-Z:_\.\-\d]*$/,
  Ra = new Map();
function G(a) {
  var b = Ra.get(a);
  if (void 0 === b) {
    if (!Qa.test(a)) throw Error("Invalid tag: " + a);
    b = "<" + a;
    Ra.set(a, b);
  }
  return b;
}
function Sa(a, b, c, d, e, f, g) {
  switch (c) {
    case "select":
      a.push(G("select"));
      var h = (g = null),
        m;
      for (m in d)
        if (r.call(d, m)) {
          var k = d[m];
          if (null != k)
            switch (m) {
              case "children":
                g = k;
                break;
              case "dangerouslySetInnerHTML":
                h = k;
                break;
              case "defaultValue":
              case "value":
                break;
              default:
                C(a, e, m, k);
            }
        }
      a.push(">");
      D(a, h, g);
      return g;
    case "option":
      g = f.selectedValue;
      a.push(G("option"));
      var p = (m = k = null),
        n = null;
      for (h in d)
        if (r.call(d, h)) {
          var q = d[h];
          if (null != q)
            switch (h) {
              case "children":
                k = q;
                break;
              case "selected":
                p = q;
                break;
              case "dangerouslySetInnerHTML":
                n = q;
                break;
              case "value":
                m = q;
              default:
                C(a, e, h, q);
            }
        }
      if (null != g)
        if (((d = null !== m ? "" + m : Na(k)), ra(g)))
          for (e = 0; e < g.length; e++) {
            if ("" + g[e] === d) {
              a.push(' selected=""');
              break;
            }
          }
        else "" + g === d && a.push(' selected=""');
      else p && a.push(' selected=""');
      a.push(">");
      D(a, n, k);
      return k;
    case "textarea":
      a.push(G("textarea"));
      k = h = g = null;
      for (n in d)
        if (r.call(d, n) && ((m = d[n]), null != m))
          switch (n) {
            case "children":
              k = m;
              break;
            case "value":
              g = m;
              break;
            case "defaultValue":
              h = m;
              break;
            case "dangerouslySetInnerHTML":
              throw Error("`dangerouslySetInnerHTML` does not make sense on <textarea>.");
            default:
              C(a, e, n, m);
          }
      null === g && null !== h && (g = h);
      a.push(">");
      if (null != k) {
        if (null != g) throw Error("If you supply `defaultValue` on a <textarea>, do not pass children.");
        if (ra(k) && 1 < k.length) throw Error("<textarea> can only have at most one child.");
        g = "" + k;
      }
      "string" === typeof g && "\n" === g[0] && a.push("\n");
      null !== g && a.push(w("" + g));
      return null;
    case "input":
      a.push(G("input"));
      m = n = h = g = null;
      for (k in d)
        if (r.call(d, k) && ((p = d[k]), null != p))
          switch (k) {
            case "children":
            case "dangerouslySetInnerHTML":
              throw Error(
                "input is a self-closing tag and must neither have `children` nor use `dangerouslySetInnerHTML`.",
              );
            case "defaultChecked":
              m = p;
              break;
            case "defaultValue":
              h = p;
              break;
            case "checked":
              n = p;
              break;
            case "value":
              g = p;
              break;
            default:
              C(a, e, k, p);
          }
      null !== n ? C(a, e, "checked", n) : null !== m && C(a, e, "checked", m);
      null !== g ? C(a, e, "value", g) : null !== h && C(a, e, "value", h);
      a.push("/>");
      return null;
    case "menuitem":
      a.push(G("menuitem"));
      for (var u in d)
        if (r.call(d, u) && ((g = d[u]), null != g))
          switch (u) {
            case "children":
            case "dangerouslySetInnerHTML":
              throw Error("menuitems cannot have `children` nor `dangerouslySetInnerHTML`.");
            default:
              C(a, e, u, g);
          }
      a.push(">");
      return null;
    case "title":
      return (a = 2 !== f.insertionMode && !f.noscriptTagInScope && Aa("title", d) ? null : Oa(a, d, e)), a;
    case "link":
      return !f.noscriptTagInScope && Ba(d) ? (g && a.push("\x3c!-- --\x3e"), (a = null)) : (a = F(a, d, e)), a;
    case "script":
      if ((h = !f.noscriptTagInScope)) {
        if (!y) throw Error('"currentResources" was expected to exist. This is a bug in React.');
        h = y;
        k = d.src;
        n = d.onLoad;
        m = d.onError;
        k && "string" === typeof k
          ? d.async
            ? (n || m
                ? ((n = h.preloadsMap.get(k)), n || ((n = z(h, k, "script", za(k, d))), h.usedScriptPreloads.add(n)))
                : ((n = h.scriptsMap.get(k)), n || ((n = x({}, d)), (n.src = k), (n = xa(h, k, n)), h.scripts.add(n))),
              (h = !0))
            : (h = !1)
          : (h = !1);
      }
      h ? (g && a.push("\x3c!-- --\x3e"), (a = null)) : (a = Pa(a, d, e));
      return a;
    case "meta":
      return (
        !f.noscriptTagInScope && Aa("meta", d) ? (g && a.push("\x3c!-- --\x3e"), (a = null)) : (a = I(a, d, "meta", e)),
        a
      );
    case "base":
      return (
        !f.noscriptTagInScope && Aa("base", d) ? (g && a.push("\x3c!-- --\x3e"), (a = null)) : (a = I(a, d, "base", e)),
        a
      );
    case "listing":
    case "pre":
      a.push(G(c));
      h = g = null;
      for (p in d)
        if (r.call(d, p) && ((k = d[p]), null != k))
          switch (p) {
            case "children":
              g = k;
              break;
            case "dangerouslySetInnerHTML":
              h = k;
              break;
            default:
              C(a, e, p, k);
          }
      a.push(">");
      if (null != h) {
        if (null != g) throw Error("Can only set one of `children` or `props.dangerouslySetInnerHTML`.");
        if ("object" !== typeof h || !("__html" in h))
          throw Error(
            "`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. Please visit https://reactjs.org/link/dangerously-set-inner-html for more information.",
          );
        d = h.__html;
        null !== d &&
          void 0 !== d &&
          ("string" === typeof d && 0 < d.length && "\n" === d[0] ? a.push("\n", d) : a.push("" + d));
      }
      "string" === typeof g && "\n" === g[0] && a.push("\n");
      return g;
    case "area":
    case "br":
    case "col":
    case "embed":
    case "hr":
    case "img":
    case "keygen":
    case "param":
    case "source":
    case "track":
    case "wbr":
      return I(a, d, c, e);
    case "annotation-xml":
    case "color-profile":
    case "font-face":
    case "font-face-src":
    case "font-face-uri":
    case "font-face-format":
    case "font-face-name":
    case "missing-glyph":
      return J(a, d, c, e);
    case "head":
      return J(b, d, c, e);
    case "html":
      return 0 === f.insertionMode && b.push("<!DOCTYPE html>"), J(b, d, c, e);
    default:
      if (-1 === c.indexOf("-") && "string" !== typeof d.is) return J(a, d, c, e);
      a.push(G(c));
      h = g = null;
      for (q in d)
        if (r.call(d, q) && ((k = d[q]), null != k && "function" !== typeof k && "object" !== typeof k && !1 !== k))
          switch ((!0 === k && (k = ""), "className" === q && (q = "class"), q)) {
            case "children":
              g = k;
              break;
            case "dangerouslySetInnerHTML":
              h = k;
              break;
            case "style":
              Ma(a, e, k);
              break;
            case "suppressContentEditableWarning":
            case "suppressHydrationWarning":
              break;
            default:
              ia(q) && "function" !== typeof k && "symbol" !== typeof k && a.push(" ", q, '="', w(k), '"');
          }
      a.push(">");
      D(a, h, g);
      return g;
  }
}
function Ta(a, b, c) {
  switch (c) {
    case "title":
    case "script":
    case "area":
    case "base":
    case "br":
    case "col":
    case "embed":
    case "hr":
    case "img":
    case "input":
    case "keygen":
    case "link":
    case "meta":
    case "param":
    case "source":
    case "track":
    case "wbr":
      return;
    case "body":
      b.unshift("</", c, ">");
      return;
    case "html":
      b.push("</", c, ">");
      return;
  }
  a.push("</", c, ">");
}
function Ua(a, b, c) {
  l(a, '\x3c!--$?--\x3e<template id="');
  if (null === c) throw Error("An ID must have been assigned before we can complete the boundary.");
  l(a, c);
  return !!a.write('"></template>');
}
function Va(a, b, c, d) {
  switch (c.insertionMode) {
    case 0:
    case 1:
      return l(a, '<div hidden id="'), l(a, b.segmentPrefix), l(a, d.toString(16)), !!a.write('">');
    case 2:
      return (
        l(a, '<svg aria-hidden="true" style="display:none" id="'),
        l(a, b.segmentPrefix),
        l(a, d.toString(16)),
        !!a.write('">')
      );
    case 3:
      return (
        l(a, '<math aria-hidden="true" style="display:none" id="'),
        l(a, b.segmentPrefix),
        l(a, d.toString(16)),
        !!a.write('">')
      );
    case 4:
      return l(a, '<table hidden id="'), l(a, b.segmentPrefix), l(a, d.toString(16)), !!a.write('">');
    case 5:
      return l(a, '<table hidden><tbody id="'), l(a, b.segmentPrefix), l(a, d.toString(16)), !!a.write('">');
    case 6:
      return l(a, '<table hidden><tr id="'), l(a, b.segmentPrefix), l(a, d.toString(16)), !!a.write('">');
    case 7:
      return l(a, '<table hidden><colgroup id="'), l(a, b.segmentPrefix), l(a, d.toString(16)), !!a.write('">');
    default:
      throw Error("Unknown insertion mode. This is a bug in React.");
  }
}
function Wa(a, b) {
  switch (b.insertionMode) {
    case 0:
    case 1:
      return !!a.write("</div>");
    case 2:
      return !!a.write("</svg>");
    case 3:
      return !!a.write("</math>");
    case 4:
      return !!a.write("</table>");
    case 5:
      return !!a.write("</tbody></table>");
    case 6:
      return !!a.write("</tr></table>");
    case 7:
      return !!a.write("</colgroup></table>");
    default:
      throw Error("Unknown insertion mode. This is a bug in React.");
  }
}
var Xa = /[<\u2028\u2029]/g;
function Ya(a) {
  return JSON.stringify(a).replace(Xa, function (a) {
    switch (a) {
      case "<":
        return "\\u003c";
      case "\u2028":
        return "\\u2028";
      case "\u2029":
        return "\\u2029";
      default:
        throw Error(
          "escapeJSStringsForInstructionScripts encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React",
        );
    }
  });
}
var Za = /[&><\u2028\u2029]/g;
function K(a) {
  return JSON.stringify(a).replace(Za, function (a) {
    switch (a) {
      case "&":
        return "\\u0026";
      case ">":
        return "\\u003e";
      case "<":
        return "\\u003c";
      case "\u2028":
        return "\\u2028";
      case "\u2029":
        return "\\u2029";
      default:
        throw Error(
          "escapeJSObjectForInstructionScripts encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React",
        );
    }
  });
}
function $a(a, b, c) {
  function d(a) {
    a.flushed || (F(e, a.props, c), (a.flushed = !0));
  }
  var e = [],
    f = b.charset,
    g = b.bases,
    h = b.preconnects,
    m = b.fontPreloads,
    k = b.precedences,
    p = b.usedStylePreloads,
    n = b.scripts,
    q = b.usedScriptPreloads,
    u = b.explicitStylePreloads,
    H = b.explicitScriptPreloads,
    B = b.headResources;
  f && (I(e, f.props, "meta", c), (f.flushed = !0), (b.charset = null));
  g.forEach(function (a) {
    I(e, a.props, "base", c);
    a.flushed = !0;
  });
  g.clear();
  h.forEach(function (a) {
    F(e, a.props, c);
    a.flushed = !0;
  });
  h.clear();
  m.forEach(function (a) {
    F(e, a.props, c);
    a.flushed = !0;
  });
  m.clear();
  k.forEach(function (a, b) {
    a.size
      ? (a.forEach(function (a) {
          F(e, a.props, c);
          a.flushed = !0;
          a.inShell = !0;
          a.hint.flushed = !0;
        }),
        a.clear())
      : e.push('<style data-precedence="', w(b), '"></style>');
  });
  p.forEach(d);
  p.clear();
  n.forEach(function (a) {
    Pa(e, a.props, c);
    a.flushed = !0;
    a.hint.flushed = !0;
  });
  n.clear();
  q.forEach(d);
  q.clear();
  u.forEach(d);
  u.clear();
  H.forEach(d);
  H.clear();
  B.forEach(function (a) {
    switch (a.type) {
      case "title":
        Oa(e, a.props, c);
        break;
      case "meta":
        I(e, a.props, "meta", c);
        break;
      case "link":
        F(e, a.props, c);
    }
    a.flushed = !0;
  });
  B.clear();
  f = !0;
  for (b = 0; b < e.length - 1; b++) l(a, e[b]);
  b < e.length && (f = !!a.write(e[b]));
  return f;
}
function ab(a, b, c) {
  function d(a) {
    a.flushed || (F(e, a.props, c), (a.flushed = !0));
  }
  var e = [],
    f = b.charset,
    g = b.preconnects,
    h = b.fontPreloads,
    m = b.usedStylePreloads,
    k = b.scripts,
    p = b.usedScriptPreloads,
    n = b.explicitStylePreloads,
    q = b.explicitScriptPreloads,
    u = b.headResources;
  f && (I(e, f.props, "meta", c), (f.flushed = !0), (b.charset = null));
  g.forEach(function (a) {
    F(e, a.props, c);
    a.flushed = !0;
  });
  g.clear();
  h.forEach(function (a) {
    F(e, a.props, c);
    a.flushed = !0;
  });
  h.clear();
  m.forEach(d);
  m.clear();
  k.forEach(function (a) {
    J(e, a.props, "script", c);
    Ta(e, e, "script", a.props);
    a.flushed = !0;
    a.hint.flushed = !0;
  });
  k.clear();
  p.forEach(d);
  p.clear();
  n.forEach(d);
  n.clear();
  q.forEach(d);
  q.clear();
  u.forEach(function (a) {
    switch (a.type) {
      case "title":
        Oa(e, a.props, c);
        break;
      case "meta":
        I(e, a.props, "meta", c);
        break;
      case "link":
        F(e, a.props, c);
    }
    a.flushed = !0;
  });
  u.clear();
  f = !0;
  for (b = 0; b < e.length - 1; b++) l(a, e[b]);
  b < e.length && (f = !!a.write(e[b]));
  return f;
}
function bb(a, b) {
  l(a, "[");
  var c = "[";
  b.forEach(function (b) {
    if (!b.inShell)
      if (b.flushed) l(a, c), l(a, K("" + b.href)), l(a, "]"), (c = ",[");
      else {
        l(a, c);
        var d = b.precedence,
          f = b.props;
        l(a, K("" + b.href));
        d = "" + d;
        l(a, ",");
        l(a, K(d));
        for (var g in f)
          if (r.call(f, g)) {
            var h = f[g];
            if (null != h)
              switch (g) {
                case "href":
                case "rel":
                case "precedence":
                case "data-precedence":
                  break;
                case "children":
                case "dangerouslySetInnerHTML":
                  throw Error(
                    "link is a self-closing tag and must neither have `children` nor use `dangerouslySetInnerHTML`.",
                  );
                default:
                  a: {
                    d = a;
                    var m = g,
                      k = m.toLowerCase();
                    switch (typeof h) {
                      case "function":
                      case "symbol":
                        break a;
                    }
                    switch (m) {
                      case "innerHTML":
                      case "dangerouslySetInnerHTML":
                      case "suppressContentEditableWarning":
                      case "suppressHydrationWarning":
                      case "style":
                        break a;
                      case "className":
                        k = "class";
                        break;
                      case "hidden":
                        if (!1 === h) break a;
                        break;
                      case "src":
                      case "href":
                        break;
                      default:
                        if (!ia(m)) break a;
                    }
                    if (!(2 < m.length) || ("o" !== m[0] && "O" !== m[0]) || ("n" !== m[1] && "N" !== m[1]))
                      (h = "" + h), l(d, ","), l(d, K(k)), l(d, ","), l(d, K(h));
                  }
              }
          }
        l(a, "]");
        c = ",[";
        b.flushed = !0;
        b.hint.flushed = !0;
      }
  });
  l(a, "]");
}
var cb = Symbol.for("react.element"),
  db = Symbol.for("react.portal"),
  eb = Symbol.for("react.fragment"),
  fb = Symbol.for("react.strict_mode"),
  gb = Symbol.for("react.profiler"),
  hb = Symbol.for("react.provider"),
  ib = Symbol.for("react.context"),
  jb = Symbol.for("react.server_context"),
  kb = Symbol.for("react.forward_ref"),
  lb = Symbol.for("react.suspense"),
  mb = Symbol.for("react.suspense_list"),
  nb = Symbol.for("react.memo"),
  ob = Symbol.for("react.lazy"),
  pb = Symbol.for("react.scope"),
  qb = Symbol.for("react.debug_trace_mode"),
  rb = Symbol.for("react.offscreen"),
  sb = Symbol.for("react.legacy_hidden"),
  tb = Symbol.for("react.cache"),
  ub = Symbol.for("react.default_value"),
  vb = Symbol.for("react.memo_cache_sentinel"),
  wb = Symbol.iterator;
function xb(a) {
  if (null == a) return null;
  if ("function" === typeof a) return a.displayName || a.name || null;
  if ("string" === typeof a) return a;
  switch (a) {
    case eb:
      return "Fragment";
    case db:
      return "Portal";
    case gb:
      return "Profiler";
    case fb:
      return "StrictMode";
    case lb:
      return "Suspense";
    case mb:
      return "SuspenseList";
    case tb:
      return "Cache";
  }
  if ("object" === typeof a)
    switch (a.$$typeof) {
      case ib:
        return (a.displayName || "Context") + ".Consumer";
      case hb:
        return (a._context.displayName || "Context") + ".Provider";
      case kb:
        var b = a.render;
        a = a.displayName;
        a || ((a = b.displayName || b.name || ""), (a = "" !== a ? "ForwardRef(" + a + ")" : "ForwardRef"));
        return a;
      case nb:
        return (b = a.displayName || null), null !== b ? b : xb(a.type) || "Memo";
      case ob:
        b = a._payload;
        a = a._init;
        try {
          return xb(a(b));
        } catch (c) {
          break;
        }
      case jb:
        return (a.displayName || a._globalName) + ".Provider";
    }
  return null;
}
var yb = ba.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
  zb = {};
function Ab(a, b) {
  a = a.contextTypes;
  if (!a) return zb;
  var c = {},
    d;
  for (d in a) c[d] = b[d];
  return c;
}
var L = null;
function Bb(a, b) {
  if (a !== b) {
    a.context._currentValue = a.parentValue;
    a = a.parent;
    var c = b.parent;
    if (null === a) {
      if (null !== c) throw Error("The stacks must reach the root at the same time. This is a bug in React.");
    } else {
      if (null === c) throw Error("The stacks must reach the root at the same time. This is a bug in React.");
      Bb(a, c);
    }
    b.context._currentValue = b.value;
  }
}
function Cb(a) {
  a.context._currentValue = a.parentValue;
  a = a.parent;
  null !== a && Cb(a);
}
function Db(a) {
  var b = a.parent;
  null !== b && Db(b);
  a.context._currentValue = a.value;
}
function Eb(a, b) {
  a.context._currentValue = a.parentValue;
  a = a.parent;
  if (null === a)
    throw Error("The depth must equal at least at zero before reaching the root. This is a bug in React.");
  a.depth === b.depth ? Bb(a, b) : Eb(a, b);
}
function Fb(a, b) {
  var c = b.parent;
  if (null === c)
    throw Error("The depth must equal at least at zero before reaching the root. This is a bug in React.");
  a.depth === c.depth ? Bb(a, c) : Fb(a, c);
  b.context._currentValue = b.value;
}
function Gb(a) {
  var b = L;
  b !== a &&
    (null === b ? Db(a) : null === a ? Cb(b) : b.depth === a.depth ? Bb(b, a) : b.depth > a.depth ? Eb(b, a) : Fb(b, a),
    (L = a));
}
var Hb = {
  isMounted: function () {
    return !1;
  },
  enqueueSetState: function (a, b) {
    a = a._reactInternals;
    null !== a.queue && a.queue.push(b);
  },
  enqueueReplaceState: function (a, b) {
    a = a._reactInternals;
    a.replace = !0;
    a.queue = [b];
  },
  enqueueForceUpdate: function () {},
};
function Ib(a, b, c, d) {
  var e = void 0 !== a.state ? a.state : null;
  a.updater = Hb;
  a.props = c;
  a.state = e;
  var f = { queue: [], replace: !1 };
  a._reactInternals = f;
  var g = b.contextType;
  a.context = "object" === typeof g && null !== g ? g._currentValue : d;
  g = b.getDerivedStateFromProps;
  "function" === typeof g && ((g = g(c, e)), (e = null === g || void 0 === g ? e : x({}, e, g)), (a.state = e));
  if (
    "function" !== typeof b.getDerivedStateFromProps &&
    "function" !== typeof a.getSnapshotBeforeUpdate &&
    ("function" === typeof a.UNSAFE_componentWillMount || "function" === typeof a.componentWillMount)
  )
    if (
      ((b = a.state),
      "function" === typeof a.componentWillMount && a.componentWillMount(),
      "function" === typeof a.UNSAFE_componentWillMount && a.UNSAFE_componentWillMount(),
      b !== a.state && Hb.enqueueReplaceState(a, a.state, null),
      null !== f.queue && 0 < f.queue.length)
    )
      if (((b = f.queue), (g = f.replace), (f.queue = null), (f.replace = !1), g && 1 === b.length)) a.state = b[0];
      else {
        f = g ? b[0] : a.state;
        e = !0;
        for (g = g ? 1 : 0; g < b.length; g++) {
          var h = b[g];
          h = "function" === typeof h ? h.call(a, f, c, d) : h;
          null != h && (e ? ((e = !1), (f = x({}, f, h))) : x(f, h));
        }
        a.state = f;
      }
    else f.queue = null;
}
var Jb = { id: 1, overflow: "" };
function Kb(a, b, c) {
  var d = a.id;
  a = a.overflow;
  var e = 32 - Lb(d) - 1;
  d &= ~(1 << e);
  c += 1;
  var f = 32 - Lb(b) + e;
  if (30 < f) {
    var g = e - (e % 5);
    f = (d & ((1 << g) - 1)).toString(32);
    d >>= g;
    e -= g;
    return { id: (1 << (32 - Lb(b) + e)) | (c << e) | d, overflow: f + a };
  }
  return { id: (1 << f) | (c << e) | d, overflow: a };
}
var Lb = Math.clz32 ? Math.clz32 : Mb,
  Nb = Math.log,
  Ob = Math.LN2;
function Mb(a) {
  a >>>= 0;
  return 0 === a ? 32 : (31 - ((Nb(a) / Ob) | 0)) | 0;
}
var Pb = Error(
  "Suspense Exception: This is not a real error! It's an implementation detail of `use` to interrupt the current render. You must either rethrow it immediately, or move the `use` call outside of the `try/catch` block. Capturing without rethrowing will lead to unexpected behavior.\n\nTo handle async errors, wrap your component in an error boundary, or call the promise's `.catch` method and pass the result to `use`",
);
function Qb() {}
function Rb(a, b, c) {
  c = a[c];
  void 0 === c ? a.push(b) : c !== b && (b.then(Qb, Qb), (b = c));
  switch (b.status) {
    case "fulfilled":
      return b.value;
    case "rejected":
      throw b.reason;
    default:
      if ("string" !== typeof b.status)
        switch (
          ((a = b),
          (a.status = "pending"),
          a.then(
            function (a) {
              if ("pending" === b.status) {
                var c = b;
                c.status = "fulfilled";
                c.value = a;
              }
            },
            function (a) {
              if ("pending" === b.status) {
                var c = b;
                c.status = "rejected";
                c.reason = a;
              }
            },
          ),
          b.status)
        ) {
          case "fulfilled":
            return b.value;
          case "rejected":
            throw b.reason;
        }
      Sb = b;
      throw Pb;
  }
}
var Sb = null;
function Tb() {
  if (null === Sb) throw Error("Expected a suspended thenable. This is a bug in React. Please file an issue.");
  var a = Sb;
  Sb = null;
  return a;
}
function Ub(a, b) {
  return (a === b && (0 !== a || 1 / a === 1 / b)) || (a !== a && b !== b);
}
var Vb = "function" === typeof Object.is ? Object.is : Ub,
  M = null,
  Wb = null,
  Xb = null,
  N = null,
  O = !1,
  Yb = !1,
  Q = 0,
  R = 0,
  S = null,
  T = null,
  Zb = 0;
function U() {
  if (null === M)
    throw Error(
      "Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:\n1. You might have mismatching versions of React and the renderer (such as React DOM)\n2. You might be breaking the Rules of Hooks\n3. You might have more than one copy of React in the same app\nSee https://reactjs.org/link/invalid-hook-call for tips about how to debug and fix this problem.",
    );
  return M;
}
function $b() {
  if (0 < Zb) throw Error("Rendered more hooks than during the previous render");
  return { memoizedState: null, queue: null, next: null };
}
function ac() {
  null === N
    ? null === Xb
      ? ((O = !1), (Xb = N = $b()))
      : ((O = !0), (N = Xb))
    : null === N.next
    ? ((O = !1), (N = N.next = $b()))
    : ((O = !0), (N = N.next));
  return N;
}
function bc(a, b, c, d) {
  for (; Yb; ) (Yb = !1), (R = Q = 0), (Zb += 1), (N = null), (c = a(b, d));
  cc();
  return c;
}
function dc() {
  var a = S;
  S = null;
  return a;
}
function cc() {
  Wb = M = null;
  Yb = !1;
  Xb = null;
  Zb = 0;
  N = T = null;
}
function ec(a, b) {
  return "function" === typeof b ? b(a) : b;
}
function fc(a, b, c) {
  M = U();
  N = ac();
  if (O) {
    var d = N.queue;
    b = d.dispatch;
    if (null !== T && ((c = T.get(d)), void 0 !== c)) {
      T.delete(d);
      d = N.memoizedState;
      do (d = a(d, c.action)), (c = c.next);
      while (null !== c);
      N.memoizedState = d;
      return [d, b];
    }
    return [N.memoizedState, b];
  }
  a = a === ec ? ("function" === typeof b ? b() : b) : void 0 !== c ? c(b) : b;
  N.memoizedState = a;
  a = N.queue = { last: null, dispatch: null };
  a = a.dispatch = gc.bind(null, M, a);
  return [N.memoizedState, a];
}
function hc(a, b) {
  M = U();
  N = ac();
  b = void 0 === b ? null : b;
  if (null !== N) {
    var c = N.memoizedState;
    if (null !== c && null !== b) {
      var d = c[1];
      a: if (null === d) d = !1;
      else {
        for (var e = 0; e < d.length && e < b.length; e++)
          if (!Vb(b[e], d[e])) {
            d = !1;
            break a;
          }
        d = !0;
      }
      if (d) return c[0];
    }
  }
  a = a();
  N.memoizedState = [a, b];
  return a;
}
function gc(a, b, c) {
  if (25 <= Zb) throw Error("Too many re-renders. React limits the number of renders to prevent an infinite loop.");
  if (a === M)
    if (((Yb = !0), (a = { action: c, next: null }), null === T && (T = new Map()), (c = T.get(b)), void 0 === c))
      T.set(b, a);
    else {
      for (b = c; null !== b.next; ) b = b.next;
      b.next = a;
    }
}
function ic() {
  throw Error("A function wrapped in useEvent can't be called during rendering.");
}
function jc() {
  throw Error("startTransition cannot be called during server rendering.");
}
function kc() {
  throw Error("Cache cannot be refreshed during server rendering.");
}
function lc() {}
var nc = {
    readContext: function (a) {
      return a._currentValue;
    },
    useContext: function (a) {
      U();
      return a._currentValue;
    },
    useMemo: hc,
    useReducer: fc,
    useRef: function (a) {
      M = U();
      N = ac();
      var b = N.memoizedState;
      return null === b ? ((a = { current: a }), (N.memoizedState = a)) : b;
    },
    useState: function (a) {
      return fc(ec, a);
    },
    useInsertionEffect: lc,
    useLayoutEffect: function () {},
    useCallback: function (a, b) {
      return hc(function () {
        return a;
      }, b);
    },
    useImperativeHandle: lc,
    useEffect: lc,
    useDebugValue: lc,
    useDeferredValue: function (a) {
      U();
      return a;
    },
    useTransition: function () {
      U();
      return [!1, jc];
    },
    useId: function () {
      var a = Wb.treeContext;
      var b = a.overflow;
      a = a.id;
      a = (a & ~(1 << (32 - Lb(a) - 1))).toString(32) + b;
      var c = mc;
      if (null === c)
        throw Error("Invalid hook call. Hooks can only be called inside of the body of a function component.");
      b = Q++;
      a = ":" + c.idPrefix + "R" + a;
      0 < b && (a += "H" + b.toString(32));
      return a + ":";
    },
    useMutableSource: function (a, b) {
      U();
      return b(a._source);
    },
    useSyncExternalStore: function (a, b, c) {
      if (void 0 === c)
        throw Error(
          "Missing getServerSnapshot, which is required for server-rendered content. Will revert to client rendering.",
        );
      return c();
    },
    useCacheRefresh: function () {
      return kc;
    },
    useEvent: function () {
      return ic;
    },
    useMemoCache: function (a) {
      for (var b = Array(a), c = 0; c < a; c++) b[c] = vb;
      return b;
    },
    use: function (a) {
      if (null !== a && "object" === typeof a) {
        if ("function" === typeof a.then) {
          var b = R;
          R += 1;
          null === S && (S = []);
          return Rb(S, a, b);
        }
        if (a.$$typeof === ib || a.$$typeof === jb) return a._currentValue;
      }
      throw Error("An unsupported type was passed to use(): " + String(a));
    },
  },
  mc = null,
  oc = {
    getCacheSignal: function () {
      throw Error("Not implemented.");
    },
    getCacheForType: function () {
      throw Error("Not implemented.");
    },
  },
  pc = yb.ReactCurrentDispatcher,
  qc = yb.ReactCurrentCache;
function rc(a) {
  console.error(a);
  return null;
}
function W() {}
function sc(a, b, c, d, e, f, g, h, m) {
  var k = [],
    p = new Set(),
    n = {
      preloadsMap: new Map(),
      stylesMap: new Map(),
      scriptsMap: new Map(),
      headsMap: new Map(),
      charset: null,
      bases: new Set(),
      preconnects: new Set(),
      fontPreloads: new Set(),
      precedences: new Map(),
      usedStylePreloads: new Set(),
      scripts: new Set(),
      usedScriptPreloads: new Set(),
      explicitStylePreloads: new Set(),
      explicitScriptPreloads: new Set(),
      headResources: new Set(),
      structuredMetaKeys: new Map(),
      boundaryResources: null,
    };
  b = {
    destination: null,
    responseState: b,
    progressiveChunkSize: void 0 === d ? 12800 : d,
    status: 0,
    fatalError: null,
    nextSegmentId: 0,
    allPendingTasks: 0,
    pendingRootTasks: 0,
    resources: n,
    completedRootSegment: null,
    abortableTasks: p,
    pingedTasks: k,
    clientRenderedBoundaries: [],
    completedBoundaries: [],
    partialBoundaries: [],
    preamble: [],
    postamble: [],
    onError: void 0 === e ? rc : e,
    onAllReady: void 0 === f ? W : f,
    onShellReady: void 0 === g ? W : g,
    onShellError: void 0 === h ? W : h,
    onFatalError: void 0 === m ? W : m,
  };
  c = tc(b, 0, null, c, !1, !1);
  c.parentFlushed = !0;
  a = uc(b, null, a, null, c, p, zb, null, Jb);
  k.push(a);
  return b;
}
function uc(a, b, c, d, e, f, g, h, m) {
  a.allPendingTasks++;
  null === d ? a.pendingRootTasks++ : d.pendingTasks++;
  var k = {
    node: c,
    ping: function () {
      var b = a.pingedTasks;
      b.push(k);
      1 === b.length && vc(a);
    },
    blockedBoundary: d,
    blockedSegment: e,
    abortSet: f,
    legacyContext: g,
    context: h,
    treeContext: m,
    thenableState: b,
  };
  f.add(k);
  return k;
}
function tc(a, b, c, d, e, f) {
  return {
    status: 0,
    id: -1,
    index: b,
    parentFlushed: !1,
    chunks: [],
    children: [],
    formatContext: d,
    boundary: c,
    lastPushedText: e,
    textEmbedded: f,
  };
}
function X(a, b) {
  a = a.onError(b);
  if (null != a && "string" !== typeof a)
    throw Error(
      'onError returned something with a type other than "string". onError should return a string and may return null or undefined but must not return anything else. It received something of type "' +
        typeof a +
        '" instead',
    );
  return a;
}
function Y(a, b) {
  var c = a.onShellError;
  c(b);
  c = a.onFatalError;
  c(b);
  null !== a.destination ? ((a.status = 2), da(a.destination, b)) : ((a.status = 1), (a.fatalError = b));
}
function wc(a, b, c, d) {
  var e = c.render(),
    f = d.childContextTypes;
  if (null !== f && void 0 !== f) {
    var g = b.legacyContext;
    if ("function" !== typeof c.getChildContext) d = g;
    else {
      c = c.getChildContext();
      for (var h in c)
        if (!(h in f))
          throw Error(
            (xb(d) || "Unknown") + '.getChildContext(): key "' + h + '" is not defined in childContextTypes.',
          );
      d = x({}, g, c);
    }
    b.legacyContext = d;
    Z(a, b, null, e);
    b.legacyContext = g;
  } else Z(a, b, null, e);
}
function xc(a, b) {
  if (a && a.defaultProps) {
    b = x({}, b);
    a = a.defaultProps;
    for (var c in a) void 0 === b[c] && (b[c] = a[c]);
    return b;
  }
  return b;
}
function yc(a, b, c, d, e, f) {
  if ("function" === typeof d)
    if (d.prototype && d.prototype.isReactComponent)
      (c = Ab(d, b.legacyContext)),
        (f = d.contextType),
        (f = new d(e, "object" === typeof f && null !== f ? f._currentValue : c)),
        Ib(f, d, e, c),
        wc(a, b, f, d);
    else {
      f = Ab(d, b.legacyContext);
      M = {};
      Wb = b;
      R = Q = 0;
      S = c;
      c = d(e, f);
      c = bc(d, e, c, f);
      var g = 0 !== Q;
      if ("object" === typeof c && null !== c && "function" === typeof c.render && void 0 === c.$$typeof)
        Ib(c, d, e, f), wc(a, b, c, d);
      else if (g) {
        e = b.treeContext;
        b.treeContext = Kb(e, 1, 0);
        try {
          Z(a, b, null, c);
        } finally {
          b.treeContext = e;
        }
      } else Z(a, b, null, c);
    }
  else if ("string" === typeof d)
    (c = b.blockedSegment),
      (f = Sa(c.chunks, a.preamble, d, e, a.responseState, c.formatContext, c.lastPushedText)),
      (c.lastPushedText = !1),
      (g = c.formatContext),
      (c.formatContext = Ja(g, d, e)),
      zc(a, b, f),
      (c.formatContext = g),
      Ta(c.chunks, a.postamble, d),
      (c.lastPushedText = !1);
  else {
    switch (d) {
      case sb:
      case qb:
      case fb:
      case gb:
      case eb:
        Z(a, b, null, e.children);
        return;
      case rb:
        "hidden" !== e.mode && Z(a, b, null, e.children);
        return;
      case mb:
        Z(a, b, null, e.children);
        return;
      case pb:
        throw Error("ReactDOMServer does not yet support scope components.");
      case lb:
        a: {
          d = b.blockedBoundary;
          c = b.blockedSegment;
          f = e.fallback;
          e = e.children;
          g = new Set();
          var h = {
              id: null,
              rootSegmentID: -1,
              parentFlushed: !1,
              pendingTasks: 0,
              forceClientRender: !1,
              completedSegments: [],
              byteSize: 0,
              fallbackAbortableTasks: g,
              errorDigest: null,
              resources: new Set(),
            },
            m = tc(a, c.chunks.length, h, c.formatContext, !1, !1);
          c.children.push(m);
          c.lastPushedText = !1;
          var k = tc(a, 0, null, c.formatContext, !1, !1);
          k.parentFlushed = !0;
          b.blockedBoundary = h;
          b.blockedSegment = k;
          a.resources.boundaryResources = h.resources;
          try {
            if (
              (zc(a, b, e),
              k.lastPushedText && k.textEmbedded && k.chunks.push("\x3c!-- --\x3e"),
              (k.status = 1),
              0 === h.pendingTasks &&
                (null !== a.completedRootSegment || 0 < a.pendingRootTasks) &&
                Da(a.resources, h.resources),
              Ac(h, k),
              0 === h.pendingTasks)
            )
              break a;
          } catch (p) {
            (k.status = 4), (h.forceClientRender = !0), (h.errorDigest = X(a, p));
          } finally {
            (a.resources.boundaryResources = d ? d.resources : null), (b.blockedBoundary = d), (b.blockedSegment = c);
          }
          b = uc(a, null, f, d, m, g, b.legacyContext, b.context, b.treeContext);
          a.pingedTasks.push(b);
        }
        return;
    }
    if ("object" === typeof d && null !== d)
      switch (d.$$typeof) {
        case kb:
          d = d.render;
          M = {};
          Wb = b;
          R = Q = 0;
          S = c;
          c = d(e, f);
          e = bc(d, e, c, f);
          if (0 !== Q) {
            d = b.treeContext;
            b.treeContext = Kb(d, 1, 0);
            try {
              Z(a, b, null, e);
            } finally {
              b.treeContext = d;
            }
          } else Z(a, b, null, e);
          return;
        case nb:
          d = d.type;
          e = xc(d, e);
          yc(a, b, c, d, e, f);
          return;
        case hb:
          c = e.children;
          d = d._context;
          e = e.value;
          f = d._currentValue;
          d._currentValue = e;
          g = L;
          L = e = {
            parent: g,
            depth: null === g ? 0 : g.depth + 1,
            context: d,
            parentValue: f,
            value: e,
          };
          b.context = e;
          Z(a, b, null, c);
          a = L;
          if (null === a) throw Error("Tried to pop a Context at the root of the app. This is a bug in React.");
          e = a.parentValue;
          a.context._currentValue = e === ub ? a.context._defaultValue : e;
          a = L = a.parent;
          b.context = a;
          return;
        case ib:
          e = e.children;
          e = e(d._currentValue);
          Z(a, b, null, e);
          return;
        case ob:
          f = d._init;
          d = f(d._payload);
          e = xc(d, e);
          yc(a, b, c, d, e, void 0);
          return;
      }
    throw Error(
      "Element type is invalid: expected a string (for built-in components) or a class/function (for composite components) but got: " +
        ((null == d ? d : typeof d) + "."),
    );
  }
}
function Z(a, b, c, d) {
  b.node = d;
  if ("object" === typeof d && null !== d) {
    switch (d.$$typeof) {
      case cb:
        yc(a, b, c, d.type, d.props, d.ref);
        return;
      case db:
        throw Error(
          "Portals are not currently supported by the server renderer. Render them conditionally so that they only appear on the client render.",
        );
      case ob:
        c = d._init;
        d = c(d._payload);
        Z(a, b, null, d);
        return;
    }
    if (ra(d)) {
      Bc(a, b, d);
      return;
    }
    null === d || "object" !== typeof d
      ? (c = null)
      : ((c = (wb && d[wb]) || d["@@iterator"]), (c = "function" === typeof c ? c : null));
    if (c && (c = c.call(d))) {
      d = c.next();
      if (!d.done) {
        var e = [];
        do e.push(d.value), (d = c.next());
        while (!d.done);
        Bc(a, b, e);
      }
      return;
    }
    a = Object.prototype.toString.call(d);
    throw Error(
      "Objects are not valid as a React child (found: " +
        ("[object Object]" === a ? "object with keys {" + Object.keys(d).join(", ") + "}" : a) +
        "). If you meant to render a collection of children, use an array instead.",
    );
  }
  "string" === typeof d
    ? ((c = b.blockedSegment), (c.lastPushedText = Ka(b.blockedSegment.chunks, d, a.responseState, c.lastPushedText)))
    : "number" === typeof d &&
      ((c = b.blockedSegment),
      (c.lastPushedText = Ka(b.blockedSegment.chunks, "" + d, a.responseState, c.lastPushedText)));
}
function Bc(a, b, c) {
  for (var d = c.length, e = 0; e < d; e++) {
    var f = b.treeContext;
    b.treeContext = Kb(f, d, e);
    try {
      zc(a, b, c[e]);
    } finally {
      b.treeContext = f;
    }
  }
}
function zc(a, b, c) {
  var d = b.blockedSegment.formatContext,
    e = b.legacyContext,
    f = b.context;
  try {
    return Z(a, b, null, c);
  } catch (k) {
    if ((cc(), (c = k === Pb ? Tb() : k), "object" === typeof c && null !== c && "function" === typeof c.then)) {
      var g = dc(),
        h = b.blockedSegment,
        m = tc(a, h.chunks.length, null, h.formatContext, h.lastPushedText, !0);
      h.children.push(m);
      h.lastPushedText = !1;
      a = uc(a, g, b.node, b.blockedBoundary, m, b.abortSet, b.legacyContext, b.context, b.treeContext).ping;
      c.then(a, a);
      b.blockedSegment.formatContext = d;
      b.legacyContext = e;
      b.context = f;
      Gb(f);
    } else throw ((b.blockedSegment.formatContext = d), (b.legacyContext = e), (b.context = f), Gb(f), c);
  }
}
function Cc(a) {
  var b = a.blockedBoundary;
  a = a.blockedSegment;
  a.status = 3;
  Dc(this, b, a);
}
function Ec(a, b, c) {
  var d = a.blockedBoundary;
  a.blockedSegment.status = 3;
  null === d
    ? (b.allPendingTasks--, 1 !== b.status && 2 !== b.status && (X(b, c), Y(b, c)))
    : (d.pendingTasks--,
      d.forceClientRender ||
        ((d.forceClientRender = !0),
        (d.errorDigest = b.onError(c)),
        d.parentFlushed && b.clientRenderedBoundaries.push(d)),
      d.fallbackAbortableTasks.forEach(function (a) {
        return Ec(a, b, c);
      }),
      d.fallbackAbortableTasks.clear(),
      b.allPendingTasks--,
      0 === b.allPendingTasks && ((a = b.onAllReady), a()));
}
function Ac(a, b) {
  if (0 === b.chunks.length && 1 === b.children.length && null === b.children[0].boundary) {
    var c = b.children[0];
    c.id = b.id;
    c.parentFlushed = !0;
    1 === c.status && Ac(a, c);
  } else a.completedSegments.push(b);
}
function Dc(a, b, c) {
  if (null === b) {
    if (c.parentFlushed) {
      if (null !== a.completedRootSegment) throw Error("There can only be one root segment. This is a bug in React.");
      a.completedRootSegment = c;
    }
    a.pendingRootTasks--;
    0 === a.pendingRootTasks && ((a.onShellError = W), (b = a.onShellReady), b());
  } else
    b.pendingTasks--,
      b.forceClientRender ||
        (0 === b.pendingTasks
          ? (c.parentFlushed && 1 === c.status && Ac(b, c),
            (null !== a.completedRootSegment || 0 < a.pendingRootTasks) && Da(a.resources, b.resources),
            b.parentFlushed && a.completedBoundaries.push(b),
            b.fallbackAbortableTasks.forEach(Cc, a),
            b.fallbackAbortableTasks.clear())
          : c.parentFlushed &&
            1 === c.status &&
            (Ac(b, c), 1 === b.completedSegments.length && b.parentFlushed && a.partialBoundaries.push(b)));
  a.allPendingTasks--;
  0 === a.allPendingTasks && ((a = a.onAllReady), a());
}
function vc(a) {
  if (2 !== a.status) {
    var b = L,
      c = pc.current;
    pc.current = nc;
    var d = qc.current;
    qc.current = oc;
    var e = a.resources;
    sa.push(y);
    y = e;
    e = Ea.current;
    Ea.current = va;
    var f = mc;
    mc = a.responseState;
    try {
      var g = a.pingedTasks,
        h;
      for (h = 0; h < g.length; h++) {
        var m = g[h];
        var k = a,
          p = m.blockedBoundary;
        k.resources.boundaryResources = p ? p.resources : null;
        var n = m.blockedSegment;
        if (0 === n.status) {
          Gb(m.context);
          try {
            var q = m.thenableState;
            m.thenableState = null;
            Z(k, m, q, m.node);
            n.lastPushedText && n.textEmbedded && n.chunks.push("\x3c!-- --\x3e");
            m.abortSet.delete(m);
            n.status = 1;
            Dc(k, m.blockedBoundary, n);
          } catch (aa) {
            cc();
            var u = aa === Pb ? Tb() : aa;
            if ("object" === typeof u && null !== u && "function" === typeof u.then) {
              var H = m.ping;
              u.then(H, H);
              m.thenableState = dc();
            } else {
              m.abortSet.delete(m);
              n.status = 4;
              var B = k,
                E = m.blockedBoundary,
                V = u,
                P = X(B, V);
              null === E
                ? Y(B, V)
                : (E.pendingTasks--,
                  E.forceClientRender ||
                    ((E.forceClientRender = !0),
                    (E.errorDigest = P),
                    E.parentFlushed && B.clientRenderedBoundaries.push(E)));
              B.allPendingTasks--;
              if (0 === B.allPendingTasks) {
                var Mc = B.onAllReady;
                Mc();
              }
            }
          } finally {
            k.resources.boundaryResources = null;
          }
        }
      }
      g.splice(0, h);
      null !== a.destination && Fc(a, a.destination);
    } catch (aa) {
      X(a, aa), Y(a, aa);
    } finally {
      (mc = f), (pc.current = c), (qc.current = d), (y = sa.pop()), (Ea.current = e), c === nc && Gb(b);
    }
  }
}
function Gc(a, b, c) {
  c.parentFlushed = !0;
  switch (c.status) {
    case 0:
      var d = (c.id = a.nextSegmentId++);
      c.lastPushedText = !1;
      c.textEmbedded = !1;
      a = a.responseState;
      l(b, '<template id="');
      l(b, a.placeholderPrefix);
      a = d.toString(16);
      l(b, a);
      return !!b.write('"></template>');
    case 1:
      c.status = 2;
      var e = !0;
      d = c.chunks;
      var f = 0;
      c = c.children;
      for (var g = 0; g < c.length; g++) {
        for (e = c[g]; f < e.index; f++) l(b, d[f]);
        e = Hc(a, b, e);
      }
      for (; f < d.length - 1; f++) l(b, d[f]);
      f < d.length && (e = !!b.write(d[f]));
      return e;
    default:
      throw Error(
        "Aborted, errored or already flushed boundaries should not be flushed again. This is a bug in React.",
      );
  }
}
function Hc(a, b, c) {
  var d = c.boundary;
  if (null === d) return Gc(a, b, c);
  d.parentFlushed = !0;
  if (d.forceClientRender)
    (d = d.errorDigest),
      b.write("\x3c!--$!--\x3e"),
      l(b, "<template"),
      d && (l(b, ' data-dgst="'), l(b, w(d)), l(b, '"')),
      b.write("></template>"),
      Gc(a, b, c);
  else if (0 < d.pendingTasks) {
    d.rootSegmentID = a.nextSegmentId++;
    0 < d.completedSegments.length && a.partialBoundaries.push(d);
    var e = a.responseState;
    var f = e.nextSuspenseID++;
    e = e.boundaryPrefix + f.toString(16);
    d = d.id = e;
    Ua(b, a.responseState, d);
    Gc(a, b, c);
  } else if (d.byteSize > a.progressiveChunkSize)
    (d.rootSegmentID = a.nextSegmentId++), a.completedBoundaries.push(d), Ua(b, a.responseState, d.id), Gc(a, b, c);
  else {
    Ca(a.resources, d.resources);
    b.write("\x3c!--$--\x3e");
    c = d.completedSegments;
    if (1 !== c.length)
      throw Error("A previously unvisited boundary must have exactly one root segment. This is a bug in React.");
    Hc(a, b, c[0]);
  }
  return !!b.write("\x3c!--/$--\x3e");
}
function Ic(a, b, c) {
  Va(b, a.responseState, c.formatContext, c.id);
  Hc(a, b, c);
  return Wa(b, c.formatContext);
}
function Jc(a, b, c) {
  a.resources.boundaryResources = c.resources;
  for (var d = c.completedSegments, e = 0; e < d.length; e++) Kc(a, b, c, d[e]);
  d.length = 0;
  a = a.responseState;
  d = c.id;
  e = c.rootSegmentID;
  c = c.resources;
  var f;
  a: {
    for (f = c.values(); ; ) {
      var g = f.next().value;
      if (!g) break;
      if (!g.inShell) {
        f = !0;
        break a;
      }
    }
    f = !1;
  }
  l(b, a.startInlineScript);
  f
    ? a.sentCompleteBoundaryFunction
      ? a.sentStyleInsertionFunction
        ? l(b, '$RR("')
        : ((a.sentStyleInsertionFunction = !0),
          l(
            b,
            '$RM=new Map;\n$RR=function(p,q,v){function r(l){this.s=l}for(var t=$RC,u=$RM,m=new Map,n=document,g,e,f=n.querySelectorAll("link[data-precedence],style[data-precedence]"),d=0;e=f[d++];)m.set(e.dataset.precedence,g=e);e=0;f=[];for(var c,h,b,a;c=v[e++];){var k=0;h=c[k++];if(b=u.get(h))"l"!==b.s&&f.push(b);else{a=n.createElement("link");a.href=h;a.rel="stylesheet";for(a.dataset.precedence=d=c[k++];b=c[k++];)a.setAttribute(b,c[k++]);b=a._p=new Promise(function(l,w){a.onload=l;a.onerror=w});b.then(r.bind(b,\n"l"),r.bind(b,"e"));u.set(h,b);f.push(b);c=m.get(d)||g;c===g&&(g=a);m.set(d,a);c?c.parentNode.insertBefore(a,c.nextSibling):(d=n.head,d.insertBefore(a,d.firstChild))}}Promise.all(f).then(t.bind(null,p,q,""),t.bind(null,p,q,"Resource failed to load"))};;$RR("',
          ))
      : ((a.sentCompleteBoundaryFunction = !0),
        (a.sentStyleInsertionFunction = !0),
        l(
          b,
          '$RC=function(b,c,e){c=document.getElementById(c);c.parentNode.removeChild(c);var a=document.getElementById(b);if(a){b=a.previousSibling;if(e)b.data="$!",a.setAttribute("data-dgst",e);else{e=b.parentNode;a=b.nextSibling;var f=0;do{if(a&&8===a.nodeType){var d=a.data;if("/$"===d)if(0===f)break;else f--;else"$"!==d&&"$?"!==d&&"$!"!==d||f++}d=a.nextSibling;e.removeChild(a);a=d}while(a);for(;c.firstChild;)e.insertBefore(c.firstChild,a);b.data="$"}b._reactRetry&&b._reactRetry()}};;$RM=new Map;\n$RR=function(p,q,v){function r(l){this.s=l}for(var t=$RC,u=$RM,m=new Map,n=document,g,e,f=n.querySelectorAll("link[data-precedence],style[data-precedence]"),d=0;e=f[d++];)m.set(e.dataset.precedence,g=e);e=0;f=[];for(var c,h,b,a;c=v[e++];){var k=0;h=c[k++];if(b=u.get(h))"l"!==b.s&&f.push(b);else{a=n.createElement("link");a.href=h;a.rel="stylesheet";for(a.dataset.precedence=d=c[k++];b=c[k++];)a.setAttribute(b,c[k++]);b=a._p=new Promise(function(l,w){a.onload=l;a.onerror=w});b.then(r.bind(b,\n"l"),r.bind(b,"e"));u.set(h,b);f.push(b);c=m.get(d)||g;c===g&&(g=a);m.set(d,a);c?c.parentNode.insertBefore(a,c.nextSibling):(d=n.head,d.insertBefore(a,d.firstChild))}}Promise.all(f).then(t.bind(null,p,q,""),t.bind(null,p,q,"Resource failed to load"))};;$RR("',
        ))
    : a.sentCompleteBoundaryFunction
    ? l(b, '$RC("')
    : ((a.sentCompleteBoundaryFunction = !0),
      l(
        b,
        '$RC=function(b,c,e){c=document.getElementById(c);c.parentNode.removeChild(c);var a=document.getElementById(b);if(a){b=a.previousSibling;if(e)b.data="$!",a.setAttribute("data-dgst",e);else{e=b.parentNode;a=b.nextSibling;var f=0;do{if(a&&8===a.nodeType){var d=a.data;if("/$"===d)if(0===f)break;else f--;else"$"!==d&&"$?"!==d&&"$!"!==d||f++}d=a.nextSibling;e.removeChild(a);a=d}while(a);for(;c.firstChild;)e.insertBefore(c.firstChild,a);b.data="$"}b._reactRetry&&b._reactRetry()}};;$RC("',
      ));
  if (null === d) throw Error("An ID must have been assigned before we can complete the boundary.");
  e = e.toString(16);
  l(b, d);
  l(b, '","');
  l(b, a.segmentPrefix);
  l(b, e);
  f ? (l(b, '",'), bb(b, c)) : l(b, '"');
  return !!b.write(")\x3c/script>");
}
function Kc(a, b, c, d) {
  if (2 === d.status) return !0;
  var e = d.id;
  if (-1 === e) {
    if (-1 === (d.id = c.rootSegmentID))
      throw Error("A root segment ID must have been assigned by now. This is a bug in React.");
    return Ic(a, b, d);
  }
  Ic(a, b, d);
  a = a.responseState;
  l(b, a.startInlineScript);
  a.sentCompleteSegmentFunction
    ? l(b, '$RS("')
    : ((a.sentCompleteSegmentFunction = !0),
      l(
        b,
        '$RS=function(a,b){a=document.getElementById(a);b=document.getElementById(b);for(a.parentNode.removeChild(a);a.firstChild;)b.parentNode.insertBefore(a.firstChild,b);b.parentNode.removeChild(b)};;$RS("',
      ));
  l(b, a.segmentPrefix);
  e = e.toString(16);
  l(b, e);
  l(b, '","');
  l(b, a.placeholderPrefix);
  l(b, e);
  return !!b.write('")\x3c/script>');
}
function Fc(a, b) {
  try {
    var c,
      d = a.completedRootSegment;
    if (null !== d)
      if (0 === a.pendingRootTasks) {
        var e = a.preamble;
        for (c = 0; c < e.length; c++) l(b, e[c]);
        $a(b, a.resources, a.responseState);
        Hc(a, b, d);
        a.completedRootSegment = null;
        var f = a.responseState.bootstrapChunks;
        for (d = 0; d < f.length - 1; d++) l(b, f[d]);
        d < f.length && b.write(f[d]);
      } else return;
    else ab(b, a.resources, a.responseState);
    var g = a.clientRenderedBoundaries;
    for (c = 0; c < g.length; c++) {
      var h = g[c];
      f = b;
      var m = a.responseState,
        k = h.id,
        p = h.errorDigest,
        n = h.errorMessage,
        q = h.errorComponentStack;
      l(f, m.startInlineScript);
      m.sentClientRenderFunction
        ? l(f, '$RX("')
        : ((m.sentClientRenderFunction = !0),
          l(
            f,
            '$RX=function(b,c,d,e){var a=document.getElementById(b);a&&(b=a.previousSibling,b.data="$!",a=a.dataset,c&&(a.dgst=c),d&&(a.msg=d),e&&(a.stck=e),b._reactRetry&&b._reactRetry())};;$RX("',
          ));
      if (null === k) throw Error("An ID must have been assigned before we can complete the boundary.");
      l(f, k);
      l(f, '"');
      if (p || n || q) l(f, ","), l(f, Ya(p || ""));
      if (n || q) l(f, ","), l(f, Ya(n || ""));
      q && (l(f, ","), l(f, Ya(q)));
      if (!f.write(")\x3c/script>")) {
        a.destination = null;
        c++;
        g.splice(0, c);
        return;
      }
    }
    g.splice(0, c);
    var u = a.completedBoundaries;
    for (c = 0; c < u.length; c++)
      if (!Jc(a, b, u[c])) {
        a.destination = null;
        c++;
        u.splice(0, c);
        return;
      }
    u.splice(0, c);
    var H = a.partialBoundaries;
    for (c = 0; c < H.length; c++) {
      var B = H[c];
      a: {
        g = a;
        h = b;
        g.resources.boundaryResources = B.resources;
        var E = B.completedSegments;
        for (m = 0; m < E.length; m++)
          if (!Kc(g, h, B, E[m])) {
            m++;
            E.splice(0, m);
            var V = !1;
            break a;
          }
        E.splice(0, m);
        V = !0;
      }
      if (!V) {
        a.destination = null;
        c++;
        H.splice(0, c);
        return;
      }
    }
    H.splice(0, c);
    var P = a.completedBoundaries;
    for (c = 0; c < P.length; c++)
      if (!Jc(a, b, P[c])) {
        a.destination = null;
        c++;
        P.splice(0, c);
        return;
      }
    P.splice(0, c);
  } finally {
    if (
      0 === a.allPendingTasks &&
      0 === a.pingedTasks.length &&
      0 === a.clientRenderedBoundaries.length &&
      0 === a.completedBoundaries.length
    ) {
      a = a.postamble;
      for (c = 0; c < a.length; c++) l(b, a[c]);
      b.end();
    }
  }
}
function Lc(a, b) {
  try {
    var c = a.abortableTasks;
    if (0 < c.size) {
      var d = void 0 === b ? Error("The render was aborted by the server without a reason.") : b;
      c.forEach(function (b) {
        return Ec(b, a, d);
      });
      c.clear();
    }
    null !== a.destination && Fc(a, a.destination);
  } catch (e) {
    X(a, e), Y(a, e);
  }
}
exports.renderToNodeStream = function () {
  throw Error(
    "ReactDOMServer.renderToNodeStream(): The Node Stream API is not available in Bun. Use ReactDOMServer.renderToReadableStream() instead.",
  );
};
exports.renderToReadableStream = function (a, b) {
  return new Promise(function (c, d) {
    var e,
      f,
      g = new Promise(function (a, b) {
        f = a;
        e = b;
      }),
      h = sc(
        a,
        Ha(
          b ? b.identifierPrefix : void 0,
          b ? b.nonce : void 0,
          b ? b.bootstrapScriptContent : void 0,
          b ? b.bootstrapScripts : void 0,
          b ? b.bootstrapModules : void 0,
          b ? b.unstable_externalRuntimeSrc : void 0,
        ),
        Ia(b ? b.namespaceURI : void 0),
        b ? b.progressiveChunkSize : void 0,
        b ? b.onError : void 0,
        f,
        function () {
          var a = new ReadableStream(
            {
              type: "direct",
              pull: function (a) {
                if (1 === h.status) (h.status = 2), da(a, h.fatalError);
                else if (2 !== h.status && null === h.destination) {
                  h.destination = a;
                  try {
                    Fc(h, a);
                  } catch (q) {
                    X(h, q), Y(h, q);
                  }
                }
              },
              cancel: function () {
                Lc(h);
              },
            },
            { highWaterMark: 2048 },
          );
          a.allReady = g;
          c(a);
        },
        function (a) {
          g.catch(function () {});
          d(a);
        },
        e,
      );
    if (b && b.signal) {
      var m = b.signal;
      if (m.aborted) Lc(h, m.reason);
      else {
        var k = function () {
          Lc(h, m.reason);
          m.removeEventListener("abort", k);
        };
        m.addEventListener("abort", k);
      }
    }
    vc(h);
  });
};
exports.renderToStaticNodeStream = function () {
  throw Error(
    "ReactDOMServer.renderToStaticNodeStream(): The Node Stream API is not available in Bun. Use ReactDOMServer.renderToReadableStream() instead.",
  );
};
exports.version = "18.2.0";
