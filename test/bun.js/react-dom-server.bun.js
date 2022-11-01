/**
 * @license React
 * react-dom-server.bun.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  Children,
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED as __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED$1,
} from 'react';
import {__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED} from 'react-dom';

// TODO: this is special because it gets imported during build.
//
// TODO: 18.0.0 has not been released to NPM;
// It exists as a placeholder so that DevTools can support work tag changes between releases.
// When we next publish a release, update the matching TODO in backend/renderer.js
// TODO: This module is used both by the release scripts and to expose a version
// at runtime. We should instead inject the version number as part of the build
// process, and use the ReactVersions.js module as the single source of truth.
var ReactVersion = '18.2.0';

function scheduleWork(callback) {
  callback();
}
function beginWriting(destination) {}
function writeChunk(destination, chunk) {
  if (chunk.length === 0) {
    return;
  }

  destination.write(chunk);
}
function writeChunkAndReturn(destination, chunk) {
  return !!destination.write(chunk);
}
function completeWriting(destination) {}
function close(destination) {
  destination.end();
}
function stringToChunk(content) {
  return content;
}
function stringToPrecomputedChunk(content) {
  return content;
}
function closeWithError(destination, error) {
  // $FlowFixMe[method-unbinding]
  if (typeof destination.error === 'function') {
    // $FlowFixMe: This is an Error object or the destination accepts other types.
    destination.error(error);
  } else {
    // Earlier implementations doesn't support this method. In that environment you're
    // supposed to throw from a promise returned but we don't return a promise in our
    // approach. We could fork this implementation but this is environment is an edge
    // case to begin with. It's even less common to run this in an older environment.
    // Even then, this is not where errors are supposed to happen and they get reported
    // to a global callback in addition to this anyway. So it's fine just to close this.
    destination.close();
  }
}

// -----------------------------------------------------------------------------
const enableFloat = true; // When a node is unmounted, recurse into the Fiber subtree and clean out

// $FlowFixMe[method-unbinding]
const hasOwnProperty = Object.prototype.hasOwnProperty;

// A reserved attribute.
// It is handled by React separately and shouldn't be written to the DOM.
const RESERVED = 0; // A simple string attribute.
// Attributes that aren't in the filter are presumed to have this type.

const STRING = 1; // A string attribute that accepts booleans in React. In HTML, these are called
// "enumerated" attributes with "true" and "false" as possible values.
// When true, it should be set to a "true" string.
// When false, it should be set to a "false" string.

const BOOLEANISH_STRING = 2; // A real boolean attribute.
// When true, it should be present (set either to an empty string or its name).
// When false, it should be omitted.

const BOOLEAN = 3; // An attribute that can be used as a flag as well as with a value.
// When true, it should be present (set either to an empty string or its name).
// When false, it should be omitted.
// For any other value, should be present with that value.

const OVERLOADED_BOOLEAN = 4; // An attribute that must be numeric or parse as a numeric.
// When falsy, it should be removed.

const NUMERIC = 5; // An attribute that must be positive numeric or parse as a positive numeric.
// When falsy, it should be removed.

const POSITIVE_NUMERIC = 6;

/* eslint-disable max-len */
const ATTRIBUTE_NAME_START_CHAR =
  ':A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD';
/* eslint-enable max-len */

const ATTRIBUTE_NAME_CHAR =
  ATTRIBUTE_NAME_START_CHAR + '\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040';
const VALID_ATTRIBUTE_NAME_REGEX = new RegExp(
  '^[' + ATTRIBUTE_NAME_START_CHAR + '][' + ATTRIBUTE_NAME_CHAR + ']*$'
);
const illegalAttributeNameCache = {};
const validatedAttributeNameCache = {};
function isAttributeNameSafe(attributeName) {
  if (hasOwnProperty.call(validatedAttributeNameCache, attributeName)) {
    return true;
  }

  if (hasOwnProperty.call(illegalAttributeNameCache, attributeName)) {
    return false;
  }

  if (VALID_ATTRIBUTE_NAME_REGEX.test(attributeName)) {
    validatedAttributeNameCache[attributeName] = true;
    return true;
  }

  illegalAttributeNameCache[attributeName] = true;

  return false;
}
function getPropertyInfo(name) {
  return properties.hasOwnProperty(name) ? properties[name] : null;
}

function PropertyInfoRecord(
  name,
  type,
  mustUseProperty,
  attributeName,
  attributeNamespace,
  sanitizeURL,
  removeEmptyString
) {
  this.acceptsBooleans =
    type === BOOLEANISH_STRING ||
    type === BOOLEAN ||
    type === OVERLOADED_BOOLEAN;
  this.attributeName = attributeName;
  this.attributeNamespace = attributeNamespace;
  this.mustUseProperty = mustUseProperty;
  this.propertyName = name;
  this.type = type;
  this.sanitizeURL = sanitizeURL;
  this.removeEmptyString = removeEmptyString;
} // When adding attributes to this list, be sure to also add them to
// the `possibleStandardNames` module to ensure casing and incorrect
// name warnings.

const properties = {}; // These props are reserved by React. They shouldn't be written to the DOM.

const reservedProps = [
  'children',
  'dangerouslySetInnerHTML', // TODO: This prevents the assignment of defaultValue to regular
  // elements (not just inputs). Now that ReactDOMInput assigns to the
  // defaultValue property -- do we need this?
  'defaultValue',
  'defaultChecked',
  'innerHTML',
  'suppressContentEditableWarning',
  'suppressHydrationWarning',
  'style',
];

{
  reservedProps.push('innerText', 'textContent');
}

reservedProps.forEach((name) => {
  // $FlowFixMe[invalid-constructor] Flow no longer supports calling new on functions
  properties[name] = new PropertyInfoRecord(
    name,
    RESERVED,
    false, // mustUseProperty
    name, // attributeName
    null, // attributeNamespace
    false, // sanitizeURL
    false
  );
}); // A few React string attributes have a different name.
// This is a mapping from React prop names to the attribute names.

[
  ['acceptCharset', 'accept-charset'],
  ['className', 'class'],
  ['htmlFor', 'for'],
  ['httpEquiv', 'http-equiv'],
].forEach((_ref) => {
  let name = _ref[0],
    attributeName = _ref[1];
  // $FlowFixMe[invalid-constructor] Flow no longer supports calling new on functions
  properties[name] = new PropertyInfoRecord(
    name,
    STRING,
    false, // mustUseProperty
    attributeName, // attributeName
    null, // attributeNamespace
    false, // sanitizeURL
    false
  );
}); // These are "enumerated" HTML attributes that accept "true" and "false".
// In React, we let users pass `true` and `false` even though technically
// these aren't boolean attributes (they are coerced to strings).

['contentEditable', 'draggable', 'spellCheck', 'value'].forEach((name) => {
  // $FlowFixMe[invalid-constructor] Flow no longer supports calling new on functions
  properties[name] = new PropertyInfoRecord(
    name,
    BOOLEANISH_STRING,
    false, // mustUseProperty
    name.toLowerCase(), // attributeName
    null, // attributeNamespace
    false, // sanitizeURL
    false
  );
}); // These are "enumerated" SVG attributes that accept "true" and "false".
// In React, we let users pass `true` and `false` even though technically
// these aren't boolean attributes (they are coerced to strings).
// Since these are SVG attributes, their attribute names are case-sensitive.

[
  'autoReverse',
  'externalResourcesRequired',
  'focusable',
  'preserveAlpha',
].forEach((name) => {
  // $FlowFixMe[invalid-constructor] Flow no longer supports calling new on functions
  properties[name] = new PropertyInfoRecord(
    name,
    BOOLEANISH_STRING,
    false, // mustUseProperty
    name, // attributeName
    null, // attributeNamespace
    false, // sanitizeURL
    false
  );
}); // These are HTML boolean attributes.

[
  'allowFullScreen',
  'async', // Note: there is a special case that prevents it from being written to the DOM
  // on the client side because the browsers are inconsistent. Instead we call focus().
  'autoFocus',
  'autoPlay',
  'controls',
  'default',
  'defer',
  'disabled',
  'disablePictureInPicture',
  'disableRemotePlayback',
  'formNoValidate',
  'hidden',
  'loop',
  'noModule',
  'noValidate',
  'open',
  'playsInline',
  'readOnly',
  'required',
  'reversed',
  'scoped',
  'seamless', // Microdata
  'itemScope',
].forEach((name) => {
  // $FlowFixMe[invalid-constructor] Flow no longer supports calling new on functions
  properties[name] = new PropertyInfoRecord(
    name,
    BOOLEAN,
    false, // mustUseProperty
    name.toLowerCase(), // attributeName
    null, // attributeNamespace
    false, // sanitizeURL
    false
  );
}); // These are the few React props that we set as DOM properties
// rather than attributes. These are all booleans.

[
  'checked', // Note: `option.selected` is not updated if `select.multiple` is
  // disabled with `removeAttribute`. We have special logic for handling this.
  'multiple',
  'muted',
  'selected', // NOTE: if you add a camelCased prop to this list,
  // you'll need to set attributeName to name.toLowerCase()
  // instead in the assignment below.
].forEach((name) => {
  // $FlowFixMe[invalid-constructor] Flow no longer supports calling new on functions
  properties[name] = new PropertyInfoRecord(
    name,
    BOOLEAN,
    true, // mustUseProperty
    name, // attributeName
    null, // attributeNamespace
    false, // sanitizeURL
    false
  );
}); // These are HTML attributes that are "overloaded booleans": they behave like
// booleans, but can also accept a string value.

[
  'capture',
  'download', // NOTE: if you add a camelCased prop to this list,
  // you'll need to set attributeName to name.toLowerCase()
  // instead in the assignment below.
].forEach((name) => {
  // $FlowFixMe[invalid-constructor] Flow no longer supports calling new on functions
  properties[name] = new PropertyInfoRecord(
    name,
    OVERLOADED_BOOLEAN,
    false, // mustUseProperty
    name, // attributeName
    null, // attributeNamespace
    false, // sanitizeURL
    false
  );
}); // These are HTML attributes that must be positive numbers.

[
  'cols',
  'rows',
  'size',
  'span', // NOTE: if you add a camelCased prop to this list,
  // you'll need to set attributeName to name.toLowerCase()
  // instead in the assignment below.
].forEach((name) => {
  // $FlowFixMe[invalid-constructor] Flow no longer supports calling new on functions
  properties[name] = new PropertyInfoRecord(
    name,
    POSITIVE_NUMERIC,
    false, // mustUseProperty
    name, // attributeName
    null, // attributeNamespace
    false, // sanitizeURL
    false
  );
}); // These are HTML attributes that must be numbers.

['rowSpan', 'start'].forEach((name) => {
  // $FlowFixMe[invalid-constructor] Flow no longer supports calling new on functions
  properties[name] = new PropertyInfoRecord(
    name,
    NUMERIC,
    false, // mustUseProperty
    name.toLowerCase(), // attributeName
    null, // attributeNamespace
    false, // sanitizeURL
    false
  );
});
const CAMELIZE = /[\-\:]([a-z])/g;

const capitalize = (token) => token[1].toUpperCase(); // This is a list of all SVG attributes that need special casing, namespacing,
// or boolean value assignment. Regular attributes that just accept strings
// and have the same names are omitted, just like in the HTML attribute filter.
// Some of these attributes can be hard to find. This list was created by
// scraping the MDN documentation.

[
  'accent-height',
  'alignment-baseline',
  'arabic-form',
  'baseline-shift',
  'cap-height',
  'clip-path',
  'clip-rule',
  'color-interpolation',
  'color-interpolation-filters',
  'color-profile',
  'color-rendering',
  'dominant-baseline',
  'enable-background',
  'fill-opacity',
  'fill-rule',
  'flood-color',
  'flood-opacity',
  'font-family',
  'font-size',
  'font-size-adjust',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-weight',
  'glyph-name',
  'glyph-orientation-horizontal',
  'glyph-orientation-vertical',
  'horiz-adv-x',
  'horiz-origin-x',
  'image-rendering',
  'letter-spacing',
  'lighting-color',
  'marker-end',
  'marker-mid',
  'marker-start',
  'overline-position',
  'overline-thickness',
  'paint-order',
  'panose-1',
  'pointer-events',
  'rendering-intent',
  'shape-rendering',
  'stop-color',
  'stop-opacity',
  'strikethrough-position',
  'strikethrough-thickness',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'text-anchor',
  'text-decoration',
  'text-rendering',
  'underline-position',
  'underline-thickness',
  'unicode-bidi',
  'unicode-range',
  'units-per-em',
  'v-alphabetic',
  'v-hanging',
  'v-ideographic',
  'v-mathematical',
  'vector-effect',
  'vert-adv-y',
  'vert-origin-x',
  'vert-origin-y',
  'word-spacing',
  'writing-mode',
  'xmlns:xlink',
  'x-height', // NOTE: if you add a camelCased prop to this list,
  // you'll need to set attributeName to name.toLowerCase()
  // instead in the assignment below.
].forEach((attributeName) => {
  const name = attributeName.replace(CAMELIZE, capitalize); // $FlowFixMe[invalid-constructor] Flow no longer supports calling new on functions

  properties[name] = new PropertyInfoRecord(
    name,
    STRING,
    false, // mustUseProperty
    attributeName,
    null, // attributeNamespace
    false, // sanitizeURL
    false
  );
}); // String SVG attributes with the xlink namespace.

[
  'xlink:actuate',
  'xlink:arcrole',
  'xlink:role',
  'xlink:show',
  'xlink:title',
  'xlink:type', // NOTE: if you add a camelCased prop to this list,
  // you'll need to set attributeName to name.toLowerCase()
  // instead in the assignment below.
].forEach((attributeName) => {
  const name = attributeName.replace(CAMELIZE, capitalize); // $FlowFixMe[invalid-constructor] Flow no longer supports calling new on functions

  properties[name] = new PropertyInfoRecord(
    name,
    STRING,
    false, // mustUseProperty
    attributeName,
    'http://www.w3.org/1999/xlink',
    false, // sanitizeURL
    false
  );
}); // String SVG attributes with the xml namespace.

[
  'xml:base',
  'xml:lang',
  'xml:space', // NOTE: if you add a camelCased prop to this list,
  // you'll need to set attributeName to name.toLowerCase()
  // instead in the assignment below.
].forEach((attributeName) => {
  const name = attributeName.replace(CAMELIZE, capitalize); // $FlowFixMe[invalid-constructor] Flow no longer supports calling new on functions

  properties[name] = new PropertyInfoRecord(
    name,
    STRING,
    false, // mustUseProperty
    attributeName,
    'http://www.w3.org/XML/1998/namespace',
    false, // sanitizeURL
    false
  );
}); // These attribute exists both in HTML and SVG.
// The attribute name is case-sensitive in SVG so we can't just use
// the React name like we do for attributes that exist only in HTML.

['tabIndex', 'crossOrigin'].forEach((attributeName) => {
  // $FlowFixMe[invalid-constructor] Flow no longer supports calling new on functions
  properties[attributeName] = new PropertyInfoRecord(
    attributeName,
    STRING,
    false, // mustUseProperty
    attributeName.toLowerCase(), // attributeName
    null, // attributeNamespace
    false, // sanitizeURL
    false
  );
}); // These attributes accept URLs. These must not allow javascript: URLS.
// These will also need to accept Trusted Types object in the future.

const xlinkHref = 'xlinkHref'; // $FlowFixMe[invalid-constructor] Flow no longer supports calling new on functions

properties[xlinkHref] = new PropertyInfoRecord(
  'xlinkHref',
  STRING,
  false, // mustUseProperty
  'xlink:href',
  'http://www.w3.org/1999/xlink',
  true, // sanitizeURL
  false
);
['src', 'href', 'action', 'formAction'].forEach((attributeName) => {
  // $FlowFixMe[invalid-constructor] Flow no longer supports calling new on functions
  properties[attributeName] = new PropertyInfoRecord(
    attributeName,
    STRING,
    false, // mustUseProperty
    attributeName.toLowerCase(), // attributeName
    null, // attributeNamespace
    true, // sanitizeURL
    true
  );
});

/**
 * CSS properties which accept numbers but are not in units of "px".
 */
const isUnitlessNumber = {
  animationIterationCount: true,
  aspectRatio: true,
  borderImageOutset: true,
  borderImageSlice: true,
  borderImageWidth: true,
  boxFlex: true,
  boxFlexGroup: true,
  boxOrdinalGroup: true,
  columnCount: true,
  columns: true,
  flex: true,
  flexGrow: true,
  flexPositive: true,
  flexShrink: true,
  flexNegative: true,
  flexOrder: true,
  gridArea: true,
  gridRow: true,
  gridRowEnd: true,
  gridRowSpan: true,
  gridRowStart: true,
  gridColumn: true,
  gridColumnEnd: true,
  gridColumnSpan: true,
  gridColumnStart: true,
  fontWeight: true,
  lineClamp: true,
  lineHeight: true,
  opacity: true,
  order: true,
  orphans: true,
  tabSize: true,
  widows: true,
  zIndex: true,
  zoom: true,
  // SVG-related properties
  fillOpacity: true,
  floodOpacity: true,
  stopOpacity: true,
  strokeDasharray: true,
  strokeDashoffset: true,
  strokeMiterlimit: true,
  strokeOpacity: true,
  strokeWidth: true,
};
/**
 * @param {string} prefix vendor-specific prefix, eg: Webkit
 * @param {string} key style name, eg: transitionDuration
 * @return {string} style name prefixed with `prefix`, properly camelCased, eg:
 * WebkitTransitionDuration
 */

function prefixKey(prefix, key) {
  return prefix + key.charAt(0).toUpperCase() + key.substring(1);
}
/**
 * Support style names that may come passed in prefixed by adding permutations
 * of vendor prefixes.
 */

const prefixes = ['Webkit', 'ms', 'Moz', 'O']; // Using Object.keys here, or else the vanilla for-in loop makes IE8 go into an
// infinite loop, because it iterates over the newly added props too.

Object.keys(isUnitlessNumber).forEach(function (prop) {
  prefixes.forEach(function (prefix) {
    isUnitlessNumber[prefixKey(prefix, prop)] = isUnitlessNumber[prop];
  });
});

// code copied and modified from escape-html
const matchHtmlRegExp = /["'&<>]/;
/**
 * Escapes special characters and HTML entities in a given html string.
 *
 * @param  {string} string HTML string to escape for later insertion
 * @return {string}
 * @public
 */

function escapeHtml(string) {
  const str = '' + string;
  const match = matchHtmlRegExp.exec(str);

  if (!match) {
    return str;
  }

  let escape;
  let html = '';
  let index;
  let lastIndex = 0;

  for (index = match.index; index < str.length; index++) {
    switch (str.charCodeAt(index)) {
      case 34:
        // "
        escape = '&quot;';
        break;

      case 38:
        // &
        escape = '&amp;';
        break;

      case 39:
        // '
        escape = '&#x27;'; // modified from escape-html; used to be '&#39'

        break;

      case 60:
        // <
        escape = '&lt;';
        break;

      case 62:
        // >
        escape = '&gt;';
        break;

      default:
        continue;
    }

    if (lastIndex !== index) {
      html += str.substring(lastIndex, index);
    }

    lastIndex = index + 1;
    html += escape;
  }

  return lastIndex !== index ? html + str.substring(lastIndex, index) : html;
} // end code copied and modified from escape-html

/**
 * Escapes text to prevent scripting attacks.
 *
 * @param {*} text Text value to escape.
 * @return {string} An escaped string.
 */

function escapeTextForBrowser(text) {
  if (typeof text === 'boolean' || typeof text === 'number') {
    // this shortcircuit helps perf for types that we know will never have
    // special characters, especially given that this function is used often
    // for numeric dom ids.
    return '' + text;
  }

  return escapeHtml(text);
}

const uppercasePattern = /([A-Z])/g;
const msPattern = /^ms-/;
/**
 * Hyphenates a camelcased CSS property name, for example:
 *
 *   > hyphenateStyleName('backgroundColor')
 *   < "background-color"
 *   > hyphenateStyleName('MozTransition')
 *   < "-moz-transition"
 *   > hyphenateStyleName('msTransition')
 *   < "-ms-transition"
 *
 * As Modernizr suggests (http://modernizr.com/docs/#prefixed), an `ms` prefix
 * is converted to `-ms-`.
 */

function hyphenateStyleName(name) {
  return name
    .replace(uppercasePattern, '-$1')
    .toLowerCase()
    .replace(msPattern, '-ms-');
}

const isArrayImpl = Array.isArray; // eslint-disable-next-line no-redeclare

function isArray(a) {
  return isArrayImpl(a);
}

const assign = Object.assign;

// @TODO add bootstrap script to implicit preloads
function createResources() {
  return {
    // persistent
    preloadsMap: new Map(),
    stylesMap: new Map(),
    scriptsMap: new Map(),
    headsMap: new Map(),
    // cleared on flush
    charset: null,
    bases: new Set(),
    preconnects: new Set(),
    fontPreloads: new Set(),
    // usedImagePreloads: new Set(),
    precedences: new Map(),
    usedStylePreloads: new Set(),
    scripts: new Set(),
    usedScriptPreloads: new Set(),
    explicitStylePreloads: new Set(),
    // explicitImagePreloads: new Set(),
    explicitScriptPreloads: new Set(),
    headResources: new Set(),
    // cache for tracking structured meta tags
    structuredMetaKeys: new Map(),
    // like a module global for currently rendering boundary
    boundaryResources: null,
  };
}
function createBoundaryResources() {
  return new Set();
}
let currentResources = null;
const currentResourcesStack = [];
function prepareToRenderResources(resources) {
  currentResourcesStack.push(currentResources);
  currentResources = resources;
}
function finishRenderingResources() {
  currentResources = currentResourcesStack.pop();
}
function setCurrentlyRenderingBoundaryResourcesTarget(
  resources,
  boundaryResources
) {
  resources.boundaryResources = boundaryResources;
}
const ReactDOMServerDispatcher = {
  preload,
  preinit,
};

function preload(href, options) {
  if (!currentResources) {
    // While we expect that preload calls are primarily going to be observed
    // during render because effects and events don't run on the server it is
    // still possible that these get called in module scope. This is valid on
    // the client since there is still a document to interact with but on the
    // server we need a request to associate the call to. Because of this we
    // simply return and do not warn.
    return;
  }

  const resources = currentResources;

  if (
    typeof href === 'string' &&
    href &&
    typeof options === 'object' &&
    options !== null
  ) {
    const as = options.as;
    let resource = resources.preloadsMap.get(href);

    if (resource);
    else {
      resource = createPreloadResource(
        resources,
        href,
        as,
        preloadPropsFromPreloadOptions(href, as, options)
      );
    }

    switch (as) {
      case 'font': {
        resources.fontPreloads.add(resource);
        break;
      }

      case 'style': {
        resources.explicitStylePreloads.add(resource);
        break;
      }

      case 'script': {
        resources.explicitScriptPreloads.add(resource);
        break;
      }
    }
  }
}

function preinit(href, options) {
  if (!currentResources) {
    // While we expect that preinit calls are primarily going to be observed
    // during render because effects and events don't run on the server it is
    // still possible that these get called in module scope. This is valid on
    // the client since there is still a document to interact with but on the
    // server we need a request to associate the call to. Because of this we
    // simply return and do not warn.
    return;
  }

  const resources = currentResources;

  if (
    typeof href === 'string' &&
    href &&
    typeof options === 'object' &&
    options !== null
  ) {
    const as = options.as;

    switch (as) {
      case 'style': {
        let resource = resources.stylesMap.get(href);

        if (resource);
        else {
          const precedence = options.precedence || 'default';
          const resourceProps = stylePropsFromPreinitOptions(
            href,
            precedence,
            options
          );
          resource = createStyleResource(
            resources,
            href,
            precedence,
            resourceProps
          );
        }

        resource.set.add(resource);
        resources.explicitStylePreloads.add(resource.hint);
        return;
      }

      case 'script': {
        const src = href;
        let resource = resources.scriptsMap.get(src);

        if (resource);
        else {
          const scriptProps = scriptPropsFromPreinitOptions(src, options);
          resource = createScriptResource(resources, src, scriptProps);
          resources.scripts.add(resource);
        }

        return;
      }
    }
  }
}

function preloadPropsFromPreloadOptions(href, as, options) {
  return {
    href,
    rel: 'preload',
    as,
    crossOrigin: as === 'font' ? '' : options.crossOrigin,
    integrity: options.integrity,
  };
}

function preloadPropsFromRawProps(href, as, rawProps) {
  const props = assign({}, rawProps);

  props.href = href;
  props.rel = 'preload';
  props.as = as;

  if (as === 'font') {
    // Font preloads always need CORS anonymous mode so we set it here
    // regardless of the props provided. This should warn elsewhere in
    // dev
    props.crossOrigin = '';
  }

  return props;
}

function preloadAsStylePropsFromProps(href, props) {
  return {
    rel: 'preload',
    as: 'style',
    href: href,
    crossOrigin: props.crossOrigin,
    integrity: props.integrity,
    media: props.media,
    hrefLang: props.hrefLang,
    referrerPolicy: props.referrerPolicy,
  };
}

function preloadAsScriptPropsFromProps(href, props) {
  return {
    rel: 'preload',
    as: 'script',
    href,
    crossOrigin: props.crossOrigin,
    integrity: props.integrity,
    referrerPolicy: props.referrerPolicy,
  };
}

function createPreloadResource(resources, href, as, props) {
  const preloadsMap = resources.preloadsMap;

  const resource = {
    type: 'preload',
    as,
    href,
    flushed: false,
    props,
  };
  preloadsMap.set(href, resource);
  return resource;
}

function stylePropsFromRawProps(href, precedence, rawProps) {
  const props = assign({}, rawProps);

  props.href = href;
  props.rel = 'stylesheet';
  props['data-precedence'] = precedence;
  delete props.precedence;
  return props;
}

function stylePropsFromPreinitOptions(href, precedence, options) {
  return {
    rel: 'stylesheet',
    href,
    'data-precedence': precedence,
    crossOrigin: options.crossOrigin,
  };
}

function createStyleResource(resources, href, precedence, props) {
  const stylesMap = resources.stylesMap,
    preloadsMap = resources.preloadsMap,
    precedences = resources.precedences; // If this is the first time we've seen this precedence we encode it's position in our set even though
  // we don't add the resource to this set yet

  let precedenceSet = precedences.get(precedence);

  if (!precedenceSet) {
    precedenceSet = new Set();
    precedences.set(precedence, precedenceSet);
  }

  let hint = preloadsMap.get(href);

  if (hint) {
    // If a preload for this style Resource already exists there are certain props we want to adopt
    // on the style Resource, primarily focussed on making sure the style network pathways utilize
    // the preload pathways. For instance if you have diffreent crossOrigin attributes for a preload
    // and a stylesheet the stylesheet will make a new request even if the preload had already loaded
    adoptPreloadPropsForStyleProps(props, hint.props);
  } else {
    const preloadResourceProps = preloadAsStylePropsFromProps(href, props);
    hint = createPreloadResource(
      resources,
      href,
      'style',
      preloadResourceProps
    );

    resources.explicitStylePreloads.add(hint);
  }

  const resource = {
    type: 'style',
    href,
    precedence,
    flushed: false,
    inShell: false,
    props,
    hint,
    set: precedenceSet,
  };
  stylesMap.set(href, resource);
  return resource;
}

function adoptPreloadPropsForStyleProps(resourceProps, preloadProps) {
  if (resourceProps.crossOrigin == null)
    resourceProps.crossOrigin = preloadProps.crossOrigin;
  if (resourceProps.referrerPolicy == null)
    resourceProps.referrerPolicy = preloadProps.referrerPolicy;
  if (resourceProps.title == null) resourceProps.title = preloadProps.title;
}

function scriptPropsFromPreinitOptions(src, options) {
  return {
    src,
    async: true,
    crossOrigin: options.crossOrigin,
    integrity: options.integrity,
  };
}

function scriptPropsFromRawProps(src, rawProps) {
  const props = assign({}, rawProps);

  props.src = src;
  return props;
}

function createScriptResource(resources, src, props) {
  const scriptsMap = resources.scriptsMap,
    preloadsMap = resources.preloadsMap;
  let hint = preloadsMap.get(src);

  if (hint) {
    // If a preload for this style Resource already exists there are certain props we want to adopt
    // on the style Resource, primarily focussed on making sure the style network pathways utilize
    // the preload pathways. For instance if you have diffreent crossOrigin attributes for a preload
    // and a stylesheet the stylesheet will make a new request even if the preload had already loaded
    adoptPreloadPropsForScriptProps(props, hint.props);
  } else {
    const preloadResourceProps = preloadAsScriptPropsFromProps(src, props);
    hint = createPreloadResource(
      resources,
      src,
      'script',
      preloadResourceProps
    );

    resources.explicitScriptPreloads.add(hint);
  }

  const resource = {
    type: 'script',
    src,
    flushed: false,
    props,
    hint,
  };
  scriptsMap.set(src, resource);
  return resource;
}

function adoptPreloadPropsForScriptProps(resourceProps, preloadProps) {
  if (resourceProps.crossOrigin == null)
    resourceProps.crossOrigin = preloadProps.crossOrigin;
  if (resourceProps.referrerPolicy == null)
    resourceProps.referrerPolicy = preloadProps.referrerPolicy;
  if (resourceProps.integrity == null)
    resourceProps.integrity = preloadProps.integrity;
}

function titlePropsFromRawProps(child, rawProps) {
  const props = assign({}, rawProps);

  props.children = child;
  return props;
}

function resourcesFromElement(type, props) {
  if (!currentResources) {
    throw new Error(
      '"currentResources" was expected to exist. This is a bug in React.'
    );
  }

  const resources = currentResources;

  switch (type) {
    case 'title': {
      let child = props.children;

      if (Array.isArray(child) && child.length === 1) {
        child = child[0];
      }

      if (typeof child === 'string' || typeof child === 'number') {
        const key = 'title::' + child;
        let resource = resources.headsMap.get(key);

        if (!resource) {
          resource = {
            type: 'title',
            props: titlePropsFromRawProps(child, props),
            flushed: false,
          };
          resources.headsMap.set(key, resource);
          resources.headResources.add(resource);
        }
      }

      return true;
    }

    case 'meta': {
      let key, propertyPath;

      if (typeof props.charSet === 'string') {
        key = 'charSet';
      } else if (typeof props.content === 'string') {
        const contentKey = '::' + props.content;

        if (typeof props.httpEquiv === 'string') {
          key = 'httpEquiv::' + props.httpEquiv + contentKey;
        } else if (typeof props.name === 'string') {
          key = 'name::' + props.name + contentKey;
        } else if (typeof props.itemProp === 'string') {
          key = 'itemProp::' + props.itemProp + contentKey;
        } else if (typeof props.property === 'string') {
          const property = props.property;
          key = 'property::' + property + contentKey;
          propertyPath = property;
          const parentPath = property.split(':').slice(0, -1).join(':');
          const parentResource = resources.structuredMetaKeys.get(parentPath);

          if (parentResource) {
            key = parentResource.key + '::child::' + key;
          }
        }
      }

      if (key) {
        if (!resources.headsMap.has(key)) {
          const resource = {
            type: 'meta',
            key,
            props: assign({}, props),
            flushed: false,
          };
          resources.headsMap.set(key, resource);

          if (key === 'charSet') {
            resources.charset = resource;
          } else {
            if (propertyPath) {
              resources.structuredMetaKeys.set(propertyPath, resource);
            }

            resources.headResources.add(resource);
          }
        }
      }

      return true;
    }

    case 'base': {
      const target = props.target,
        href = props.href; // We mirror the key construction on the client since we will likely unify
      // this code in the future to better guarantee key semantics are identical
      // in both environments

      let key = 'base';
      key +=
        typeof href === 'string' ? '[href="' + href + '"]' : ':not([href])';
      key +=
        typeof target === 'string'
          ? '[target="' + target + '"]'
          : ':not([target])';

      if (!resources.headsMap.has(key)) {
        const resource = {
          type: 'base',
          props: assign({}, props),
          flushed: false,
        };
        resources.headsMap.set(key, resource);
        resources.bases.add(resource);
      }

      return true;
    }
  }

  return false;
} // Construct a resource from link props.

function resourcesFromLink(props) {
  if (!currentResources) {
    throw new Error(
      '"currentResources" was expected to exist. This is a bug in React.'
    );
  }

  const resources = currentResources;
  const rel = props.rel,
    href = props.href;

  if (!href || typeof href !== 'string' || !rel || typeof rel !== 'string') {
    return false;
  }

  let key = '';

  switch (rel) {
    case 'stylesheet': {
      const onLoad = props.onLoad,
        onError = props.onError,
        precedence = props.precedence,
        disabled = props.disabled;

      if (
        typeof precedence !== 'string' ||
        onLoad ||
        onError ||
        disabled != null
      ) {
        let preloadResource = resources.preloadsMap.get(href);

        if (!preloadResource) {
          preloadResource = createPreloadResource(
            // $FlowFixMe[incompatible-call] found when upgrading Flow
            resources,
            href,
            'style',
            preloadAsStylePropsFromProps(href, props)
          );

          resources.usedStylePreloads.add(preloadResource);
        }

        return false;
      } else {
        // We are able to convert this link element to a resource exclusively. We construct the relevant Resource
        // and return true indicating that this link was fully consumed.
        let resource = resources.stylesMap.get(href);

        if (resource);
        else {
          const resourceProps = stylePropsFromRawProps(href, precedence, props);
          resource = createStyleResource(
            // $FlowFixMe[incompatible-call] found when upgrading Flow
            currentResources,
            href,
            precedence,
            resourceProps
          );
          resources.usedStylePreloads.add(resource.hint);
        }

        if (resources.boundaryResources) {
          resources.boundaryResources.add(resource);
        } else {
          resource.set.add(resource);
        }

        return true;
      }
    }

    case 'preload': {
      const as = props.as;

      switch (as) {
        case 'script':
        case 'style':
        case 'font': {
          let resource = resources.preloadsMap.get(href);

          if (resource);
          else {
            resource = createPreloadResource(
              resources,
              href,
              as,
              preloadPropsFromRawProps(href, as, props)
            );

            switch (as) {
              case 'script': {
                resources.explicitScriptPreloads.add(resource);
                break;
              }

              case 'style': {
                resources.explicitStylePreloads.add(resource);
                break;
              }

              case 'font': {
                resources.fontPreloads.add(resource);
                break;
              }
            }
          }

          return true;
        }
      }

      break;
    }
  }

  if (props.onLoad || props.onError) {
    // When a link has these props we can't treat it is a Resource but if we rendered it on the
    // server it would look like a Resource in the rendered html (the onLoad/onError aren't emitted)
    // Instead we expect the client to insert them rather than hydrate them which also guarantees
    // that the onLoad and onError won't fire before the event handlers are attached
    return true;
  }

  const sizes = typeof props.sizes === 'string' ? props.sizes : '';
  const media = typeof props.media === 'string' ? props.media : '';
  key =
    'rel:' + rel + '::href:' + href + '::sizes:' + sizes + '::media:' + media;
  let resource = resources.headsMap.get(key);

  if (!resource) {
    resource = {
      type: 'link',
      props: assign({}, props),
      flushed: false,
    };
    resources.headsMap.set(key, resource);

    switch (rel) {
      case 'preconnect':
      case 'dns-prefetch': {
        resources.preconnects.add(resource);
        break;
      }

      default: {
        resources.headResources.add(resource);
      }
    }
  }

  return true;
} // Construct a resource from link props.

function resourcesFromScript(props) {
  if (!currentResources) {
    throw new Error(
      '"currentResources" was expected to exist. This is a bug in React.'
    );
  }

  const resources = currentResources;
  const src = props.src,
    async = props.async,
    onLoad = props.onLoad,
    onError = props.onError;

  if (!src || typeof src !== 'string') {
    return false;
  }

  if (async) {
    if (onLoad || onError) {
      let preloadResource = resources.preloadsMap.get(src);

      if (!preloadResource) {
        preloadResource = createPreloadResource(
          // $FlowFixMe[incompatible-call] found when upgrading Flow
          resources,
          src,
          'script',
          preloadAsScriptPropsFromProps(src, props)
        );

        resources.usedScriptPreloads.add(preloadResource);
      }
    } else {
      let resource = resources.scriptsMap.get(src);

      if (resource);
      else {
        const resourceProps = scriptPropsFromRawProps(src, props);
        resource = createScriptResource(resources, src, resourceProps);
        resources.scripts.add(resource);
      }
    }

    return true;
  }

  return false;
}
function hoistResources(resources, source) {
  const currentBoundaryResources = resources.boundaryResources;

  if (currentBoundaryResources) {
    source.forEach((resource) => currentBoundaryResources.add(resource));
    source.clear();
  }
}
function hoistResourcesToRoot(resources, boundaryResources) {
  boundaryResources.forEach((resource) => resource.set.add(resource));
  boundaryResources.clear();
}

// The build script is at scripts/rollup/generate-inline-fizz-runtime.js.
// Run `yarn generate-inline-fizz-runtime` to generate.
const clientRenderBoundary =
  '$RX=function(b,c,d,e){var a=document.getElementById(b);a&&(b=a.previousSibling,b.data="$!",a=a.dataset,c&&(a.dgst=c),d&&(a.msg=d),e&&(a.stck=e),b._reactRetry&&b._reactRetry())};';
const completeBoundary =
  '$RC=function(b,c,e){c=document.getElementById(c);c.parentNode.removeChild(c);var a=document.getElementById(b);if(a){b=a.previousSibling;if(e)b.data="$!",a.setAttribute("data-dgst",e);else{e=b.parentNode;a=b.nextSibling;var f=0;do{if(a&&8===a.nodeType){var d=a.data;if("/$"===d)if(0===f)break;else f--;else"$"!==d&&"$?"!==d&&"$!"!==d||f++}d=a.nextSibling;e.removeChild(a);a=d}while(a);for(;c.firstChild;)e.insertBefore(c.firstChild,a);b.data="$"}b._reactRetry&&b._reactRetry()}};';
const completeBoundaryWithStyles =
  '$RM=new Map;\n$RR=function(p,q,v){function r(l){this.s=l}for(var t=$RC,u=$RM,m=new Map,n=document,g,e,f=n.querySelectorAll("link[data-precedence],style[data-precedence]"),d=0;e=f[d++];)m.set(e.dataset.precedence,g=e);e=0;f=[];for(var c,h,b,a;c=v[e++];){var k=0;h=c[k++];if(b=u.get(h))"l"!==b.s&&f.push(b);else{a=n.createElement("link");a.href=h;a.rel="stylesheet";for(a.dataset.precedence=d=c[k++];b=c[k++];)a.setAttribute(b,c[k++]);b=a._p=new Promise(function(l,w){a.onload=l;a.onerror=w});b.then(r.bind(b,\n"l"),r.bind(b,"e"));u.set(h,b);f.push(b);c=m.get(d)||g;c===g&&(g=a);m.set(d,a);c?c.parentNode.insertBefore(a,c.nextSibling):(d=n.head,d.insertBefore(a,d.firstChild))}}Promise.all(f).then(t.bind(null,p,q,""),t.bind(null,p,q,"Resource failed to load"))};';
const completeSegment =
  '$RS=function(a,b){a=document.getElementById(a);b=document.getElementById(b);for(a.parentNode.removeChild(a);a.firstChild;)b.parentNode.insertBefore(a.firstChild,b);b.parentNode.removeChild(b)};';

const ReactDOMSharedInternals =
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

const ReactDOMCurrentDispatcher = ReactDOMSharedInternals.Dispatcher;
function prepareToRender(resources) {
  prepareToRenderResources(resources);
  const previousHostDispatcher = ReactDOMCurrentDispatcher.current;
  ReactDOMCurrentDispatcher.current = ReactDOMServerDispatcher;
  return previousHostDispatcher;
}
function cleanupAfterRender(previousDispatcher) {
  finishRenderingResources();
  ReactDOMCurrentDispatcher.current = previousDispatcher;
} // Used to distinguish these contexts from ones used in other renderers.

const startInlineScript = stringToPrecomputedChunk('<script>');
const endInlineScript = stringToPrecomputedChunk('</script>');
const startScriptSrc = stringToPrecomputedChunk('<script src="');
const startModuleSrc = stringToPrecomputedChunk('<script type="module" src="');
const scriptIntegirty = stringToPrecomputedChunk('" integrity="');
const endAsyncScript = stringToPrecomputedChunk('" async=""></script>');
/**
 * This escaping function is designed to work with bootstrapScriptContent only.
 * because we know we are escaping the entire script. We can avoid for instance
 * escaping html comment string sequences that are valid javascript as well because
 * if there are no sebsequent <script sequences the html parser will never enter
 * script data double escaped state (see: https://www.w3.org/TR/html53/syntax.html#script-data-double-escaped-state)
 *
 * While untrusted script content should be made safe before using this api it will
 * ensure that the script cannot be early terminated or never terminated state
 */

function escapeBootstrapScriptContent(scriptText) {
  return ('' + scriptText).replace(scriptRegex, scriptReplacer);
}

const scriptRegex = /(<\/|<)(s)(cript)/gi;

const scriptReplacer = (match, prefix, s, suffix) =>
  '' + prefix + (s === 's' ? '\\u0073' : '\\u0053') + suffix;

// Allows us to keep track of what we've already written so we can refer back to it.
function createResponseState(
  identifierPrefix,
  nonce,
  bootstrapScriptContent,
  bootstrapScripts,
  bootstrapModules,
  externalRuntimeConfig
) {
  const idPrefix = identifierPrefix === undefined ? '' : identifierPrefix;
  const inlineScriptWithNonce =
    nonce === undefined
      ? startInlineScript
      : stringToPrecomputedChunk(
          '<script nonce="' + escapeTextForBrowser(nonce) + '">'
        );
  const bootstrapChunks = [];

  if (bootstrapScriptContent !== undefined) {
    bootstrapChunks.push(
      inlineScriptWithNonce,
      stringToChunk(escapeBootstrapScriptContent(bootstrapScriptContent)),
      endInlineScript
    );
  }

  if (bootstrapScripts !== undefined) {
    for (let i = 0; i < bootstrapScripts.length; i++) {
      const scriptConfig = bootstrapScripts[i];
      const src =
        typeof scriptConfig === 'string' ? scriptConfig : scriptConfig.src;
      const integrity =
        typeof scriptConfig === 'string' ? undefined : scriptConfig.integrity;
      bootstrapChunks.push(
        startScriptSrc,
        stringToChunk(escapeTextForBrowser(src))
      );

      if (integrity) {
        bootstrapChunks.push(
          scriptIntegirty,
          stringToChunk(escapeTextForBrowser(integrity))
        );
      }

      bootstrapChunks.push(endAsyncScript);
    }
  }

  if (bootstrapModules !== undefined) {
    for (let i = 0; i < bootstrapModules.length; i++) {
      const scriptConfig = bootstrapModules[i];
      const src =
        typeof scriptConfig === 'string' ? scriptConfig : scriptConfig.src;
      const integrity =
        typeof scriptConfig === 'string' ? undefined : scriptConfig.integrity;
      bootstrapChunks.push(
        startModuleSrc,
        stringToChunk(escapeTextForBrowser(src))
      );

      if (integrity) {
        bootstrapChunks.push(
          scriptIntegirty,
          stringToChunk(escapeTextForBrowser(integrity))
        );
      }

      bootstrapChunks.push(endAsyncScript);
    }
  }

  return {
    bootstrapChunks: bootstrapChunks,
    startInlineScript: inlineScriptWithNonce,
    placeholderPrefix: stringToPrecomputedChunk(idPrefix + 'P:'),
    segmentPrefix: stringToPrecomputedChunk(idPrefix + 'S:'),
    boundaryPrefix: idPrefix + 'B:',
    idPrefix: idPrefix,
    nextSuspenseID: 0,
    sentCompleteSegmentFunction: false,
    sentCompleteBoundaryFunction: false,
    sentClientRenderFunction: false,
    sentStyleInsertionFunction: false,
  };
} // Constants for the insertion mode we're currently writing in. We don't encode all HTML5 insertion
// modes. We only include the variants as they matter for the sake of our purposes.
// We don't actually provide the namespace therefore we use constants instead of the string.

const ROOT_HTML_MODE = 0; // Used for the root most element tag.

const HTML_MODE = 1;
const SVG_MODE = 2;
const MATHML_MODE = 3;
const HTML_TABLE_MODE = 4;
const HTML_TABLE_BODY_MODE = 5;
const HTML_TABLE_ROW_MODE = 6;
const HTML_COLGROUP_MODE = 7; // We have a greater than HTML_TABLE_MODE check elsewhere. If you add more cases here, make sure it
// still makes sense

function createFormatContext(insertionMode, selectedValue, noscriptTagInScope) {
  return {
    insertionMode,
    selectedValue,
    noscriptTagInScope,
  };
}

function createRootFormatContext(namespaceURI) {
  const insertionMode =
    namespaceURI === 'http://www.w3.org/2000/svg'
      ? SVG_MODE
      : namespaceURI === 'http://www.w3.org/1998/Math/MathML'
      ? MATHML_MODE
      : ROOT_HTML_MODE;
  return createFormatContext(insertionMode, null, false);
}
function getChildFormatContext(parentContext, type, props) {
  switch (type) {
    case 'noscript':
      return createFormatContext(HTML_MODE, null, true);

    case 'select':
      return createFormatContext(
        HTML_MODE,
        props.value != null ? props.value : props.defaultValue,
        parentContext.noscriptTagInScope
      );

    case 'svg':
      return createFormatContext(
        SVG_MODE,
        null,
        parentContext.noscriptTagInScope
      );

    case 'math':
      return createFormatContext(
        MATHML_MODE,
        null,
        parentContext.noscriptTagInScope
      );

    case 'foreignObject':
      return createFormatContext(
        HTML_MODE,
        null,
        parentContext.noscriptTagInScope
      );
    // Table parents are special in that their children can only be created at all if they're
    // wrapped in a table parent. So we need to encode that we're entering this mode.

    case 'table':
      return createFormatContext(
        HTML_TABLE_MODE,
        null,
        parentContext.noscriptTagInScope
      );

    case 'thead':
    case 'tbody':
    case 'tfoot':
      return createFormatContext(
        HTML_TABLE_BODY_MODE,
        null,
        parentContext.noscriptTagInScope
      );

    case 'colgroup':
      return createFormatContext(
        HTML_COLGROUP_MODE,
        null,
        parentContext.noscriptTagInScope
      );

    case 'tr':
      return createFormatContext(
        HTML_TABLE_ROW_MODE,
        null,
        parentContext.noscriptTagInScope
      );
  }

  if (parentContext.insertionMode >= HTML_TABLE_MODE) {
    // Whatever tag this was, it wasn't a table parent or other special parent, so we must have
    // entered plain HTML again.
    return createFormatContext(
      HTML_MODE,
      null,
      parentContext.noscriptTagInScope
    );
  }

  if (parentContext.insertionMode === ROOT_HTML_MODE) {
    // We've emitted the root and is now in plain HTML mode.
    return createFormatContext(
      HTML_MODE,
      null,
      parentContext.noscriptTagInScope
    );
  }

  return parentContext;
}
const UNINITIALIZED_SUSPENSE_BOUNDARY_ID = null;
function assignSuspenseBoundaryID(responseState) {
  const generatedID = responseState.nextSuspenseID++;
  return stringToPrecomputedChunk(
    responseState.boundaryPrefix + generatedID.toString(16)
  );
}
function makeId(responseState, treeId, localId) {
  const idPrefix = responseState.idPrefix;
  let id = ':' + idPrefix + 'R' + treeId; // Unless this is the first id at this level, append a number at the end
  // that represents the position of this useId hook among all the useId
  // hooks for this fiber.

  if (localId > 0) {
    id += 'H' + localId.toString(32);
  }

  return id + ':';
}

function encodeHTMLTextNode(text) {
  return escapeTextForBrowser(text);
}

const textSeparator = stringToPrecomputedChunk('<!-- -->');
function pushTextInstance(target, text, responseState, textEmbedded) {
  if (text === '') {
    // Empty text doesn't have a DOM node representation and the hydration is aware of this.
    return textEmbedded;
  }

  if (textEmbedded) {
    target.push(textSeparator);
  }

  target.push(stringToChunk(encodeHTMLTextNode(text)));
  return true;
} // Called when Fizz is done with a Segment. Currently the only purpose is to conditionally
// emit a text separator when we don't know for sure it is safe to omit

function pushSegmentFinale(
  target,
  responseState,
  lastPushedText,
  textEmbedded
) {
  if (lastPushedText && textEmbedded) {
    target.push(textSeparator);
  }
}
const styleNameCache = new Map();

function processStyleName(styleName) {
  const chunk = styleNameCache.get(styleName);

  if (chunk !== undefined) {
    return chunk;
  }

  const result = stringToPrecomputedChunk(
    escapeTextForBrowser(hyphenateStyleName(styleName))
  );
  styleNameCache.set(styleName, result);
  return result;
}

const styleAttributeStart = stringToPrecomputedChunk(' style="');
const styleAssign = stringToPrecomputedChunk(':');
const styleSeparator = stringToPrecomputedChunk(';');

function pushStyle(target, responseState, style) {
  if (typeof style !== 'object') {
    throw new Error(
      'The `style` prop expects a mapping from style properties to values, ' +
        "not a string. For example, style={{marginRight: spacing + 'em'}} when " +
        'using JSX.'
    );
  }

  let isFirst = true;

  for (const styleName in style) {
    if (!hasOwnProperty.call(style, styleName)) {
      continue;
    } // If you provide unsafe user data here they can inject arbitrary CSS
    // which may be problematic (I couldn't repro this):
    // https://www.owasp.org/index.php/XSS_Filter_Evasion_Cheat_Sheet
    // http://www.thespanner.co.uk/2007/11/26/ultimate-xss-css-injection/
    // This is not an XSS hole but instead a potential CSS injection issue
    // which has lead to a greater discussion about how we're going to
    // trust URLs moving forward. See #2115901

    const styleValue = style[styleName];

    if (
      styleValue == null ||
      typeof styleValue === 'boolean' ||
      styleValue === ''
    ) {
      // TODO: We used to set empty string as a style with an empty value. Does that ever make sense?
      continue;
    }

    let nameChunk;
    let valueChunk;
    const isCustomProperty = styleName.indexOf('--') === 0;

    if (isCustomProperty) {
      nameChunk = stringToChunk(escapeTextForBrowser(styleName));

      valueChunk = stringToChunk(
        escapeTextForBrowser(('' + styleValue).trim())
      );
    } else {
      nameChunk = processStyleName(styleName);

      if (typeof styleValue === 'number') {
        if (
          styleValue !== 0 &&
          !hasOwnProperty.call(isUnitlessNumber, styleName)
        ) {
          valueChunk = stringToChunk(styleValue + 'px'); // Presumes implicit 'px' suffix for unitless numbers
        } else {
          valueChunk = stringToChunk('' + styleValue);
        }
      } else {
        valueChunk = stringToChunk(
          escapeTextForBrowser(('' + styleValue).trim())
        );
      }
    }

    if (isFirst) {
      isFirst = false; // If it's first, we don't need any separators prefixed.

      target.push(styleAttributeStart, nameChunk, styleAssign, valueChunk);
    } else {
      target.push(styleSeparator, nameChunk, styleAssign, valueChunk);
    }
  }

  if (!isFirst) {
    target.push(attributeEnd);
  }
}

const attributeSeparator = stringToPrecomputedChunk(' ');
const attributeAssign = stringToPrecomputedChunk('="');
const attributeEnd = stringToPrecomputedChunk('"');
const attributeEmptyString = stringToPrecomputedChunk('=""');

function pushAttribute(target, responseState, name, value) {
  switch (name) {
    case 'style': {
      pushStyle(target, responseState, value);
      return;
    }

    case 'defaultValue':
    case 'defaultChecked': // These shouldn't be set as attributes on generic HTML elements.

    case 'innerHTML': // Must use dangerouslySetInnerHTML instead.

    case 'suppressContentEditableWarning':
    case 'suppressHydrationWarning':
      // Ignored. These are built-in to React on the client.
      return;
  }

  if (
    // shouldIgnoreAttribute
    // We have already filtered out null/undefined and reserved words.
    name.length > 2 &&
    (name[0] === 'o' || name[0] === 'O') &&
    (name[1] === 'n' || name[1] === 'N')
  ) {
    return;
  }

  const propertyInfo = getPropertyInfo(name);

  if (propertyInfo !== null) {
    // shouldRemoveAttribute
    switch (typeof value) {
      case 'function':
      case 'symbol':
        // eslint-disable-line
        return;

      case 'boolean': {
        if (!propertyInfo.acceptsBooleans) {
          return;
        }
      }
    }

    const attributeName = propertyInfo.attributeName;
    const attributeNameChunk = stringToChunk(attributeName); // TODO: If it's known we can cache the chunk.

    switch (propertyInfo.type) {
      case BOOLEAN:
        if (value) {
          target.push(
            attributeSeparator,
            attributeNameChunk,
            attributeEmptyString
          );
        }

        return;

      case OVERLOADED_BOOLEAN:
        if (value === true) {
          target.push(
            attributeSeparator,
            attributeNameChunk,
            attributeEmptyString
          );
        } else if (value === false);
        else {
          target.push(
            attributeSeparator,
            attributeNameChunk,
            attributeAssign,
            stringToChunk(escapeTextForBrowser(value)),
            attributeEnd
          );
        }

        return;

      case NUMERIC:
        if (!isNaN(value)) {
          target.push(
            attributeSeparator,
            attributeNameChunk,
            attributeAssign,
            stringToChunk(escapeTextForBrowser(value)),
            attributeEnd
          );
        }

        break;

      case POSITIVE_NUMERIC:
        if (!isNaN(value) && value >= 1) {
          target.push(
            attributeSeparator,
            attributeNameChunk,
            attributeAssign,
            stringToChunk(escapeTextForBrowser(value)),
            attributeEnd
          );
        }

        break;

      default:
        if (propertyInfo.sanitizeURL) {
          value = '' + value;
        }

        target.push(
          attributeSeparator,
          attributeNameChunk,
          attributeAssign,
          stringToChunk(escapeTextForBrowser(value)),
          attributeEnd
        );
    }
  } else if (isAttributeNameSafe(name)) {
    // shouldRemoveAttribute
    switch (typeof value) {
      case 'function':
      case 'symbol':
        // eslint-disable-line
        return;

      case 'boolean': {
        const prefix = name.toLowerCase().slice(0, 5);

        if (prefix !== 'data-' && prefix !== 'aria-') {
          return;
        }
      }
    }

    target.push(
      attributeSeparator,
      stringToChunk(name),
      attributeAssign,
      stringToChunk(escapeTextForBrowser(value)),
      attributeEnd
    );
  }
}

const endOfStartTag = stringToPrecomputedChunk('>');
const endOfStartTagSelfClosing = stringToPrecomputedChunk('/>');

function pushInnerHTML(target, innerHTML, children) {
  if (innerHTML != null) {
    if (children != null) {
      throw new Error(
        'Can only set one of `children` or `props.dangerouslySetInnerHTML`.'
      );
    }

    if (typeof innerHTML !== 'object' || !('__html' in innerHTML)) {
      throw new Error(
        '`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. ' +
          'Please visit https://reactjs.org/link/dangerously-set-inner-html ' +
          'for more information.'
      );
    }

    const html = innerHTML.__html;

    if (html !== null && html !== undefined) {
      target.push(stringToChunk('' + html));
    }
  }
} // TODO: Move these to ResponseState so that we warn for every request.

function pushStartSelect(target, props, responseState) {
  target.push(startChunkForTag('select'));
  let children = null;
  let innerHTML = null;

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];

      if (propValue == null) {
        continue;
      }

      switch (propKey) {
        case 'children':
          children = propValue;
          break;

        case 'dangerouslySetInnerHTML':
          // TODO: This doesn't really make sense for select since it can't use the controlled
          // value in the innerHTML.
          innerHTML = propValue;
          break;

        case 'defaultValue':
        case 'value':
          // These are set on the Context instead and applied to the nested options.
          break;

        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }

  target.push(endOfStartTag);
  pushInnerHTML(target, innerHTML, children);
  return children;
}

function flattenOptionChildren(children) {
  let content = ''; // Flatten children and warn if they aren't strings or numbers;
  // invalid types are ignored.

  Children.forEach(children, function (child) {
    if (child == null) {
      return;
    }

    content += child;
  });
  return content;
}

const selectedMarkerAttribute = stringToPrecomputedChunk(' selected=""');

function pushStartOption(target, props, responseState, formatContext) {
  const selectedValue = formatContext.selectedValue;
  target.push(startChunkForTag('option'));
  let children = null;
  let value = null;
  let selected = null;
  let innerHTML = null;

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];

      if (propValue == null) {
        continue;
      }

      switch (propKey) {
        case 'children':
          children = propValue;
          break;

        case 'selected':
          // ignore
          selected = propValue;

          break;

        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;
        // eslint-disable-next-line-no-fallthrough

        case 'value':
          value = propValue;
        // We intentionally fallthrough to also set the attribute on the node.
        // eslint-disable-next-line-no-fallthrough

        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }

  if (selectedValue != null) {
    let stringValue;

    if (value !== null) {
      stringValue = '' + value;
    } else {
      stringValue = flattenOptionChildren(children);
    }

    if (isArray(selectedValue)) {
      // multiple
      for (let i = 0; i < selectedValue.length; i++) {
        const v = '' + selectedValue[i];

        if (v === stringValue) {
          target.push(selectedMarkerAttribute);
          break;
        }
      }
    } else {
      if ('' + selectedValue === stringValue) {
        target.push(selectedMarkerAttribute);
      }
    }
  } else if (selected) {
    target.push(selectedMarkerAttribute);
  }

  target.push(endOfStartTag);
  pushInnerHTML(target, innerHTML, children);
  return children;
}

function pushInput(target, props, responseState) {
  target.push(startChunkForTag('input'));
  let value = null;
  let defaultValue = null;
  let checked = null;
  let defaultChecked = null;

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];

      if (propValue == null) {
        continue;
      }

      switch (propKey) {
        case 'children':
        case 'dangerouslySetInnerHTML':
          throw new Error(
            'input' +
              ' is a self-closing tag and must neither have `children` nor ' +
              'use `dangerouslySetInnerHTML`.'
          );
        // eslint-disable-next-line-no-fallthrough

        case 'defaultChecked':
          defaultChecked = propValue;
          break;

        case 'defaultValue':
          defaultValue = propValue;
          break;

        case 'checked':
          checked = propValue;
          break;

        case 'value':
          value = propValue;
          break;

        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }

  if (checked !== null) {
    pushAttribute(target, responseState, 'checked', checked);
  } else if (defaultChecked !== null) {
    pushAttribute(target, responseState, 'checked', defaultChecked);
  }

  if (value !== null) {
    pushAttribute(target, responseState, 'value', value);
  } else if (defaultValue !== null) {
    pushAttribute(target, responseState, 'value', defaultValue);
  }

  target.push(endOfStartTagSelfClosing);
  return null;
}

function pushStartTextArea(target, props, responseState) {
  target.push(startChunkForTag('textarea'));
  let value = null;
  let defaultValue = null;
  let children = null;

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];

      if (propValue == null) {
        continue;
      }

      switch (propKey) {
        case 'children':
          children = propValue;
          break;

        case 'value':
          value = propValue;
          break;

        case 'defaultValue':
          defaultValue = propValue;
          break;

        case 'dangerouslySetInnerHTML':
          throw new Error(
            '`dangerouslySetInnerHTML` does not make sense on <textarea>.'
          );
        // eslint-disable-next-line-no-fallthrough

        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }

  if (value === null && defaultValue !== null) {
    value = defaultValue;
  }

  target.push(endOfStartTag); // TODO (yungsters): Remove support for children content in <textarea>.

  if (children != null) {
    if (value != null) {
      throw new Error(
        'If you supply `defaultValue` on a <textarea>, do not pass children.'
      );
    }

    if (isArray(children)) {
      if (children.length > 1) {
        throw new Error('<textarea> can only have at most one child.');
      } // TODO: remove the coercion and the DEV check below because it will

      value = '' + children[0];
    }

    value = '' + children;
  }

  if (typeof value === 'string' && value[0] === '\n') {
    // text/html ignores the first character in these tags if it's a newline
    // Prefer to break application/xml over text/html (for now) by adding
    // a newline specifically to get eaten by the parser. (Alternately for
    // textareas, replacing "^\n" with "\r\n" doesn't get eaten, and the first
    // \r is normalized out by HTMLTextAreaElement#value.)
    // See: <http://www.w3.org/TR/html-polyglot/#newlines-in-textarea-and-pre>
    // See: <http://www.w3.org/TR/html5/syntax.html#element-restrictions>
    // See: <http://www.w3.org/TR/html5/syntax.html#newlines>
    // See: Parsing of "textarea" "listing" and "pre" elements
    //  from <http://www.w3.org/TR/html5/syntax.html#parsing-main-inbody>
    target.push(leadingNewline);
  } // ToString and push directly instead of recurse over children.
  // We don't really support complex children in the value anyway.
  // This also currently avoids a trailing comment node which breaks textarea.

  if (value !== null) {
    target.push(stringToChunk(encodeHTMLTextNode('' + value)));
  }

  return null;
}

function pushBase(
  target,
  props,
  responseState,
  textEmbedded,
  noscriptTagInScope
) {
  if (!noscriptTagInScope && resourcesFromElement('base', props)) {
    if (textEmbedded) {
      // This link follows text but we aren't writing a tag. while not as efficient as possible we need
      // to be safe and assume text will follow by inserting a textSeparator
      target.push(textSeparator);
    } // We have converted this link exclusively to a resource and no longer
    // need to emit it

    return null;
  }

  return pushSelfClosing(target, props, 'base', responseState);
}

function pushMeta(
  target,
  props,
  responseState,
  textEmbedded,
  noscriptTagInScope
) {
  if (!noscriptTagInScope && resourcesFromElement('meta', props)) {
    if (textEmbedded) {
      // This link follows text but we aren't writing a tag. while not as efficient as possible we need
      // to be safe and assume text will follow by inserting a textSeparator
      target.push(textSeparator);
    } // We have converted this link exclusively to a resource and no longer
    // need to emit it

    return null;
  }

  return pushSelfClosing(target, props, 'meta', responseState);
}

function pushLink(
  target,
  props,
  responseState,
  textEmbedded,
  noscriptTagInScope
) {
  if (!noscriptTagInScope && resourcesFromLink(props)) {
    if (textEmbedded) {
      // This link follows text but we aren't writing a tag. while not as efficient as possible we need
      // to be safe and assume text will follow by inserting a textSeparator
      target.push(textSeparator);
    } // We have converted this link exclusively to a resource and no longer
    // need to emit it

    return null;
  }

  return pushLinkImpl(target, props, responseState);
}

function pushLinkImpl(target, props, responseState) {
  const isStylesheet = props.rel === 'stylesheet';
  target.push(startChunkForTag('link'));

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];

      if (propValue == null) {
        continue;
      }

      switch (propKey) {
        case 'children':
        case 'dangerouslySetInnerHTML':
          throw new Error(
            'link' +
              ' is a self-closing tag and must neither have `children` nor ' +
              'use `dangerouslySetInnerHTML`.'
          );

        case 'precedence': {
          if (isStylesheet) {
            // precedence is a reversed property for stylesheets to opt-into resource semantcs
            continue;
          } // intentionally fall through
        }
        // eslint-disable-next-line-no-fallthrough

        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }

  target.push(endOfStartTagSelfClosing);
  return null;
}

function pushSelfClosing(target, props, tag, responseState) {
  target.push(startChunkForTag(tag));

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];

      if (propValue == null) {
        continue;
      }

      switch (propKey) {
        case 'children':
        case 'dangerouslySetInnerHTML':
          throw new Error(
            tag +
              ' is a self-closing tag and must neither have `children` nor ' +
              'use `dangerouslySetInnerHTML`.'
          );
        // eslint-disable-next-line-no-fallthrough

        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }

  target.push(endOfStartTagSelfClosing);
  return null;
}

function pushStartMenuItem(target, props, responseState) {
  target.push(startChunkForTag('menuitem'));

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];

      if (propValue == null) {
        continue;
      }

      switch (propKey) {
        case 'children':
        case 'dangerouslySetInnerHTML':
          throw new Error(
            'menuitems cannot have `children` nor `dangerouslySetInnerHTML`.'
          );
        // eslint-disable-next-line-no-fallthrough

        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }

  target.push(endOfStartTag);
  return null;
}

function pushTitle(target, props, responseState, noscriptTagInScope) {
  if (!noscriptTagInScope && resourcesFromElement('title', props)) {
    // We have converted this link exclusively to a resource and no longer
    // need to emit it
    return null;
  }

  return pushTitleImpl(target, props, responseState);
}

function pushTitleImpl(target, props, responseState) {
  target.push(startChunkForTag('title'));
  let children = null;

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];

      if (propValue == null) {
        continue;
      }

      switch (propKey) {
        case 'children':
          children = propValue;
          break;

        case 'dangerouslySetInnerHTML':
          throw new Error(
            '`dangerouslySetInnerHTML` does not make sense on <title>.'
          );
        // eslint-disable-next-line-no-fallthrough

        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }

  target.push(endOfStartTag);
  const child =
    Array.isArray(children) && children.length < 2
      ? children[0] || null
      : children;

  if (typeof child === 'string' || typeof child === 'number') {
    target.push(stringToChunk(escapeTextForBrowser(child)));
  }

  target.push(endTag1, stringToChunk('title'), endTag2);
  return null;
}

function pushStartHead(target, preamble, props, tag, responseState) {
  return pushStartGenericElement(preamble, props, tag, responseState);
}

function pushStartHtml(
  target,
  preamble,
  props,
  tag,
  responseState,
  formatContext
) {
  target = preamble;

  if (formatContext.insertionMode === ROOT_HTML_MODE) {
    // If we're rendering the html tag and we're at the root (i.e. not in foreignObject)
    // then we also emit the DOCTYPE as part of the root content as a convenience for
    // rendering the whole document.
    target.push(DOCTYPE);
  }

  return pushStartGenericElement(target, props, tag, responseState);
}

function pushScript(
  target,
  props,
  responseState,
  textEmbedded,
  noscriptTagInScope
) {
  if (!noscriptTagInScope && resourcesFromScript(props)) {
    if (textEmbedded) {
      // This link follows text but we aren't writing a tag. while not as efficient as possible we need
      // to be safe and assume text will follow by inserting a textSeparator
      target.push(textSeparator);
    } // We have converted this link exclusively to a resource and no longer
    // need to emit it

    return null;
  }

  return pushScriptImpl(target, props, responseState);
}

function pushScriptImpl(target, props, responseState) {
  target.push(startChunkForTag('script'));
  let children = null;
  let innerHTML = null;

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];

      if (propValue == null) {
        continue;
      }

      switch (propKey) {
        case 'children':
          children = propValue;
          break;

        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;

        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }

  target.push(endOfStartTag);

  pushInnerHTML(target, innerHTML, children);

  if (typeof children === 'string') {
    target.push(stringToChunk(encodeHTMLTextNode(children)));
  }

  target.push(endTag1, stringToChunk('script'), endTag2);
  return null;
}

function pushStartGenericElement(target, props, tag, responseState) {
  target.push(startChunkForTag(tag));
  let children = null;
  let innerHTML = null;

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];

      if (propValue == null) {
        continue;
      }

      switch (propKey) {
        case 'children':
          children = propValue;
          break;

        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;

        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }

  target.push(endOfStartTag);
  pushInnerHTML(target, innerHTML, children);

  if (typeof children === 'string') {
    // Special case children as a string to avoid the unnecessary comment.
    // TODO: Remove this special case after the general optimization is in place.
    target.push(stringToChunk(encodeHTMLTextNode(children)));
    return null;
  }

  return children;
}

function pushStartCustomElement(target, props, tag, responseState) {
  target.push(startChunkForTag(tag));
  let children = null;
  let innerHTML = null;

  for (let propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      let propValue = props[propKey];

      if (propValue == null) {
        continue;
      }

      if (typeof propValue === 'function' || typeof propValue === 'object') {
        // It is normal to render functions and objects on custom elements when
        // client rendering, but when server rendering the output isn't useful,
        // so skip it.
        continue;
      }

      if (propValue === false) {
        continue;
      }

      if (propValue === true) {
        propValue = '';
      }

      if (propKey === 'className') {
        // className gets rendered as class on the client, so it should be
        // rendered as class on the server.
        propKey = 'class';
      }

      switch (propKey) {
        case 'children':
          children = propValue;
          break;

        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;

        case 'style':
          pushStyle(target, responseState, propValue);
          break;

        case 'suppressContentEditableWarning':
        case 'suppressHydrationWarning':
          // Ignored. These are built-in to React on the client.
          break;

        default:
          if (
            isAttributeNameSafe(propKey) &&
            typeof propValue !== 'function' &&
            typeof propValue !== 'symbol'
          ) {
            target.push(
              attributeSeparator,
              stringToChunk(propKey),
              attributeAssign,
              stringToChunk(escapeTextForBrowser(propValue)),
              attributeEnd
            );
          }

          break;
      }
    }
  }

  target.push(endOfStartTag);
  pushInnerHTML(target, innerHTML, children);
  return children;
}

const leadingNewline = stringToPrecomputedChunk('\n');

function pushStartPreformattedElement(target, props, tag, responseState) {
  target.push(startChunkForTag(tag));
  let children = null;
  let innerHTML = null;

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];

      if (propValue == null) {
        continue;
      }

      switch (propKey) {
        case 'children':
          children = propValue;
          break;

        case 'dangerouslySetInnerHTML':
          innerHTML = propValue;
          break;

        default:
          pushAttribute(target, responseState, propKey, propValue);
          break;
      }
    }
  }

  target.push(endOfStartTag); // text/html ignores the first character in these tags if it's a newline
  // Prefer to break application/xml over text/html (for now) by adding
  // a newline specifically to get eaten by the parser. (Alternately for
  // textareas, replacing "^\n" with "\r\n" doesn't get eaten, and the first
  // \r is normalized out by HTMLTextAreaElement#value.)
  // See: <http://www.w3.org/TR/html-polyglot/#newlines-in-textarea-and-pre>
  // See: <http://www.w3.org/TR/html5/syntax.html#element-restrictions>
  // See: <http://www.w3.org/TR/html5/syntax.html#newlines>
  // See: Parsing of "textarea" "listing" and "pre" elements
  //  from <http://www.w3.org/TR/html5/syntax.html#parsing-main-inbody>
  // TODO: This doesn't deal with the case where the child is an array
  // or component that returns a string.

  if (innerHTML != null) {
    if (children != null) {
      throw new Error(
        'Can only set one of `children` or `props.dangerouslySetInnerHTML`.'
      );
    }

    if (typeof innerHTML !== 'object' || !('__html' in innerHTML)) {
      throw new Error(
        '`props.dangerouslySetInnerHTML` must be in the form `{__html: ...}`. ' +
          'Please visit https://reactjs.org/link/dangerously-set-inner-html ' +
          'for more information.'
      );
    }

    const html = innerHTML.__html;

    if (html !== null && html !== undefined) {
      if (typeof html === 'string' && html.length > 0 && html[0] === '\n') {
        target.push(leadingNewline, stringToChunk(html));
      } else {
        target.push(stringToChunk('' + html));
      }
    }
  }

  if (typeof children === 'string' && children[0] === '\n') {
    target.push(leadingNewline);
  }

  return children;
} // We accept any tag to be rendered but since this gets injected into arbitrary
// HTML, we want to make sure that it's a safe tag.
// http://www.w3.org/TR/REC-xml/#NT-Name

const VALID_TAG_REGEX = /^[a-zA-Z][a-zA-Z:_\.\-\d]*$/; // Simplified subset

const validatedTagCache = new Map();

function startChunkForTag(tag) {
  let tagStartChunk = validatedTagCache.get(tag);

  if (tagStartChunk === undefined) {
    if (!VALID_TAG_REGEX.test(tag)) {
      throw new Error('Invalid tag: ' + tag);
    }

    tagStartChunk = stringToPrecomputedChunk('<' + tag);
    validatedTagCache.set(tag, tagStartChunk);
  }

  return tagStartChunk;
}

const DOCTYPE = stringToPrecomputedChunk('<!DOCTYPE html>');
function pushStartInstance(
  target,
  preamble,
  type,
  props,
  responseState,
  formatContext,
  textEmbedded
) {
  switch (type) {
    // Special tags
    case 'select':
      return pushStartSelect(target, props, responseState);

    case 'option':
      return pushStartOption(target, props, responseState, formatContext);

    case 'textarea':
      return pushStartTextArea(target, props, responseState);

    case 'input':
      return pushInput(target, props, responseState);

    case 'menuitem':
      return pushStartMenuItem(target, props, responseState);

    case 'title':
      return pushTitle(
        target,
        props,
        responseState,
        formatContext.noscriptTagInScope
      );

    case 'link':
      return pushLink(
        target,
        props,
        responseState,
        textEmbedded,
        formatContext.noscriptTagInScope
      );

    case 'script':
      return pushScript(
        target,
        props,
        responseState,
        textEmbedded,
        formatContext.noscriptTagInScope
      );

    case 'meta':
      return pushMeta(
        target,
        props,
        responseState,
        textEmbedded,
        formatContext.noscriptTagInScope
      );

    case 'base':
      return pushBase(
        target,
        props,
        responseState,
        textEmbedded,
        formatContext.noscriptTagInScope
      );
    // Newline eating tags

    case 'listing':
    case 'pre': {
      return pushStartPreformattedElement(target, props, type, responseState);
    }
    // Omitted close tags

    case 'area':
    case 'br':
    case 'col':
    case 'embed':
    case 'hr':
    case 'img':
    case 'keygen':
    case 'param':
    case 'source':
    case 'track':
    case 'wbr': {
      return pushSelfClosing(target, props, type, responseState);
    }
    // These are reserved SVG and MathML elements, that are never custom elements.
    // https://w3c.github.io/webcomponents/spec/custom/#custom-elements-core-concepts

    case 'annotation-xml':
    case 'color-profile':
    case 'font-face':
    case 'font-face-src':
    case 'font-face-uri':
    case 'font-face-format':
    case 'font-face-name':
    case 'missing-glyph': {
      return pushStartGenericElement(target, props, type, responseState);
    }
    // Preamble start tags

    case 'head':
      return pushStartHead(target, preamble, props, type, responseState);

    case 'html': {
      return pushStartHtml(
        target,
        preamble,
        props,
        type,
        responseState,
        formatContext
      );
    }

    default: {
      if (type.indexOf('-') === -1 && typeof props.is !== 'string') {
        // Generic element
        return pushStartGenericElement(target, props, type, responseState);
      } else {
        // Custom element
        return pushStartCustomElement(target, props, type, responseState);
      }
    }
  }
}
const endTag1 = stringToPrecomputedChunk('</');
const endTag2 = stringToPrecomputedChunk('>');
function pushEndInstance(target, postamble, type, props) {
  switch (type) {
    // When float is on we expect title and script tags to always be pushed in
    // a unit and never return children. when we end up pushing the end tag we
    // want to ensure there is no extra closing tag pushed
    case 'title':
    case 'script':
    // Omitted close tags
    // TODO: Instead of repeating this switch we could try to pass a flag from above.
    // That would require returning a tuple. Which might be ok if it gets inlined.
    // eslint-disable-next-line-no-fallthrough

    case 'area':
    case 'base':
    case 'br':
    case 'col':
    case 'embed':
    case 'hr':
    case 'img':
    case 'input':
    case 'keygen':
    case 'link':
    case 'meta':
    case 'param':
    case 'source':
    case 'track':
    case 'wbr': {
      // No close tag needed.
      return;
    }
    // Postamble end tags

    case 'body': {
      {
        postamble.unshift(endTag1, stringToChunk(type), endTag2);
        return;
      }
    }

    case 'html': {
      postamble.push(endTag1, stringToChunk(type), endTag2);
      return;
    }
  }

  target.push(endTag1, stringToChunk(type), endTag2);
}
function writeCompletedRoot(destination, responseState) {
  const bootstrapChunks = responseState.bootstrapChunks;
  let i = 0;

  for (; i < bootstrapChunks.length - 1; i++) {
    writeChunk(destination, bootstrapChunks[i]);
  }

  if (i < bootstrapChunks.length) {
    return writeChunkAndReturn(destination, bootstrapChunks[i]);
  }

  return true;
} // Structural Nodes
// A placeholder is a node inside a hidden partial tree that can be filled in later, but before
// display. It's never visible to users. We use the template tag because it can be used in every
// type of parent. <script> tags also work in every other tag except <colgroup>.

const placeholder1 = stringToPrecomputedChunk('<template id="');
const placeholder2 = stringToPrecomputedChunk('"></template>');
function writePlaceholder(destination, responseState, id) {
  writeChunk(destination, placeholder1);
  writeChunk(destination, responseState.placeholderPrefix);
  const formattedID = stringToChunk(id.toString(16));
  writeChunk(destination, formattedID);
  return writeChunkAndReturn(destination, placeholder2);
} // Suspense boundaries are encoded as comments.

const startCompletedSuspenseBoundary = stringToPrecomputedChunk('<!--$-->');
const startPendingSuspenseBoundary1 = stringToPrecomputedChunk(
  '<!--$?--><template id="'
);
const startPendingSuspenseBoundary2 = stringToPrecomputedChunk('"></template>');
const startClientRenderedSuspenseBoundary =
  stringToPrecomputedChunk('<!--$!-->');
const endSuspenseBoundary = stringToPrecomputedChunk('<!--/$-->');
const clientRenderedSuspenseBoundaryError1 =
  stringToPrecomputedChunk('<template');
const clientRenderedSuspenseBoundaryErrorAttrInterstitial =
  stringToPrecomputedChunk('"');
const clientRenderedSuspenseBoundaryError1A =
  stringToPrecomputedChunk(' data-dgst="');
const clientRenderedSuspenseBoundaryError2 =
  stringToPrecomputedChunk('></template>');
function writeStartCompletedSuspenseBoundary(destination, responseState) {
  return writeChunkAndReturn(destination, startCompletedSuspenseBoundary);
}
function writeStartPendingSuspenseBoundary(destination, responseState, id) {
  writeChunk(destination, startPendingSuspenseBoundary1);

  if (id === null) {
    throw new Error(
      'An ID must have been assigned before we can complete the boundary.'
    );
  }

  writeChunk(destination, id);
  return writeChunkAndReturn(destination, startPendingSuspenseBoundary2);
}
function writeStartClientRenderedSuspenseBoundary(
  destination,
  responseState,
  errorDigest,
  errorMesssage,
  errorComponentStack
) {
  let result;
  result = writeChunkAndReturn(
    destination,
    startClientRenderedSuspenseBoundary
  );
  writeChunk(destination, clientRenderedSuspenseBoundaryError1);

  if (errorDigest) {
    writeChunk(destination, clientRenderedSuspenseBoundaryError1A);
    writeChunk(destination, stringToChunk(escapeTextForBrowser(errorDigest)));
    writeChunk(
      destination,
      clientRenderedSuspenseBoundaryErrorAttrInterstitial
    );
  }

  result = writeChunkAndReturn(
    destination,
    clientRenderedSuspenseBoundaryError2
  );
  return result;
}
function writeEndCompletedSuspenseBoundary(destination, responseState) {
  return writeChunkAndReturn(destination, endSuspenseBoundary);
}
function writeEndPendingSuspenseBoundary(destination, responseState) {
  return writeChunkAndReturn(destination, endSuspenseBoundary);
}
function writeEndClientRenderedSuspenseBoundary(destination, responseState) {
  return writeChunkAndReturn(destination, endSuspenseBoundary);
}
const startSegmentHTML = stringToPrecomputedChunk('<div hidden id="');
const startSegmentHTML2 = stringToPrecomputedChunk('">');
const endSegmentHTML = stringToPrecomputedChunk('</div>');
const startSegmentSVG = stringToPrecomputedChunk(
  '<svg aria-hidden="true" style="display:none" id="'
);
const startSegmentSVG2 = stringToPrecomputedChunk('">');
const endSegmentSVG = stringToPrecomputedChunk('</svg>');
const startSegmentMathML = stringToPrecomputedChunk(
  '<math aria-hidden="true" style="display:none" id="'
);
const startSegmentMathML2 = stringToPrecomputedChunk('">');
const endSegmentMathML = stringToPrecomputedChunk('</math>');
const startSegmentTable = stringToPrecomputedChunk('<table hidden id="');
const startSegmentTable2 = stringToPrecomputedChunk('">');
const endSegmentTable = stringToPrecomputedChunk('</table>');
const startSegmentTableBody = stringToPrecomputedChunk(
  '<table hidden><tbody id="'
);
const startSegmentTableBody2 = stringToPrecomputedChunk('">');
const endSegmentTableBody = stringToPrecomputedChunk('</tbody></table>');
const startSegmentTableRow = stringToPrecomputedChunk('<table hidden><tr id="');
const startSegmentTableRow2 = stringToPrecomputedChunk('">');
const endSegmentTableRow = stringToPrecomputedChunk('</tr></table>');
const startSegmentColGroup = stringToPrecomputedChunk(
  '<table hidden><colgroup id="'
);
const startSegmentColGroup2 = stringToPrecomputedChunk('">');
const endSegmentColGroup = stringToPrecomputedChunk('</colgroup></table>');
function writeStartSegment(destination, responseState, formatContext, id) {
  switch (formatContext.insertionMode) {
    case ROOT_HTML_MODE:
    case HTML_MODE: {
      writeChunk(destination, startSegmentHTML);
      writeChunk(destination, responseState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentHTML2);
    }

    case SVG_MODE: {
      writeChunk(destination, startSegmentSVG);
      writeChunk(destination, responseState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentSVG2);
    }

    case MATHML_MODE: {
      writeChunk(destination, startSegmentMathML);
      writeChunk(destination, responseState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentMathML2);
    }

    case HTML_TABLE_MODE: {
      writeChunk(destination, startSegmentTable);
      writeChunk(destination, responseState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentTable2);
    }
    // TODO: For the rest of these, there will be extra wrapper nodes that never
    // get deleted from the document. We need to delete the table too as part
    // of the injected scripts. They are invisible though so it's not too terrible
    // and it's kind of an edge case to suspend in a table. Totally supported though.

    case HTML_TABLE_BODY_MODE: {
      writeChunk(destination, startSegmentTableBody);
      writeChunk(destination, responseState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentTableBody2);
    }

    case HTML_TABLE_ROW_MODE: {
      writeChunk(destination, startSegmentTableRow);
      writeChunk(destination, responseState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentTableRow2);
    }

    case HTML_COLGROUP_MODE: {
      writeChunk(destination, startSegmentColGroup);
      writeChunk(destination, responseState.segmentPrefix);
      writeChunk(destination, stringToChunk(id.toString(16)));
      return writeChunkAndReturn(destination, startSegmentColGroup2);
    }

    default: {
      throw new Error('Unknown insertion mode. This is a bug in React.');
    }
  }
}
function writeEndSegment(destination, formatContext) {
  switch (formatContext.insertionMode) {
    case ROOT_HTML_MODE:
    case HTML_MODE: {
      return writeChunkAndReturn(destination, endSegmentHTML);
    }

    case SVG_MODE: {
      return writeChunkAndReturn(destination, endSegmentSVG);
    }

    case MATHML_MODE: {
      return writeChunkAndReturn(destination, endSegmentMathML);
    }

    case HTML_TABLE_MODE: {
      return writeChunkAndReturn(destination, endSegmentTable);
    }

    case HTML_TABLE_BODY_MODE: {
      return writeChunkAndReturn(destination, endSegmentTableBody);
    }

    case HTML_TABLE_ROW_MODE: {
      return writeChunkAndReturn(destination, endSegmentTableRow);
    }

    case HTML_COLGROUP_MODE: {
      return writeChunkAndReturn(destination, endSegmentColGroup);
    }

    default: {
      throw new Error('Unknown insertion mode. This is a bug in React.');
    }
  }
}
const completeSegmentScript1Full = stringToPrecomputedChunk(
  completeSegment + ';$RS("'
);
const completeSegmentScript1Partial = stringToPrecomputedChunk('$RS("');
const completeSegmentScript2 = stringToPrecomputedChunk('","');
const completeSegmentScript3 = stringToPrecomputedChunk('")</script>');
function writeCompletedSegmentInstruction(
  destination,
  responseState,
  contentSegmentID
) {
  writeChunk(destination, responseState.startInlineScript);

  if (!responseState.sentCompleteSegmentFunction) {
    // The first time we write this, we'll need to include the full implementation.
    responseState.sentCompleteSegmentFunction = true;
    writeChunk(destination, completeSegmentScript1Full);
  } else {
    // Future calls can just reuse the same function.
    writeChunk(destination, completeSegmentScript1Partial);
  }

  writeChunk(destination, responseState.segmentPrefix);
  const formattedID = stringToChunk(contentSegmentID.toString(16));
  writeChunk(destination, formattedID);
  writeChunk(destination, completeSegmentScript2);
  writeChunk(destination, responseState.placeholderPrefix);
  writeChunk(destination, formattedID);
  return writeChunkAndReturn(destination, completeSegmentScript3);
}
const completeBoundaryScript1Full = stringToPrecomputedChunk(
  completeBoundary + ';$RC("'
);
const completeBoundaryScript1Partial = stringToPrecomputedChunk('$RC("');
const completeBoundaryWithStylesScript1FullBoth = stringToPrecomputedChunk(
  completeBoundary + ';' + completeBoundaryWithStyles + ';$RR("'
);
const completeBoundaryWithStylesScript1FullPartial = stringToPrecomputedChunk(
  completeBoundaryWithStyles + ';$RR("'
);
const completeBoundaryWithStylesScript1Partial =
  stringToPrecomputedChunk('$RR("');
const completeBoundaryScript2 = stringToPrecomputedChunk('","');
const completeBoundaryScript2a = stringToPrecomputedChunk('",');
const completeBoundaryScript3 = stringToPrecomputedChunk('"');
const completeBoundaryScript4 = stringToPrecomputedChunk(')</script>');
function writeCompletedBoundaryInstruction(
  destination,
  responseState,
  boundaryID,
  contentSegmentID,
  boundaryResources
) {
  let hasStyleDependencies;

  {
    hasStyleDependencies = hasStyleResourceDependencies(boundaryResources);
  }

  writeChunk(destination, responseState.startInlineScript);

  if (hasStyleDependencies) {
    if (!responseState.sentCompleteBoundaryFunction) {
      responseState.sentCompleteBoundaryFunction = true;
      responseState.sentStyleInsertionFunction = true;
      writeChunk(destination, completeBoundaryWithStylesScript1FullBoth);
    } else if (!responseState.sentStyleInsertionFunction) {
      responseState.sentStyleInsertionFunction = true;
      writeChunk(destination, completeBoundaryWithStylesScript1FullPartial);
    } else {
      writeChunk(destination, completeBoundaryWithStylesScript1Partial);
    }
  } else {
    if (!responseState.sentCompleteBoundaryFunction) {
      responseState.sentCompleteBoundaryFunction = true;
      writeChunk(destination, completeBoundaryScript1Full);
    } else {
      writeChunk(destination, completeBoundaryScript1Partial);
    }
  }

  if (boundaryID === null) {
    throw new Error(
      'An ID must have been assigned before we can complete the boundary.'
    );
  }

  const formattedContentID = stringToChunk(contentSegmentID.toString(16));
  writeChunk(destination, boundaryID);
  writeChunk(destination, completeBoundaryScript2);
  writeChunk(destination, responseState.segmentPrefix);
  writeChunk(destination, formattedContentID);

  if (hasStyleDependencies) {
    writeChunk(destination, completeBoundaryScript2a);
    writeStyleResourceDependencies(destination, boundaryResources);
  } else {
    writeChunk(destination, completeBoundaryScript3);
  }

  return writeChunkAndReturn(destination, completeBoundaryScript4);
}
const clientRenderScript1Full = stringToPrecomputedChunk(
  clientRenderBoundary + ';$RX("'
);
const clientRenderScript1Partial = stringToPrecomputedChunk('$RX("');
const clientRenderScript1A = stringToPrecomputedChunk('"');
const clientRenderScript2 = stringToPrecomputedChunk(')</script>');
const clientRenderErrorScriptArgInterstitial = stringToPrecomputedChunk(',');
function writeClientRenderBoundaryInstruction(
  destination,
  responseState,
  boundaryID,
  errorDigest,
  errorMessage,
  errorComponentStack
) {
  writeChunk(destination, responseState.startInlineScript);

  if (!responseState.sentClientRenderFunction) {
    // The first time we write this, we'll need to include the full implementation.
    responseState.sentClientRenderFunction = true;
    writeChunk(destination, clientRenderScript1Full);
  } else {
    // Future calls can just reuse the same function.
    writeChunk(destination, clientRenderScript1Partial);
  }

  if (boundaryID === null) {
    throw new Error(
      'An ID must have been assigned before we can complete the boundary.'
    );
  }

  writeChunk(destination, boundaryID);
  writeChunk(destination, clientRenderScript1A);

  if (errorDigest || errorMessage || errorComponentStack) {
    writeChunk(destination, clientRenderErrorScriptArgInterstitial);
    writeChunk(
      destination,
      stringToChunk(escapeJSStringsForInstructionScripts(errorDigest || ''))
    );
  }

  if (errorMessage || errorComponentStack) {
    writeChunk(destination, clientRenderErrorScriptArgInterstitial);
    writeChunk(
      destination,
      stringToChunk(escapeJSStringsForInstructionScripts(errorMessage || ''))
    );
  }

  if (errorComponentStack) {
    writeChunk(destination, clientRenderErrorScriptArgInterstitial);
    writeChunk(
      destination,
      stringToChunk(escapeJSStringsForInstructionScripts(errorComponentStack))
    );
  }

  return writeChunkAndReturn(destination, clientRenderScript2);
}
const regexForJSStringsInInstructionScripts = /[<\u2028\u2029]/g;

function escapeJSStringsForInstructionScripts(input) {
  const escaped = JSON.stringify(input);
  return escaped.replace(regexForJSStringsInInstructionScripts, (match) => {
    switch (match) {
      // santizing breaking out of strings and script tags
      case '<':
        return '\\u003c';

      case '\u2028':
        return '\\u2028';

      case '\u2029':
        return '\\u2029';

      default: {
        // eslint-disable-next-line react-internal/prod-error-codes
        throw new Error(
          'escapeJSStringsForInstructionScripts encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React'
        );
      }
    }
  });
}

const regexForJSStringsInScripts = /[&><\u2028\u2029]/g;

function escapeJSObjectForInstructionScripts(input) {
  const escaped = JSON.stringify(input);
  return escaped.replace(regexForJSStringsInScripts, (match) => {
    switch (match) {
      // santizing breaking out of strings and script tags
      case '&':
        return '\\u0026';

      case '>':
        return '\\u003e';

      case '<':
        return '\\u003c';

      case '\u2028':
        return '\\u2028';

      case '\u2029':
        return '\\u2029';

      default: {
        // eslint-disable-next-line react-internal/prod-error-codes
        throw new Error(
          'escapeJSObjectForInstructionScripts encountered a match it does not know how to replace. this means the match regex and the replacement characters are no longer in sync. This is a bug in React'
        );
      }
    }
  });
}

const precedencePlaceholderStart = stringToPrecomputedChunk(
  '<style data-precedence="'
);
const precedencePlaceholderEnd = stringToPrecomputedChunk('"></style>');
function writeInitialResources(destination, resources, responseState) {
  function flushLinkResource(resource) {
    if (!resource.flushed) {
      pushLinkImpl(target, resource.props, responseState);
      resource.flushed = true;
    }
  }

  const target = [];
  const charset = resources.charset,
    bases = resources.bases,
    preconnects = resources.preconnects,
    fontPreloads = resources.fontPreloads,
    precedences = resources.precedences,
    usedStylePreloads = resources.usedStylePreloads,
    scripts = resources.scripts,
    usedScriptPreloads = resources.usedScriptPreloads,
    explicitStylePreloads = resources.explicitStylePreloads,
    explicitScriptPreloads = resources.explicitScriptPreloads,
    headResources = resources.headResources;

  if (charset) {
    pushSelfClosing(target, charset.props, 'meta', responseState);
    charset.flushed = true;
    resources.charset = null;
  }

  bases.forEach((r) => {
    pushSelfClosing(target, r.props, 'base', responseState);
    r.flushed = true;
  });
  bases.clear();
  preconnects.forEach((r) => {
    // font preload Resources should not already be flushed so we elide this check
    pushLinkImpl(target, r.props, responseState);
    r.flushed = true;
  });
  preconnects.clear();
  fontPreloads.forEach((r) => {
    // font preload Resources should not already be flushed so we elide this check
    pushLinkImpl(target, r.props, responseState);
    r.flushed = true;
  });
  fontPreloads.clear(); // Flush stylesheets first by earliest precedence

  precedences.forEach((p, precedence) => {
    if (p.size) {
      p.forEach((r) => {
        // resources should not already be flushed so we elide this check
        pushLinkImpl(target, r.props, responseState);
        r.flushed = true;
        r.inShell = true;
        r.hint.flushed = true;
      });
      p.clear();
    } else {
      target.push(
        precedencePlaceholderStart,
        stringToChunk(escapeTextForBrowser(precedence)),
        precedencePlaceholderEnd
      );
    }
  });
  usedStylePreloads.forEach(flushLinkResource);
  usedStylePreloads.clear();
  scripts.forEach((r) => {
    // should never be flushed already
    pushScriptImpl(target, r.props, responseState);
    r.flushed = true;
    r.hint.flushed = true;
  });
  scripts.clear();
  usedScriptPreloads.forEach(flushLinkResource);
  usedScriptPreloads.clear();
  explicitStylePreloads.forEach(flushLinkResource);
  explicitStylePreloads.clear();
  explicitScriptPreloads.forEach(flushLinkResource);
  explicitScriptPreloads.clear();
  headResources.forEach((r) => {
    switch (r.type) {
      case 'title': {
        pushTitleImpl(target, r.props, responseState);
        break;
      }

      case 'meta': {
        pushSelfClosing(target, r.props, 'meta', responseState);
        break;
      }

      case 'link': {
        pushLinkImpl(target, r.props, responseState);
        break;
      }
    }

    r.flushed = true;
  });
  headResources.clear();
  let i;
  let r = true;

  for (i = 0; i < target.length - 1; i++) {
    writeChunk(destination, target[i]);
  }

  if (i < target.length) {
    r = writeChunkAndReturn(destination, target[i]);
  }

  return r;
}
function writeImmediateResources(destination, resources, responseState) {
  function flushLinkResource(resource) {
    if (!resource.flushed) {
      pushLinkImpl(target, resource.props, responseState);
      resource.flushed = true;
    }
  }

  const target = [];
  const charset = resources.charset,
    preconnects = resources.preconnects,
    fontPreloads = resources.fontPreloads,
    usedStylePreloads = resources.usedStylePreloads,
    scripts = resources.scripts,
    usedScriptPreloads = resources.usedScriptPreloads,
    explicitStylePreloads = resources.explicitStylePreloads,
    explicitScriptPreloads = resources.explicitScriptPreloads,
    headResources = resources.headResources;

  if (charset) {
    pushSelfClosing(target, charset.props, 'meta', responseState);
    charset.flushed = true;
    resources.charset = null;
  }

  preconnects.forEach((r) => {
    // font preload Resources should not already be flushed so we elide this check
    pushLinkImpl(target, r.props, responseState);
    r.flushed = true;
  });
  preconnects.clear();
  fontPreloads.forEach((r) => {
    // font preload Resources should not already be flushed so we elide this check
    pushLinkImpl(target, r.props, responseState);
    r.flushed = true;
  });
  fontPreloads.clear();
  usedStylePreloads.forEach(flushLinkResource);
  usedStylePreloads.clear();
  scripts.forEach((r) => {
    // should never be flushed already
    pushStartGenericElement(target, r.props, 'script', responseState);
    pushEndInstance(target, target, 'script', r.props);
    r.flushed = true;
    r.hint.flushed = true;
  });
  scripts.clear();
  usedScriptPreloads.forEach(flushLinkResource);
  usedScriptPreloads.clear();
  explicitStylePreloads.forEach(flushLinkResource);
  explicitStylePreloads.clear();
  explicitScriptPreloads.forEach(flushLinkResource);
  explicitScriptPreloads.clear();
  headResources.forEach((r) => {
    switch (r.type) {
      case 'title': {
        pushTitleImpl(target, r.props, responseState);
        break;
      }

      case 'meta': {
        pushSelfClosing(target, r.props, 'meta', responseState);
        break;
      }

      case 'link': {
        pushLinkImpl(target, r.props, responseState);
        break;
      }
    }

    r.flushed = true;
  });
  headResources.clear();
  let i;
  let r = true;

  for (i = 0; i < target.length - 1; i++) {
    writeChunk(destination, target[i]);
  }

  if (i < target.length) {
    r = writeChunkAndReturn(destination, target[i]);
  }

  return r;
}

function hasStyleResourceDependencies(boundaryResources) {
  const iter = boundaryResources.values(); // At the moment boundaries only accumulate style resources
  // so we assume the type is correct and don't check it

  while (true) {
    const _iter$next = iter.next(),
      resource = _iter$next.value;

    if (!resource) break; // If every style Resource flushed in the shell we do not need to send
    // any dependencies

    if (!resource.inShell) {
      return true;
    }
  }

  return false;
}

const arrayFirstOpenBracket = stringToPrecomputedChunk('[');
const arraySubsequentOpenBracket = stringToPrecomputedChunk(',[');
const arrayInterstitial = stringToPrecomputedChunk(',');
const arrayCloseBracket = stringToPrecomputedChunk(']');

function writeStyleResourceDependencies(destination, boundaryResources) {
  writeChunk(destination, arrayFirstOpenBracket);
  let nextArrayOpenBrackChunk = arrayFirstOpenBracket;
  boundaryResources.forEach((resource) => {
    if (resource.inShell);
    else if (resource.flushed) {
      writeChunk(destination, nextArrayOpenBrackChunk);
      writeStyleResourceDependencyHrefOnly(destination, resource.href);
      writeChunk(destination, arrayCloseBracket);
      nextArrayOpenBrackChunk = arraySubsequentOpenBracket;
    } else {
      writeChunk(destination, nextArrayOpenBrackChunk);
      writeStyleResourceDependency(
        destination,
        resource.href,
        resource.precedence,
        resource.props
      );
      writeChunk(destination, arrayCloseBracket);
      nextArrayOpenBrackChunk = arraySubsequentOpenBracket;
      resource.flushed = true;
      resource.hint.flushed = true;
    }
  });
  writeChunk(destination, arrayCloseBracket);
}

function writeStyleResourceDependencyHrefOnly(destination, href) {
  const coercedHref = '' + href;
  writeChunk(
    destination,
    stringToChunk(escapeJSObjectForInstructionScripts(coercedHref))
  );
}

function writeStyleResourceDependency(destination, href, precedence, props) {
  const coercedHref = '' + href;
  writeChunk(
    destination,
    stringToChunk(escapeJSObjectForInstructionScripts(coercedHref))
  );

  const coercedPrecedence = '' + precedence;
  writeChunk(destination, arrayInterstitial);
  writeChunk(
    destination,
    stringToChunk(escapeJSObjectForInstructionScripts(coercedPrecedence))
  );

  for (const propKey in props) {
    if (hasOwnProperty.call(props, propKey)) {
      const propValue = props[propKey];

      if (propValue == null) {
        continue;
      }

      switch (propKey) {
        case 'href':
        case 'rel':
        case 'precedence':
        case 'data-precedence': {
          break;
        }

        case 'children':
        case 'dangerouslySetInnerHTML':
          throw new Error(
            'link' +
              ' is a self-closing tag and must neither have `children` nor ' +
              'use `dangerouslySetInnerHTML`.'
          );
        // eslint-disable-next-line-no-fallthrough

        default:
          writeStyleResourceAttribute(destination, propKey, propValue);
          break;
      }
    }
  }

  return null;
}

function writeStyleResourceAttribute(destination, name, value) {
  let attributeName = name.toLowerCase();
  let attributeValue;

  switch (typeof value) {
    case 'function':
    case 'symbol':
      return;
  }

  switch (name) {
    // Reserved names
    case 'innerHTML':
    case 'dangerouslySetInnerHTML':
    case 'suppressContentEditableWarning':
    case 'suppressHydrationWarning':
    case 'style':
      // Ignored
      return;
    // Attribute renames

    case 'className':
      attributeName = 'class';
      break;
    // Booleans

    case 'hidden':
      if (value === false) {
        return;
      }

      attributeValue = '';
      break;
    // Santized URLs

    case 'src':
    case 'href': {
      attributeValue = '' + value;
      break;
    }

    default: {
      if (!isAttributeNameSafe(name)) {
        return;
      }
    }
  }

  if (
    // shouldIgnoreAttribute
    // We have already filtered out null/undefined and reserved words.
    name.length > 2 &&
    (name[0] === 'o' || name[0] === 'O') &&
    (name[1] === 'n' || name[1] === 'N')
  ) {
    return;
  }

  attributeValue = '' + value;
  writeChunk(destination, arrayInterstitial);
  writeChunk(
    destination,
    stringToChunk(escapeJSObjectForInstructionScripts(attributeName))
  );
  writeChunk(destination, arrayInterstitial);
  writeChunk(
    destination,
    stringToChunk(escapeJSObjectForInstructionScripts(attributeValue))
  );
}

// ATTENTION
// When adding new symbols to this file,
// Please consider also adding to 'react-devtools-shared/src/backend/ReactSymbols'
// The Symbol used to tag the ReactElement-like types.
const REACT_ELEMENT_TYPE = Symbol.for('react.element');
const REACT_PORTAL_TYPE = Symbol.for('react.portal');
const REACT_FRAGMENT_TYPE = Symbol.for('react.fragment');
const REACT_STRICT_MODE_TYPE = Symbol.for('react.strict_mode');
const REACT_PROFILER_TYPE = Symbol.for('react.profiler');
const REACT_PROVIDER_TYPE = Symbol.for('react.provider');
const REACT_CONTEXT_TYPE = Symbol.for('react.context');
const REACT_SERVER_CONTEXT_TYPE = Symbol.for('react.server_context');
const REACT_FORWARD_REF_TYPE = Symbol.for('react.forward_ref');
const REACT_SUSPENSE_TYPE = Symbol.for('react.suspense');
const REACT_SUSPENSE_LIST_TYPE = Symbol.for('react.suspense_list');
const REACT_MEMO_TYPE = Symbol.for('react.memo');
const REACT_LAZY_TYPE = Symbol.for('react.lazy');
const REACT_SCOPE_TYPE = Symbol.for('react.scope');
const REACT_DEBUG_TRACING_MODE_TYPE = Symbol.for('react.debug_trace_mode');
const REACT_OFFSCREEN_TYPE = Symbol.for('react.offscreen');
const REACT_LEGACY_HIDDEN_TYPE = Symbol.for('react.legacy_hidden');
const REACT_CACHE_TYPE = Symbol.for('react.cache');
const REACT_SERVER_CONTEXT_DEFAULT_VALUE_NOT_LOADED = Symbol.for(
  'react.default_value'
);
const REACT_MEMO_CACHE_SENTINEL = Symbol.for('react.memo_cache_sentinel');
const MAYBE_ITERATOR_SYMBOL = Symbol.iterator;
const FAUX_ITERATOR_SYMBOL = '@@iterator';
function getIteratorFn(maybeIterable) {
  if (maybeIterable === null || typeof maybeIterable !== 'object') {
    return null;
  }

  const maybeIterator =
    (MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL]) ||
    maybeIterable[FAUX_ITERATOR_SYMBOL];

  if (typeof maybeIterator === 'function') {
    return maybeIterator;
  }

  return null;
}

function getWrappedName(outerType, innerType, wrapperName) {
  const displayName = outerType.displayName;

  if (displayName) {
    return displayName;
  }

  const functionName = innerType.displayName || innerType.name || '';
  return functionName !== ''
    ? wrapperName + '(' + functionName + ')'
    : wrapperName;
} // Keep in sync with react-reconciler/getComponentNameFromFiber

function getContextName(type) {
  return type.displayName || 'Context';
} // Note that the reconciler package should generally prefer to use getComponentNameFromFiber() instead.

function getComponentNameFromType(type) {
  if (type == null) {
    // Host root, text node or just invalid type.
    return null;
  }

  if (typeof type === 'function') {
    return type.displayName || type.name || null;
  }

  if (typeof type === 'string') {
    return type;
  }

  switch (type) {
    case REACT_FRAGMENT_TYPE:
      return 'Fragment';

    case REACT_PORTAL_TYPE:
      return 'Portal';

    case REACT_PROFILER_TYPE:
      return 'Profiler';

    case REACT_STRICT_MODE_TYPE:
      return 'StrictMode';

    case REACT_SUSPENSE_TYPE:
      return 'Suspense';

    case REACT_SUSPENSE_LIST_TYPE:
      return 'SuspenseList';

    case REACT_CACHE_TYPE: {
      return 'Cache';
    }
  }

  if (typeof type === 'object') {
    switch (type.$$typeof) {
      case REACT_CONTEXT_TYPE:
        const context = type;
        return getContextName(context) + '.Consumer';

      case REACT_PROVIDER_TYPE:
        const provider = type;
        return getContextName(provider._context) + '.Provider';

      case REACT_FORWARD_REF_TYPE:
        return getWrappedName(type, type.render, 'ForwardRef');

      case REACT_MEMO_TYPE:
        const outerName = type.displayName || null;

        if (outerName !== null) {
          return outerName;
        }

        return getComponentNameFromType(type.type) || 'Memo';

      case REACT_LAZY_TYPE: {
        const lazyComponent = type;
        const payload = lazyComponent._payload;
        const init = lazyComponent._init;

        try {
          return getComponentNameFromType(init(payload));
        } catch (x) {
          return null;
        }
      }

      case REACT_SERVER_CONTEXT_TYPE: {
        const context2 = type;
        return (context2.displayName || context2._globalName) + '.Provider';
      }

      // eslint-disable-next-line no-fallthrough
    }
  }

  return null;
}

const ReactSharedInternals =
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED$1;

const ReactCurrentDispatcher = ReactSharedInternals.ReactCurrentDispatcher;

const ReactDebugCurrentFrame = ReactSharedInternals.ReactDebugCurrentFrame;

const emptyContextObject = {};

function getMaskedContext(type, unmaskedContext) {
  {
    const contextTypes = type.contextTypes;

    if (!contextTypes) {
      return emptyContextObject;
    }

    const context = {};

    for (const key in contextTypes) {
      context[key] = unmaskedContext[key];
    }

    return context;
  }
}
function processChildContext(instance, type, parentContext, childContextTypes) {
  {
    // TODO (bvaughn) Replace this behavior with an invariant() in the future.
    // It has only been added in Fiber to match the (unintentional) behavior in Stack.
    if (typeof instance.getChildContext !== 'function') {
      return parentContext;
    }

    const childContext = instance.getChildContext();

    for (const contextKey in childContext) {
      if (!(contextKey in childContextTypes)) {
        throw new Error(
          (getComponentNameFromType(type) || 'Unknown') +
            '.getChildContext(): key "' +
            contextKey +
            '" is not defined in childContextTypes.'
        );
      }
    }

    return assign({}, parentContext, childContext);
  }
}

// Forming a reverse tree.

const rootContextSnapshot = null; // We assume that this runtime owns the "current" field on all ReactContext instances.
// This global (actually thread local) state represents what state all those "current",
// fields are currently in.

let currentActiveSnapshot = null;

function popNode(prev) {
  {
    prev.context._currentValue = prev.parentValue;
  }
}

function pushNode(next) {
  {
    next.context._currentValue = next.value;
  }
}

function popToNearestCommonAncestor(prev, next) {
  if (prev === next);
  else {
    popNode(prev);
    const parentPrev = prev.parent;
    const parentNext = next.parent;

    if (parentPrev === null) {
      if (parentNext !== null) {
        throw new Error(
          'The stacks must reach the root at the same time. This is a bug in React.'
        );
      }
    } else {
      if (parentNext === null) {
        throw new Error(
          'The stacks must reach the root at the same time. This is a bug in React.'
        );
      }

      popToNearestCommonAncestor(parentPrev, parentNext);
    } // On the way back, we push the new ones that weren't common.

    pushNode(next);
  }
}

function popAllPrevious(prev) {
  popNode(prev);
  const parentPrev = prev.parent;

  if (parentPrev !== null) {
    popAllPrevious(parentPrev);
  }
}

function pushAllNext(next) {
  const parentNext = next.parent;

  if (parentNext !== null) {
    pushAllNext(parentNext);
  }

  pushNode(next);
}

function popPreviousToCommonLevel(prev, next) {
  popNode(prev);
  const parentPrev = prev.parent;

  if (parentPrev === null) {
    throw new Error(
      'The depth must equal at least at zero before reaching the root. This is a bug in React.'
    );
  }

  if (parentPrev.depth === next.depth) {
    // We found the same level. Now we just need to find a shared ancestor.
    popToNearestCommonAncestor(parentPrev, next);
  } else {
    // We must still be deeper.
    popPreviousToCommonLevel(parentPrev, next);
  }
}

function popNextToCommonLevel(prev, next) {
  const parentNext = next.parent;

  if (parentNext === null) {
    throw new Error(
      'The depth must equal at least at zero before reaching the root. This is a bug in React.'
    );
  }

  if (prev.depth === parentNext.depth) {
    // We found the same level. Now we just need to find a shared ancestor.
    popToNearestCommonAncestor(prev, parentNext);
  } else {
    // We must still be deeper.
    popNextToCommonLevel(prev, parentNext);
  }

  pushNode(next);
} // Perform context switching to the new snapshot.
// To make it cheap to read many contexts, while not suspending, we make the switch eagerly by
// updating all the context's current values. That way reads, always just read the current value.
// At the cost of updating contexts even if they're never read by this subtree.

function switchContext(newSnapshot) {
  // The basic algorithm we need to do is to pop back any contexts that are no longer on the stack.
  // We also need to update any new contexts that are now on the stack with the deepest value.
  // The easiest way to update new contexts is to just reapply them in reverse order from the
  // perspective of the backpointers. To avoid allocating a lot when switching, we use the stack
  // for that. Therefore this algorithm is recursive.
  // 1) First we pop which ever snapshot tree was deepest. Popping old contexts as we go.
  // 2) Then we find the nearest common ancestor from there. Popping old contexts as we go.
  // 3) Then we reapply new contexts on the way back up the stack.
  const prev = currentActiveSnapshot;
  const next = newSnapshot;

  if (prev !== next) {
    if (prev === null) {
      // $FlowFixMe: This has to be non-null since it's not equal to prev.
      pushAllNext(next);
    } else if (next === null) {
      popAllPrevious(prev);
    } else if (prev.depth === next.depth) {
      popToNearestCommonAncestor(prev, next);
    } else if (prev.depth > next.depth) {
      popPreviousToCommonLevel(prev, next);
    } else {
      popNextToCommonLevel(prev, next);
    }

    currentActiveSnapshot = next;
  }
}
function pushProvider(context, nextValue) {
  let prevValue;

  {
    prevValue = context._currentValue;
    context._currentValue = nextValue;
  }

  const prevNode = currentActiveSnapshot;
  const newNode = {
    parent: prevNode,
    depth: prevNode === null ? 0 : prevNode.depth + 1,
    context: context,
    parentValue: prevValue,
    value: nextValue,
  };
  currentActiveSnapshot = newNode;
  return newNode;
}
function popProvider(context) {
  const prevSnapshot = currentActiveSnapshot;

  if (prevSnapshot === null) {
    throw new Error(
      'Tried to pop a Context at the root of the app. This is a bug in React.'
    );
  }

  {
    const value = prevSnapshot.parentValue;

    if (value === REACT_SERVER_CONTEXT_DEFAULT_VALUE_NOT_LOADED) {
      prevSnapshot.context._currentValue = prevSnapshot.context._defaultValue;
    } else {
      prevSnapshot.context._currentValue = value;
    }
  }

  return (currentActiveSnapshot = prevSnapshot.parent);
}
function getActiveContext() {
  return currentActiveSnapshot;
}
function readContext(context) {
  const value = context._currentValue;
  return value;
}

/**
 * `ReactInstanceMap` maintains a mapping from a public facing stateful
 * instance (key) and the internal representation (value). This allows public
 * methods to accept the user facing instance as an argument and map them back
 * to internal methods.
 *
 * Note that this module is currently shared and assumed to be stateless.
 * If this becomes an actual Map, that will break.
 */
function get(key) {
  return key._reactInternals;
}
function set(key, value) {
  key._reactInternals = value;
}

const classComponentUpdater = {
  isMounted(inst) {
    return false;
  },

  enqueueSetState(inst, payload, callback) {
    const internals = get(inst);

    if (internals.queue === null);
    else {
      internals.queue.push(payload);
    }
  },

  enqueueReplaceState(inst, payload, callback) {
    const internals = get(inst);
    internals.replace = true;
    internals.queue = [payload];
  },

  enqueueForceUpdate(inst, callback) {
    const internals = get(inst);

    if (internals.queue === null);
  },
};

function applyDerivedStateFromProps(
  instance,
  ctor,
  getDerivedStateFromProps,
  prevState,
  nextProps
) {
  const partialState = getDerivedStateFromProps(nextProps, prevState);

  const newState =
    partialState === null || partialState === undefined
      ? prevState
      : assign({}, prevState, partialState);
  return newState;
}

function constructClassInstance(ctor, props, maskedLegacyContext) {
  let context = emptyContextObject;
  const contextType = ctor.contextType;

  if (typeof contextType === 'object' && contextType !== null) {
    context = readContext(contextType);
  } else {
    context = maskedLegacyContext;
  }

  const instance = new ctor(props, context);

  return instance;
}

function callComponentWillMount(type, instance) {
  const oldState = instance.state;

  if (typeof instance.componentWillMount === 'function') {
    instance.componentWillMount();
  }

  if (typeof instance.UNSAFE_componentWillMount === 'function') {
    instance.UNSAFE_componentWillMount();
  }

  if (oldState !== instance.state) {
    classComponentUpdater.enqueueReplaceState(instance, instance.state, null);
  }
}

function processUpdateQueue(
  internalInstance,
  inst,
  props,
  maskedLegacyContext
) {
  if (internalInstance.queue !== null && internalInstance.queue.length > 0) {
    const oldQueue = internalInstance.queue;
    const oldReplace = internalInstance.replace;
    internalInstance.queue = null;
    internalInstance.replace = false;

    if (oldReplace && oldQueue.length === 1) {
      inst.state = oldQueue[0];
    } else {
      let nextState = oldReplace ? oldQueue[0] : inst.state;
      let dontMutate = true;

      for (let i = oldReplace ? 1 : 0; i < oldQueue.length; i++) {
        const partial = oldQueue[i];
        const partialState =
          typeof partial === 'function'
            ? partial.call(inst, nextState, props, maskedLegacyContext)
            : partial;

        if (partialState != null) {
          if (dontMutate) {
            dontMutate = false;
            nextState = assign({}, nextState, partialState);
          } else {
            assign(nextState, partialState);
          }
        }
      }

      inst.state = nextState;
    }
  } else {
    internalInstance.queue = null;
  }
} // Invokes the mount life-cycles on a previously never rendered instance.

function mountClassInstance(instance, ctor, newProps, maskedLegacyContext) {
  const initialState = instance.state !== undefined ? instance.state : null;
  instance.updater = classComponentUpdater;
  instance.props = newProps;
  instance.state = initialState; // We don't bother initializing the refs object on the server, since we're not going to resolve them anyway.
  // The internal instance will be used to manage updates that happen during this mount.

  const internalInstance = {
    queue: [],
    replace: false,
  };
  set(instance, internalInstance);
  const contextType = ctor.contextType;

  if (typeof contextType === 'object' && contextType !== null) {
    instance.context = readContext(contextType);
  } else {
    instance.context = maskedLegacyContext;
  }

  const getDerivedStateFromProps = ctor.getDerivedStateFromProps;

  if (typeof getDerivedStateFromProps === 'function') {
    instance.state = applyDerivedStateFromProps(
      instance,
      ctor,
      getDerivedStateFromProps,
      initialState,
      newProps
    );
  } // In order to support react-lifecycles-compat polyfilled components,
  // Unsafe lifecycles should not be invoked for components using the new APIs.

  if (
    typeof ctor.getDerivedStateFromProps !== 'function' &&
    typeof instance.getSnapshotBeforeUpdate !== 'function' &&
    (typeof instance.UNSAFE_componentWillMount === 'function' ||
      typeof instance.componentWillMount === 'function')
  ) {
    callComponentWillMount(ctor, instance); // If we had additional state updates during this life-cycle, let's
    // process them now.

    processUpdateQueue(
      internalInstance,
      instance,
      newProps,
      maskedLegacyContext
    );
  }
}

// Ids are base 32 strings whose binary representation corresponds to the
// position of a node in a tree.
// Every time the tree forks into multiple children, we add additional bits to
// the left of the sequence that represent the position of the child within the
// current level of children.
//
//      00101       00010001011010101
//      ╰─┬─╯       ╰───────┬───────╯
//   Fork 5 of 20       Parent id
//
// The leading 0s are important. In the above example, you only need 3 bits to
// represent slot 5. However, you need 5 bits to represent all the forks at
// the current level, so we must account for the empty bits at the end.
//
// For this same reason, slots are 1-indexed instead of 0-indexed. Otherwise,
// the zeroth id at a level would be indistinguishable from its parent.
//
// If a node has only one child, and does not materialize an id (i.e. does not
// contain a useId hook), then we don't need to allocate any space in the
// sequence. It's treated as a transparent indirection. For example, these two
// trees produce the same ids:
//
// <>                          <>
//   <Indirection>               <A />
//     <A />                     <B />
//   </Indirection>            </>
//   <B />
// </>
//
// However, we cannot skip any node that materializes an id. Otherwise, a parent
// id that does not fork would be indistinguishable from its child id. For
// example, this tree does not fork, but the parent and child must have
// different ids.
//
// <Parent>
//   <Child />
// </Parent>
//
// To handle this scenario, every time we materialize an id, we allocate a
// new level with a single slot. You can think of this as a fork with only one
// prong, or an array of children with length 1.
//
// It's possible for the size of the sequence to exceed 32 bits, the max
// size for bitwise operations. When this happens, we make more room by
// converting the right part of the id to a string and storing it in an overflow
// variable. We use a base 32 string representation, because 32 is the largest
// power of 2 that is supported by toString(). We want the base to be large so
// that the resulting ids are compact, and we want the base to be a power of 2
// because every log2(base) bits corresponds to a single character, i.e. every
// log2(32) = 5 bits. That means we can lop bits off the end 5 at a time without
// affecting the final result.
const emptyTreeContext = {
  id: 1,
  overflow: '',
};
function getTreeId(context) {
  const overflow = context.overflow;
  const idWithLeadingBit = context.id;
  const id = idWithLeadingBit & ~getLeadingBit(idWithLeadingBit);
  return id.toString(32) + overflow;
}
function pushTreeContext(baseContext, totalChildren, index) {
  const baseIdWithLeadingBit = baseContext.id;
  const baseOverflow = baseContext.overflow; // The leftmost 1 marks the end of the sequence, non-inclusive. It's not part
  // of the id; we use it to account for leading 0s.

  const baseLength = getBitLength(baseIdWithLeadingBit) - 1;
  const baseId = baseIdWithLeadingBit & ~(1 << baseLength);
  const slot = index + 1;
  const length = getBitLength(totalChildren) + baseLength; // 30 is the max length we can store without overflowing, taking into
  // consideration the leading 1 we use to mark the end of the sequence.

  if (length > 30) {
    // We overflowed the bitwise-safe range. Fall back to slower algorithm.
    // This branch assumes the length of the base id is greater than 5; it won't
    // work for smaller ids, because you need 5 bits per character.
    //
    // We encode the id in multiple steps: first the base id, then the
    // remaining digits.
    //
    // Each 5 bit sequence corresponds to a single base 32 character. So for
    // example, if the current id is 23 bits long, we can convert 20 of those
    // bits into a string of 4 characters, with 3 bits left over.
    //
    // First calculate how many bits in the base id represent a complete
    // sequence of characters.
    const numberOfOverflowBits = baseLength - (baseLength % 5); // Then create a bitmask that selects only those bits.

    const newOverflowBits = (1 << numberOfOverflowBits) - 1; // Select the bits, and convert them to a base 32 string.

    const newOverflow = (baseId & newOverflowBits).toString(32); // Now we can remove those bits from the base id.

    const restOfBaseId = baseId >> numberOfOverflowBits;
    const restOfBaseLength = baseLength - numberOfOverflowBits; // Finally, encode the rest of the bits using the normal algorithm. Because
    // we made more room, this time it won't overflow.

    const restOfLength = getBitLength(totalChildren) + restOfBaseLength;
    const restOfNewBits = slot << restOfBaseLength;
    const id = restOfNewBits | restOfBaseId;
    const overflow = newOverflow + baseOverflow;
    return {
      id: (1 << restOfLength) | id,
      overflow,
    };
  } else {
    // Normal path
    const newBits = slot << baseLength;
    const id = newBits | baseId;
    const overflow = baseOverflow;
    return {
      id: (1 << length) | id,
      overflow,
    };
  }
}

function getBitLength(number) {
  return 32 - clz32(number);
}

function getLeadingBit(id) {
  return 1 << (getBitLength(id) - 1);
} // TODO: Math.clz32 is supported in Node 12+. Maybe we can drop the fallback.

const clz32 = Math.clz32 ? Math.clz32 : clz32Fallback; // Count leading zeros.
// Based on:
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/clz32

const log = Math.log;
const LN2 = Math.LN2;

function clz32Fallback(x) {
  const asUint = x >>> 0;

  if (asUint === 0) {
    return 32;
  }

  return (31 - ((log(asUint) / LN2) | 0)) | 0;
}

// Corresponds to ReactFiberWakeable and ReactFlightWakeable modules. Generally,
// changes to one module should be reflected in the others.
// TODO: Rename this module and the corresponding Fiber one to "Thenable"
// instead of "Wakeable". Or some other more appropriate name.
function createThenableState() {
  // The ThenableState is created the first time a component suspends. If it
  // suspends again, we'll reuse the same state.
  return [];
}

function noop() {}

function trackUsedThenable(thenableState, thenable, index) {
  const previous = thenableState[index];

  if (previous === undefined) {
    thenableState.push(thenable);
  } else {
    if (previous !== thenable) {
      // Reuse the previous thenable, and drop the new one. We can assume
      // they represent the same value, because components are idempotent.
      // Avoid an unhandled rejection errors for the Promises that we'll
      // intentionally ignore.
      thenable.then(noop, noop);
      thenable = previous;
    }
  } // We use an expando to track the status and result of a thenable so that we
  // can synchronously unwrap the value. Think of this as an extension of the
  // Promise API, or a custom interface that is a superset of Thenable.
  //
  // If the thenable doesn't have a status, set it to "pending" and attach
  // a listener that will update its status and result when it resolves.

  switch (thenable.status) {
    case 'fulfilled': {
      const fulfilledValue = thenable.value;
      return fulfilledValue;
    }

    case 'rejected': {
      const rejectedError = thenable.reason;
      throw rejectedError;
    }

    default: {
      if (typeof thenable.status === 'string');
      else {
        const pendingThenable = thenable;
        pendingThenable.status = 'pending';
        pendingThenable.then(
          (fulfilledValue) => {
            if (thenable.status === 'pending') {
              const fulfilledThenable = thenable;
              fulfilledThenable.status = 'fulfilled';
              fulfilledThenable.value = fulfilledValue;
            }
          },
          (error) => {
            if (thenable.status === 'pending') {
              const rejectedThenable = thenable;
              rejectedThenable.status = 'rejected';
              rejectedThenable.reason = error;
            }
          }
        );
      } // Suspend.
      // TODO: Throwing here is an implementation detail that allows us to
      // unwind the call stack. But we shouldn't allow it to leak into
      // userspace. Throw an opaque placeholder value instead of the
      // actual thenable. If it doesn't get captured by the work loop, log
      // a warning, because that means something in userspace must have
      // caught it.

      throw thenable;
    }
  }
}

/**
 * inlined Object.is polyfill to avoid requiring consumers ship their own
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/is
 */
function is(x, y) {
  return (
    (x === y && (x !== 0 || 1 / x === 1 / y)) || (x !== x && y !== y) // eslint-disable-line no-self-compare
  );
}

const objectIs = typeof Object.is === 'function' ? Object.is : is; // $FlowFixMe[method-unbinding]

let currentlyRenderingComponent = null;
let currentlyRenderingTask = null;
let firstWorkInProgressHook = null;
let workInProgressHook = null; // Whether the work-in-progress hook is a re-rendered hook

let isReRender = false; // Whether an update was scheduled during the currently executing render pass.

let didScheduleRenderPhaseUpdate = false; // Counts the number of useId hooks in this component

let localIdCounter = 0; // Counts the number of use(thenable) calls in this component

let thenableIndexCounter = 0;
let thenableState = null; // Lazily created map of render-phase updates

let renderPhaseUpdates = null; // Counter to prevent infinite loops.

let numberOfReRenders = 0;
const RE_RENDER_LIMIT = 25;

function resolveCurrentlyRenderingComponent() {
  if (currentlyRenderingComponent === null) {
    throw new Error(
      'Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for' +
        ' one of the following reasons:\n' +
        '1. You might have mismatching versions of React and the renderer (such as React DOM)\n' +
        '2. You might be breaking the Rules of Hooks\n' +
        '3. You might have more than one copy of React in the same app\n' +
        'See https://reactjs.org/link/invalid-hook-call for tips about how to debug and fix this problem.'
    );
  }

  return currentlyRenderingComponent;
}

function areHookInputsEqual(nextDeps, prevDeps) {
  if (prevDeps === null) {
    return false;
  }

  for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
    // $FlowFixMe[incompatible-use] found when upgrading Flow
    if (objectIs(nextDeps[i], prevDeps[i])) {
      continue;
    }

    return false;
  }

  return true;
}

function createHook() {
  if (numberOfReRenders > 0) {
    throw new Error('Rendered more hooks than during the previous render');
  }

  return {
    memoizedState: null,
    queue: null,
    next: null,
  };
}

function createWorkInProgressHook() {
  if (workInProgressHook === null) {
    // This is the first hook in the list
    if (firstWorkInProgressHook === null) {
      isReRender = false;
      firstWorkInProgressHook = workInProgressHook = createHook();
    } else {
      // There's already a work-in-progress. Reuse it.
      isReRender = true;
      workInProgressHook = firstWorkInProgressHook;
    }
  } else {
    if (workInProgressHook.next === null) {
      isReRender = false; // Append to the end of the list

      workInProgressHook = workInProgressHook.next = createHook();
    } else {
      // There's already a work-in-progress. Reuse it.
      isReRender = true;
      workInProgressHook = workInProgressHook.next;
    }
  }

  return workInProgressHook;
}

function prepareToUseHooks(task, componentIdentity, prevThenableState) {
  currentlyRenderingComponent = componentIdentity;
  currentlyRenderingTask = task;
  // didScheduleRenderPhaseUpdate = false;
  // firstWorkInProgressHook = null;
  // numberOfReRenders = 0;
  // renderPhaseUpdates = null;
  // workInProgressHook = null;

  localIdCounter = 0;
  thenableIndexCounter = 0;
  thenableState = prevThenableState;
}
function finishHooks(Component, props, children, refOrContext) {
  // This must be called after every function component to prevent hooks from
  // being used in classes.
  while (didScheduleRenderPhaseUpdate) {
    // Updates were scheduled during the render phase. They are stored in
    // the `renderPhaseUpdates` map. Call the component again, reusing the
    // work-in-progress hooks and applying the additional updates on top. Keep
    // restarting until no more updates are scheduled.
    didScheduleRenderPhaseUpdate = false;
    localIdCounter = 0;
    thenableIndexCounter = 0;
    numberOfReRenders += 1; // Start over from the beginning of the list

    workInProgressHook = null;
    children = Component(props, refOrContext);
  }

  resetHooksState();
  return children;
}
function getThenableStateAfterSuspending() {
  const state = thenableState;
  thenableState = null;
  return state;
}
function checkDidRenderIdHook() {
  // This should be called immediately after every finishHooks call.
  // Conceptually, it's part of the return value of finishHooks; it's only a
  // separate function to avoid using an array tuple.
  const didRenderIdHook = localIdCounter !== 0;
  return didRenderIdHook;
} // Reset the internal hooks state if an error occurs while rendering a component

function resetHooksState() {
  currentlyRenderingComponent = null;
  currentlyRenderingTask = null;
  didScheduleRenderPhaseUpdate = false;
  firstWorkInProgressHook = null;
  numberOfReRenders = 0;
  renderPhaseUpdates = null;
  workInProgressHook = null;
}

function readContext$1(context) {
  return readContext(context);
}

function useContext(context) {
  resolveCurrentlyRenderingComponent();
  return readContext(context);
}

function basicStateReducer(state, action) {
  // $FlowFixMe: Flow doesn't like mixed types
  return typeof action === 'function' ? action(state) : action;
}

function useState(initialState) {
  return useReducer(
    basicStateReducer, // useReducer has a special case to support lazy useState initializers
    initialState
  );
}
function useReducer(reducer, initialArg, init) {
  currentlyRenderingComponent = resolveCurrentlyRenderingComponent();
  workInProgressHook = createWorkInProgressHook();

  if (isReRender) {
    // This is a re-render. Apply the new render phase updates to the previous
    // current hook.
    const queue = workInProgressHook.queue;
    const dispatch = queue.dispatch;

    if (renderPhaseUpdates !== null) {
      // Render phase updates are stored in a map of queue -> linked list
      const firstRenderPhaseUpdate = renderPhaseUpdates.get(queue);

      if (firstRenderPhaseUpdate !== undefined) {
        // $FlowFixMe[incompatible-use] found when upgrading Flow
        renderPhaseUpdates.delete(queue); // $FlowFixMe[incompatible-use] found when upgrading Flow

        let newState = workInProgressHook.memoizedState;
        let update = firstRenderPhaseUpdate;

        do {
          // Process this render phase update. We don't have to check the
          // priority because it will always be the same as the current
          // render's.
          const action = update.action;

          newState = reducer(newState, action);

          update = update.next;
        } while (update !== null); // $FlowFixMe[incompatible-use] found when upgrading Flow

        workInProgressHook.memoizedState = newState;
        return [newState, dispatch];
      }
    } // $FlowFixMe[incompatible-use] found when upgrading Flow

    return [workInProgressHook.memoizedState, dispatch];
  } else {
    let initialState;

    if (reducer === basicStateReducer) {
      // Special case for `useState`.
      initialState =
        typeof initialArg === 'function' ? initialArg() : initialArg;
    } else {
      initialState = init !== undefined ? init(initialArg) : initialArg;
    }

    workInProgressHook.memoizedState = initialState; // $FlowFixMe[incompatible-use] found when upgrading Flow

    const queue = (workInProgressHook.queue = {
      last: null,
      dispatch: null,
    });
    const dispatch = (queue.dispatch = dispatchAction.bind(
      null,
      currentlyRenderingComponent,
      queue
    )); // $FlowFixMe[incompatible-use] found when upgrading Flow

    return [workInProgressHook.memoizedState, dispatch];
  }
}

function useMemo(nextCreate, deps) {
  currentlyRenderingComponent = resolveCurrentlyRenderingComponent();
  workInProgressHook = createWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;

  if (workInProgressHook !== null) {
    const prevState = workInProgressHook.memoizedState;

    if (prevState !== null) {
      if (nextDeps !== null) {
        const prevDeps = prevState[1];

        if (areHookInputsEqual(nextDeps, prevDeps)) {
          return prevState[0];
        }
      }
    }
  }

  const nextValue = nextCreate();

  workInProgressHook.memoizedState = [nextValue, nextDeps];
  return nextValue;
}

function useRef(initialValue) {
  currentlyRenderingComponent = resolveCurrentlyRenderingComponent();
  workInProgressHook = createWorkInProgressHook();
  const previousRef = workInProgressHook.memoizedState;

  if (previousRef === null) {
    const ref = {
      current: initialValue,
    };

    workInProgressHook.memoizedState = ref;
    return ref;
  } else {
    return previousRef;
  }
}

function useLayoutEffect(create, inputs) {}

function dispatchAction(componentIdentity, queue, action) {
  if (numberOfReRenders >= RE_RENDER_LIMIT) {
    throw new Error(
      'Too many re-renders. React limits the number of renders to prevent ' +
        'an infinite loop.'
    );
  }

  if (componentIdentity === currentlyRenderingComponent) {
    // This is a render phase update. Stash it in a lazily-created map of
    // queue -> linked list of updates. After this render pass, we'll restart
    // and apply the stashed updates on top of the work-in-progress hook.
    didScheduleRenderPhaseUpdate = true;
    const update = {
      action,
      next: null,
    };

    if (renderPhaseUpdates === null) {
      renderPhaseUpdates = new Map();
    }

    const firstRenderPhaseUpdate = renderPhaseUpdates.get(queue);

    if (firstRenderPhaseUpdate === undefined) {
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      renderPhaseUpdates.set(queue, update);
    } else {
      // Append the update to the end of the list.
      let lastRenderPhaseUpdate = firstRenderPhaseUpdate;

      while (lastRenderPhaseUpdate.next !== null) {
        lastRenderPhaseUpdate = lastRenderPhaseUpdate.next;
      }

      lastRenderPhaseUpdate.next = update;
    }
  }
}

function useCallback(callback, deps) {
  return useMemo(() => callback, deps);
}

function throwOnUseEventCall() {
  throw new Error(
    "A function wrapped in useEvent can't be called during rendering."
  );
}

function useEvent(callback) {
  // $FlowIgnore[incompatible-return]
  return throwOnUseEventCall;
} // TODO Decide on how to implement this hook for server rendering.
// If a mutation occurs during render, consider triggering a Suspense boundary
// and falling back to client rendering.

function useMutableSource(source, getSnapshot, subscribe) {
  resolveCurrentlyRenderingComponent();
  return getSnapshot(source._source);
}

function useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
  if (getServerSnapshot === undefined) {
    throw new Error(
      'Missing getServerSnapshot, which is required for ' +
        'server-rendered content. Will revert to client rendering.'
    );
  }

  return getServerSnapshot();
}

function useDeferredValue(value) {
  resolveCurrentlyRenderingComponent();
  return value;
}

function unsupportedStartTransition() {
  throw new Error('startTransition cannot be called during server rendering.');
}

function useTransition() {
  resolveCurrentlyRenderingComponent();
  return [false, unsupportedStartTransition];
}

function useId() {
  const task = currentlyRenderingTask;
  const treeId = getTreeId(task.treeContext);
  const responseState = currentResponseState;

  if (responseState === null) {
    throw new Error(
      'Invalid hook call. Hooks can only be called inside of the body of a function component.'
    );
  }

  const localId = localIdCounter++;
  return makeId(responseState, treeId, localId);
}

function use(usable) {
  if (usable !== null && typeof usable === 'object') {
    // $FlowFixMe[method-unbinding]
    if (typeof usable.then === 'function') {
      // This is a thenable.
      const thenable = usable; // Track the position of the thenable within this fiber.

      const index = thenableIndexCounter;
      thenableIndexCounter += 1;

      if (thenableState === null) {
        thenableState = createThenableState();
      }

      return trackUsedThenable(thenableState, thenable, index);
    } else if (
      usable.$$typeof === REACT_CONTEXT_TYPE ||
      usable.$$typeof === REACT_SERVER_CONTEXT_TYPE
    ) {
      const context = usable;
      return readContext$1(context);
    }
  } // eslint-disable-next-line react-internal/safe-string-coercion

  throw new Error('An unsupported type was passed to use(): ' + String(usable));
}

function unsupportedRefresh() {
  throw new Error('Cache cannot be refreshed during server rendering.');
}

function useCacheRefresh() {
  return unsupportedRefresh;
}

function useMemoCache(size) {
  const data = new Array(size);

  for (let i = 0; i < size; i++) {
    data[i] = REACT_MEMO_CACHE_SENTINEL;
  }

  return data;
}

function noop$1() {}

const HooksDispatcher = {
  readContext: readContext$1,
  useContext,
  useMemo,
  useReducer,
  useRef,
  useState,
  useInsertionEffect: noop$1,
  useLayoutEffect,
  useCallback,
  // useImperativeHandle is not run in the server environment
  useImperativeHandle: noop$1,
  // Effects are not run in the server environment.
  useEffect: noop$1,
  // Debugging effect
  useDebugValue: noop$1,
  useDeferredValue,
  useTransition,
  useId,
  // Subscriptions are not setup in a server environment.
  useMutableSource,
  useSyncExternalStore,
};

{
  HooksDispatcher.useCacheRefresh = useCacheRefresh;
}

{
  HooksDispatcher.useEvent = useEvent;
}

{
  HooksDispatcher.useMemoCache = useMemoCache;
}

{
  HooksDispatcher.use = use;
}

let currentResponseState = null;
function setCurrentResponseState(responseState) {
  currentResponseState = responseState;
}

function getCacheSignal() {
  throw new Error('Not implemented.');
}

function getCacheForType(resourceType) {
  throw new Error('Not implemented.');
}

const DefaultCacheDispatcher = {
  getCacheSignal,
  getCacheForType,
};

const ReactCurrentDispatcher$1 = ReactSharedInternals.ReactCurrentDispatcher;
const ReactCurrentCache = ReactSharedInternals.ReactCurrentCache;
const ReactDebugCurrentFrame$1 = ReactSharedInternals.ReactDebugCurrentFrame;
const PENDING = 0;
const COMPLETED = 1;
const FLUSHED = 2;
const ABORTED = 3;
const ERRORED = 4;
const OPEN = 0;
const CLOSING = 1;
const CLOSED = 2;
// This is a default heuristic for how to split up the HTML content into progressive
// loading. Our goal is to be able to display additional new content about every 500ms.
// Faster than that is unnecessary and should be throttled on the client. It also
// adds unnecessary overhead to do more splits. We don't know if it's a higher or lower
// end device but higher end suffer less from the overhead than lower end does from
// not getting small enough pieces. We error on the side of low end.
// We base this on low end 3G speeds which is about 500kbits per second. We assume
// that there can be a reasonable drop off from max bandwidth which leaves you with
// as little as 80%. We can receive half of that each 500ms - at best. In practice,
// a little bandwidth is lost to processing and contention - e.g. CSS and images that
// are downloaded along with the main content. So we estimate about half of that to be
// the lower end throughput. In other words, we expect that you can at least show
// about 12.5kb of content per 500ms. Not counting starting latency for the first
// paint.
// 500 * 1024 / 8 * .8 * 0.5 / 2
const DEFAULT_PROGRESSIVE_CHUNK_SIZE = 12800;

function defaultErrorHandler(error) {
  console['error'](error); // Don't transform to our wrapper

  return null;
}

function noop$2() {}

function createRequest(
  children,
  responseState,
  rootFormatContext,
  progressiveChunkSize,
  onError,
  onAllReady,
  onShellReady,
  onShellError,
  onFatalError
) {
  const pingedTasks = [];
  const abortSet = new Set();
  const resources = createResources();
  const request = {
    destination: null,
    responseState,
    progressiveChunkSize:
      progressiveChunkSize === undefined
        ? DEFAULT_PROGRESSIVE_CHUNK_SIZE
        : progressiveChunkSize,
    status: OPEN,
    fatalError: null,
    nextSegmentId: 0,
    allPendingTasks: 0,
    pendingRootTasks: 0,
    resources,
    completedRootSegment: null,
    abortableTasks: abortSet,
    pingedTasks: pingedTasks,
    clientRenderedBoundaries: [],
    completedBoundaries: [],
    partialBoundaries: [],
    preamble: [],
    postamble: [],
    onError: onError === undefined ? defaultErrorHandler : onError,
    onAllReady: onAllReady === undefined ? noop$2 : onAllReady,
    onShellReady: onShellReady === undefined ? noop$2 : onShellReady,
    onShellError: onShellError === undefined ? noop$2 : onShellError,
    onFatalError: onFatalError === undefined ? noop$2 : onFatalError,
  }; // This segment represents the root fallback.

  const rootSegment = createPendingSegment(
    request,
    0,
    null,
    rootFormatContext, // Root segments are never embedded in Text on either edge
    false,
    false
  ); // There is no parent so conceptually, we're unblocked to flush this segment.

  rootSegment.parentFlushed = true;
  const rootTask = createTask(
    request,
    null,
    children,
    null,
    rootSegment,
    abortSet,
    emptyContextObject,
    rootContextSnapshot,
    emptyTreeContext
  );
  pingedTasks.push(rootTask);
  return request;
}

function pingTask(request, task) {
  const pingedTasks = request.pingedTasks;
  pingedTasks.push(task);

  if (pingedTasks.length === 1) {
    scheduleWork(() => performWork(request));
  }
}

function createSuspenseBoundary(request, fallbackAbortableTasks) {
  return {
    id: UNINITIALIZED_SUSPENSE_BOUNDARY_ID,
    rootSegmentID: -1,
    parentFlushed: false,
    pendingTasks: 0,
    forceClientRender: false,
    completedSegments: [],
    byteSize: 0,
    fallbackAbortableTasks,
    errorDigest: null,
    resources: createBoundaryResources(),
  };
}

function createTask(
  request,
  thenableState,
  node,
  blockedBoundary,
  blockedSegment,
  abortSet,
  legacyContext,
  context,
  treeContext
) {
  request.allPendingTasks++;

  if (blockedBoundary === null) {
    request.pendingRootTasks++;
  } else {
    blockedBoundary.pendingTasks++;
  }

  const task = {
    node,
    ping: () => pingTask(request, task),
    blockedBoundary,
    blockedSegment,
    abortSet,
    legacyContext,
    context,
    treeContext,
    thenableState,
  };

  abortSet.add(task);
  return task;
}

function createPendingSegment(
  request,
  index,
  boundary,
  formatContext,
  lastPushedText,
  textEmbedded
) {
  return {
    status: PENDING,
    id: -1,
    // lazily assigned later
    index,
    parentFlushed: false,
    chunks: [],
    children: [],
    formatContext,
    boundary,
    lastPushedText,
    textEmbedded,
  };
} // DEV-only global reference to the currently executing task

function pushFunctionComponentStackInDEV(task, type) {}

function popComponentStackInDEV(task) {} // stash the component stack of an unwinding error until it is processed

function logRecoverableError(request, error) {
  // If this callback errors, we intentionally let that error bubble up to become a fatal error
  // so that someone fixes the error reporting instead of hiding it.
  const errorDigest = request.onError(error);

  if (errorDigest != null && typeof errorDigest !== 'string') {
    // eslint-disable-next-line react-internal/prod-error-codes
    throw new Error(
      'onError returned something with a type other than "string". onError should return a string and may return null or undefined but must not return anything else. It received something of type "' +
        typeof errorDigest +
        '" instead'
    );
  }

  return errorDigest;
}

function fatalError(request, error) {
  // This is called outside error handling code such as if the root errors outside
  // a suspense boundary or if the root suspense boundary's fallback errors.
  // It's also called if React itself or its host configs errors.
  const onShellError = request.onShellError;
  onShellError(error);
  const onFatalError = request.onFatalError;
  onFatalError(error);

  if (request.destination !== null) {
    request.status = CLOSED;
    closeWithError(request.destination, error);
  } else {
    request.status = CLOSING;
    request.fatalError = error;
  }
}

function renderSuspenseBoundary(request, task, props) {
  const parentBoundary = task.blockedBoundary;
  const parentSegment = task.blockedSegment; // Each time we enter a suspense boundary, we split out into a new segment for
  // the fallback so that we can later replace that segment with the content.
  // This also lets us split out the main content even if it doesn't suspend,
  // in case it ends up generating a large subtree of content.

  const fallback = props.fallback;
  const content = props.children;
  const fallbackAbortSet = new Set();
  const newBoundary = createSuspenseBoundary(request, fallbackAbortSet);
  const insertionIndex = parentSegment.chunks.length; // The children of the boundary segment is actually the fallback.

  const boundarySegment = createPendingSegment(
    request,
    insertionIndex,
    newBoundary,
    parentSegment.formatContext, // boundaries never require text embedding at their edges because comment nodes bound them
    false,
    false
  );
  parentSegment.children.push(boundarySegment); // The parentSegment has a child Segment at this index so we reset the lastPushedText marker on the parent

  parentSegment.lastPushedText = false; // This segment is the actual child content. We can start rendering that immediately.

  const contentRootSegment = createPendingSegment(
    request,
    0,
    null,
    parentSegment.formatContext, // boundaries never require text embedding at their edges because comment nodes bound them
    false,
    false
  ); // We mark the root segment as having its parent flushed. It's not really flushed but there is
  // no parent segment so there's nothing to wait on.

  contentRootSegment.parentFlushed = true; // Currently this is running synchronously. We could instead schedule this to pingedTasks.
  // I suspect that there might be some efficiency benefits from not creating the suspended task
  // and instead just using the stack if possible.
  // TODO: Call this directly instead of messing with saving and restoring contexts.
  // We can reuse the current context and task to render the content immediately without
  // context switching. We just need to temporarily switch which boundary and which segment
  // we're writing to. If something suspends, it'll spawn new suspended task with that context.

  task.blockedBoundary = newBoundary;
  task.blockedSegment = contentRootSegment;

  {
    setCurrentlyRenderingBoundaryResourcesTarget(
      request.resources,
      newBoundary.resources
    );
  }

  try {
    // We use the safe form because we don't handle suspending here. Only error handling.
    renderNode(request, task, content);
    pushSegmentFinale(
      contentRootSegment.chunks,
      request.responseState,
      contentRootSegment.lastPushedText,
      contentRootSegment.textEmbedded
    );
    contentRootSegment.status = COMPLETED;

    if (enableFloat) {
      if (newBoundary.pendingTasks === 0) {
        hoistCompletedBoundaryResources(request, newBoundary);
      }
    }

    queueCompletedSegment(newBoundary, contentRootSegment);

    if (newBoundary.pendingTasks === 0) {
      // This must have been the last segment we were waiting on. This boundary is now complete.
      // Therefore we won't need the fallback. We early return so that we don't have to create
      // the fallback.
      popComponentStackInDEV(task);
      return;
    }
  } catch (error) {
    contentRootSegment.status = ERRORED;
    newBoundary.forceClientRender = true;
    newBoundary.errorDigest = logRecoverableError(request, error);
    // We don't need to schedule any task because we know the parent has written yet.
    // We do need to fallthrough to create the fallback though.
  } finally {
    {
      setCurrentlyRenderingBoundaryResourcesTarget(
        request.resources,
        parentBoundary ? parentBoundary.resources : null
      );
    }

    task.blockedBoundary = parentBoundary;
    task.blockedSegment = parentSegment;
  } // We create suspended task for the fallback because we don't want to actually work
  // on it yet in case we finish the main content, so we queue for later.

  const suspendedFallbackTask = createTask(
    request,
    null,
    fallback,
    parentBoundary,
    boundarySegment,
    fallbackAbortSet,
    task.legacyContext,
    task.context,
    task.treeContext
  );
  // on preparing fallbacks if we don't have any more main content to task on.

  request.pingedTasks.push(suspendedFallbackTask);
}

function hoistCompletedBoundaryResources(request, completedBoundary) {
  if (request.completedRootSegment !== null || request.pendingRootTasks > 0) {
    // The Shell has not flushed yet. we can hoist Resources for this boundary
    // all the way to the Root.
    hoistResourcesToRoot(request.resources, completedBoundary.resources);
  } // We don't hoist if the root already flushed because late resources will be hoisted
  // as boundaries flush
}

function renderHostElement(request, task, type, props) {
  const segment = task.blockedSegment;
  const children = pushStartInstance(
    segment.chunks,
    request.preamble,
    type,
    props,
    request.responseState,
    segment.formatContext,
    segment.lastPushedText
  );
  segment.lastPushedText = false;
  const prevContext = segment.formatContext;
  segment.formatContext = getChildFormatContext(prevContext, type, props); // We use the non-destructive form because if something suspends, we still
  // need to pop back up and finish this subtree of HTML.

  renderNode(request, task, children); // We expect that errors will fatal the whole task and that we don't need
  // the correct context. Therefore this is not in a finally.

  segment.formatContext = prevContext;
  pushEndInstance(segment.chunks, request.postamble, type);
  segment.lastPushedText = false;
}

function shouldConstruct(Component) {
  return Component.prototype && Component.prototype.isReactComponent;
}

function renderWithHooks(
  request,
  task,
  prevThenableState,
  Component,
  props,
  secondArg
) {
  const componentIdentity = {};
  prepareToUseHooks(task, componentIdentity, prevThenableState);
  const result = Component(props, secondArg);
  return finishHooks(Component, props, result, secondArg);
}

function finishClassComponent(request, task, instance, Component, props) {
  const nextChildren = instance.render();

  {
    const childContextTypes = Component.childContextTypes;

    if (childContextTypes !== null && childContextTypes !== undefined) {
      const previousContext = task.legacyContext;
      const mergedContext = processChildContext(
        instance,
        Component,
        previousContext,
        childContextTypes
      );
      task.legacyContext = mergedContext;
      renderNodeDestructive(request, task, null, nextChildren);
      task.legacyContext = previousContext;
      return;
    }
  }

  renderNodeDestructive(request, task, null, nextChildren);
}

function renderClassComponent(request, task, Component, props) {
  const maskedContext = getMaskedContext(Component, task.legacyContext);
  const instance = constructClassInstance(Component, props, maskedContext);
  mountClassInstance(instance, Component, props, maskedContext);
  finishClassComponent(request, task, instance, Component);
}
// components for some reason.

function renderIndeterminateComponent(
  request,
  task,
  prevThenableState,
  Component,
  props
) {
  let legacyContext;

  {
    legacyContext = getMaskedContext(Component, task.legacyContext);
  }

  const value = renderWithHooks(
    request,
    task,
    prevThenableState,
    Component,
    props,
    legacyContext
  );
  const hasId = checkDidRenderIdHook();

  if (
    // Run these checks in production only if the flag is off.
    // Eventually we'll delete this branch altogether.
    typeof value === 'object' &&
    value !== null &&
    typeof value.render === 'function' &&
    value.$$typeof === undefined
  ) {
    mountClassInstance(value, Component, props, legacyContext);
    finishClassComponent(request, task, value, Component);
  } else {
    // the previous task every again, so we can use the destructive recursive form.

    if (hasId) {
      // This component materialized an id. We treat this as its own level, with
      // a single "child" slot.
      const prevTreeContext = task.treeContext;
      const totalChildren = 1;
      const index = 0;
      task.treeContext = pushTreeContext(prevTreeContext, totalChildren, index);

      try {
        renderNodeDestructive(request, task, null, value);
      } finally {
        task.treeContext = prevTreeContext;
      }
    } else {
      renderNodeDestructive(request, task, null, value);
    }
  }
}

function resolveDefaultProps(Component, baseProps) {
  if (Component && Component.defaultProps) {
    // Resolve default props. Taken from ReactElement
    const props = assign({}, baseProps);
    const defaultProps = Component.defaultProps;

    for (const propName in defaultProps) {
      if (props[propName] === undefined) {
        props[propName] = defaultProps[propName];
      }
    }

    return props;
  }

  return baseProps;
}

function renderForwardRef(request, task, prevThenableState, type, props, ref) {
  pushFunctionComponentStackInDEV(task, type.render);
  const children = renderWithHooks(
    request,
    task,
    prevThenableState,
    type.render,
    props,
    ref
  );
  const hasId = checkDidRenderIdHook();

  if (hasId) {
    // This component materialized an id. We treat this as its own level, with
    // a single "child" slot.
    const prevTreeContext = task.treeContext;
    const totalChildren = 1;
    const index = 0;
    task.treeContext = pushTreeContext(prevTreeContext, totalChildren, index);

    try {
      renderNodeDestructive(request, task, null, children);
    } finally {
      task.treeContext = prevTreeContext;
    }
  } else {
    renderNodeDestructive(request, task, null, children);
  }
}

function renderMemo(request, task, prevThenableState, type, props, ref) {
  const innerType = type.type;
  const resolvedProps = resolveDefaultProps(innerType, props);
  renderElement(
    request,
    task,
    prevThenableState,
    innerType,
    resolvedProps,
    ref
  );
}

function renderContextConsumer(request, task, context, props) {
  const render = props.children;

  const newValue = readContext(context);
  const newChildren = render(newValue);
  renderNodeDestructive(request, task, null, newChildren);
}

function renderContextProvider(request, task, type, props) {
  const context = type._context;
  const value = props.value;
  const children = props.children;

  task.context = pushProvider(context, value);
  renderNodeDestructive(request, task, null, children);
  task.context = popProvider();
}

function renderLazyComponent(
  request,
  task,
  prevThenableState,
  lazyComponent,
  props,
  ref
) {
  const payload = lazyComponent._payload;
  const init = lazyComponent._init;
  const Component = init(payload);
  const resolvedProps = resolveDefaultProps(Component, props);
  renderElement(
    request,
    task,
    prevThenableState,
    Component,
    resolvedProps,
    ref
  );
}

function renderOffscreen(request, task, props) {
  const mode = props.mode;

  if (mode === 'hidden');
  else {
    // A visible Offscreen boundary is treated exactly like a fragment: a
    // pure indirection.
    renderNodeDestructive(request, task, null, props.children);
  }
}

function renderElement(request, task, prevThenableState, type, props, ref) {
  if (typeof type === 'function') {
    if (shouldConstruct(type)) {
      renderClassComponent(request, task, type, props);
      return;
    } else {
      renderIndeterminateComponent(
        request,
        task,
        prevThenableState,
        type,
        props
      );
      return;
    }
  }

  if (typeof type === 'string') {
    renderHostElement(request, task, type, props);
    return;
  }

  switch (type) {
    // LegacyHidden acts the same as a fragment. This only works because we
    // currently assume that every instance of LegacyHidden is accompanied by a
    // host component wrapper. In the hidden mode, the host component is given a
    // `hidden` attribute, which ensures that the initial HTML is not visible.
    // To support the use of LegacyHidden as a true fragment, without an extra
    // DOM node, we would have to hide the initial HTML in some other way.
    // TODO: Delete in LegacyHidden. It's an unstable API only used in the
    // www build. As a migration step, we could add a special prop to Offscreen
    // that simulates the old behavior (no hiding, no change to effects).
    case REACT_LEGACY_HIDDEN_TYPE:
    case REACT_DEBUG_TRACING_MODE_TYPE:
    case REACT_STRICT_MODE_TYPE:
    case REACT_PROFILER_TYPE:
    case REACT_FRAGMENT_TYPE: {
      renderNodeDestructive(request, task, null, props.children);
      return;
    }

    case REACT_OFFSCREEN_TYPE: {
      renderOffscreen(request, task, props);
      return;
    }

    case REACT_SUSPENSE_LIST_TYPE: {
      renderNodeDestructive(request, task, null, props.children);
      return;
    }

    case REACT_SCOPE_TYPE: {
      throw new Error('ReactDOMServer does not yet support scope components.');
    }
    // eslint-disable-next-line-no-fallthrough

    case REACT_SUSPENSE_TYPE: {
      {
        renderSuspenseBoundary(request, task, props);
      }

      return;
    }
  }

  if (typeof type === 'object' && type !== null) {
    switch (type.$$typeof) {
      case REACT_FORWARD_REF_TYPE: {
        renderForwardRef(request, task, prevThenableState, type, props, ref);
        return;
      }

      case REACT_MEMO_TYPE: {
        renderMemo(request, task, prevThenableState, type, props, ref);
        return;
      }

      case REACT_PROVIDER_TYPE: {
        renderContextProvider(request, task, type, props);
        return;
      }

      case REACT_CONTEXT_TYPE: {
        renderContextConsumer(request, task, type, props);
        return;
      }

      case REACT_LAZY_TYPE: {
        renderLazyComponent(request, task, prevThenableState, type, props);
        return;
      }
    }
  }

  let info = '';

  throw new Error(
    'Element type is invalid: expected a string (for built-in ' +
      'components) or a class/function (for composite components) ' +
      ('but got: ' + (type == null ? type : typeof type) + '.' + info)
  );
}

function renderNodeDestructive(
  request,
  task, // The thenable state reused from the previous attempt, if any. This is almost
  // always null, except when called by retryTask.
  prevThenableState,
  node
) {
  {
    return renderNodeDestructiveImpl(request, task, prevThenableState, node);
  }
} // This function by it self renders a node and consumes the task by mutating it
// to update the current execution state.

function renderNodeDestructiveImpl(request, task, prevThenableState, node) {
  // Stash the node we're working on. We'll pick up from this task in case
  // something suspends.
  task.node = node; // Handle object types

  if (typeof node === 'object' && node !== null) {
    switch (node.$$typeof) {
      case REACT_ELEMENT_TYPE: {
        const element = node;
        const type = element.type;
        const props = element.props;
        const ref = element.ref;
        renderElement(request, task, prevThenableState, type, props, ref);
        return;
      }

      case REACT_PORTAL_TYPE:
        throw new Error(
          'Portals are not currently supported by the server renderer. ' +
            'Render them conditionally so that they only appear on the client render.'
        );
      // eslint-disable-next-line-no-fallthrough

      case REACT_LAZY_TYPE: {
        const lazyNode = node;
        const payload = lazyNode._payload;
        const init = lazyNode._init;
        let resolvedNode;

        {
          resolvedNode = init(payload);
        }

        renderNodeDestructive(request, task, null, resolvedNode);
        return;
      }
    }

    if (isArray(node)) {
      renderChildrenArray(request, task, node);
      return;
    }

    const iteratorFn = getIteratorFn(node);

    if (iteratorFn) {
      const iterator = iteratorFn.call(node);

      if (iterator) {
        // We need to know how many total children are in this set, so that we
        // can allocate enough id slots to acommodate them. So we must exhaust
        // the iterator before we start recursively rendering the children.
        // TODO: This is not great but I think it's inherent to the id
        // generation algorithm.
        let step = iterator.next(); // If there are not entries, we need to push an empty so we start by checking that.

        if (!step.done) {
          const children = [];

          do {
            children.push(step.value);
            step = iterator.next();
          } while (!step.done);

          renderChildrenArray(request, task, children);
          return;
        }

        return;
      }
    } // $FlowFixMe[method-unbinding]

    const childString = Object.prototype.toString.call(node);
    throw new Error(
      'Objects are not valid as a React child (found: ' +
        (childString === '[object Object]'
          ? 'object with keys {' + Object.keys(node).join(', ') + '}'
          : childString) +
        '). ' +
        'If you meant to render a collection of children, use an array ' +
        'instead.'
    );
  }

  if (typeof node === 'string') {
    const segment = task.blockedSegment;
    segment.lastPushedText = pushTextInstance(
      task.blockedSegment.chunks,
      node,
      request.responseState,
      segment.lastPushedText
    );
    return;
  }

  if (typeof node === 'number') {
    const segment = task.blockedSegment;
    segment.lastPushedText = pushTextInstance(
      task.blockedSegment.chunks,
      '' + node,
      request.responseState,
      segment.lastPushedText
    );
    return;
  }
}

function renderChildrenArray(request, task, children) {
  const totalChildren = children.length;

  for (let i = 0; i < totalChildren; i++) {
    const prevTreeContext = task.treeContext;
    task.treeContext = pushTreeContext(prevTreeContext, totalChildren, i);

    try {
      // We need to use the non-destructive form so that we can safely pop back
      // up and render the sibling if something suspends.
      renderNode(request, task, children[i]);
    } finally {
      task.treeContext = prevTreeContext;
    }
  }
}

function spawnNewSuspendedTask(request, task, thenableState, x) {
  // Something suspended, we'll need to create a new segment and resolve it later.
  const segment = task.blockedSegment;
  const insertionIndex = segment.chunks.length;
  const newSegment = createPendingSegment(
    request,
    insertionIndex,
    null,
    segment.formatContext, // Adopt the parent segment's leading text embed
    segment.lastPushedText, // Assume we are text embedded at the trailing edge
    true
  );
  segment.children.push(newSegment); // Reset lastPushedText for current Segment since the new Segment "consumed" it

  segment.lastPushedText = false;
  const newTask = createTask(
    request,
    thenableState,
    task.node,
    task.blockedBoundary,
    newSegment,
    task.abortSet,
    task.legacyContext,
    task.context,
    task.treeContext
  );

  const ping = newTask.ping;
  x.then(ping, ping);
} // This is a non-destructive form of rendering a node. If it suspends it spawns
// a new task and restores the context of this task to what it was before.

function renderNode(request, task, node) {
  // TODO: Store segment.children.length here and reset it in case something
  // suspended partially through writing something.
  // Snapshot the current context in case something throws to interrupt the
  // process.
  const previousFormatContext = task.blockedSegment.formatContext;
  const previousLegacyContext = task.legacyContext;
  const previousContext = task.context;

  try {
    return renderNodeDestructive(request, task, null, node);
  } catch (x) {
    resetHooksState();

    if (typeof x === 'object' && x !== null && typeof x.then === 'function') {
      const thenableState = getThenableStateAfterSuspending();
      spawnNewSuspendedTask(request, task, thenableState, x); // Restore the context. We assume that this will be restored by the inner
      // functions in case nothing throws so we don't use "finally" here.

      task.blockedSegment.formatContext = previousFormatContext;
      task.legacyContext = previousLegacyContext;
      task.context = previousContext; // Restore all active ReactContexts to what they were before.

      switchContext(previousContext);

      return;
    } else {
      // Restore the context. We assume that this will be restored by the inner
      // functions in case nothing throws so we don't use "finally" here.
      task.blockedSegment.formatContext = previousFormatContext;
      task.legacyContext = previousLegacyContext;
      task.context = previousContext; // Restore all active ReactContexts to what they were before.

      switchContext(previousContext);
      // Let's terminate the rest of the tree and don't render any siblings.

      throw x;
    }
  }
}

function erroredTask(request, boundary, segment, error) {
  // Report the error to a global handler.
  const errorDigest = logRecoverableError(request, error);

  if (boundary === null) {
    fatalError(request, error);
  } else {
    boundary.pendingTasks--;

    if (!boundary.forceClientRender) {
      boundary.forceClientRender = true;
      boundary.errorDigest = errorDigest;
      // so we can flush it, if the parent already flushed.

      if (boundary.parentFlushed) {
        // We don't have a preference where in the queue this goes since it's likely
        // to error on the client anyway. However, intentionally client-rendered
        // boundaries should be flushed earlier so that they can start on the client.
        // We reuse the same queue for errors.
        request.clientRenderedBoundaries.push(boundary);
      }
    }
  }

  request.allPendingTasks--;

  if (request.allPendingTasks === 0) {
    const onAllReady = request.onAllReady;
    onAllReady();
  }
}

function abortTaskSoft(task) {
  // This aborts task without aborting the parent boundary that it blocks.
  // It's used for when we didn't need this task to complete the tree.
  // If task was needed, then it should use abortTask instead.
  const request = this;
  const boundary = task.blockedBoundary;
  const segment = task.blockedSegment;
  segment.status = ABORTED;
  finishedTask(request, boundary, segment);
}

function abortTask(task, request, error) {
  // This aborts the task and aborts the parent that it blocks, putting it into
  // client rendered mode.
  const boundary = task.blockedBoundary;
  const segment = task.blockedSegment;
  segment.status = ABORTED;

  if (boundary === null) {
    request.allPendingTasks--; // We didn't complete the root so we have nothing to show. We can close
    // the request;

    if (request.status !== CLOSING && request.status !== CLOSED) {
      logRecoverableError(request, error);
      fatalError(request, error);
    }
  } else {
    boundary.pendingTasks--;

    if (!boundary.forceClientRender) {
      boundary.forceClientRender = true;
      boundary.errorDigest = request.onError(error);

      if (boundary.parentFlushed) {
        request.clientRenderedBoundaries.push(boundary);
      }
    } // If this boundary was still pending then we haven't already cancelled its fallbacks.
    // We'll need to abort the fallbacks, which will also error that parent boundary.

    boundary.fallbackAbortableTasks.forEach((fallbackTask) =>
      abortTask(fallbackTask, request, error)
    );
    boundary.fallbackAbortableTasks.clear();
    request.allPendingTasks--;

    if (request.allPendingTasks === 0) {
      const onAllReady = request.onAllReady;
      onAllReady();
    }
  }
}

function queueCompletedSegment(boundary, segment) {
  if (
    segment.chunks.length === 0 &&
    segment.children.length === 1 &&
    segment.children[0].boundary === null
  ) {
    // This is an empty segment. There's nothing to write, so we can instead transfer the ID
    // to the child. That way any existing references point to the child.
    const childSegment = segment.children[0];
    childSegment.id = segment.id;
    childSegment.parentFlushed = true;

    if (childSegment.status === COMPLETED) {
      queueCompletedSegment(boundary, childSegment);
    }
  } else {
    const completedSegments = boundary.completedSegments;
    completedSegments.push(segment);
  }
}

function finishedTask(request, boundary, segment) {
  if (boundary === null) {
    if (segment.parentFlushed) {
      if (request.completedRootSegment !== null) {
        throw new Error(
          'There can only be one root segment. This is a bug in React.'
        );
      }

      request.completedRootSegment = segment;
    }

    request.pendingRootTasks--;

    if (request.pendingRootTasks === 0) {
      // We have completed the shell so the shell can't error anymore.
      request.onShellError = noop$2;
      const onShellReady = request.onShellReady;
      onShellReady();
    }
  } else {
    boundary.pendingTasks--;

    if (boundary.forceClientRender);
    else if (boundary.pendingTasks === 0) {
      // This must have been the last segment we were waiting on. This boundary is now complete.
      if (segment.parentFlushed) {
        // Our parent segment already flushed, so we need to schedule this segment to be emitted.
        // If it is a segment that was aborted, we'll write other content instead so we don't need
        // to emit it.
        if (segment.status === COMPLETED) {
          queueCompletedSegment(boundary, segment);
        }
      }

      {
        hoistCompletedBoundaryResources(request, boundary);
      }

      if (boundary.parentFlushed) {
        // The segment might be part of a segment that didn't flush yet, but if the boundary's
        // parent flushed, we need to schedule the boundary to be emitted.
        request.completedBoundaries.push(boundary);
      } // We can now cancel any pending task on the fallback since we won't need to show it anymore.
      // This needs to happen after we read the parentFlushed flags because aborting can finish
      // work which can trigger user code, which can start flushing, which can change those flags.

      boundary.fallbackAbortableTasks.forEach(abortTaskSoft, request);
      boundary.fallbackAbortableTasks.clear();
    } else {
      if (segment.parentFlushed) {
        // Our parent already flushed, so we need to schedule this segment to be emitted.
        // If it is a segment that was aborted, we'll write other content instead so we don't need
        // to emit it.
        if (segment.status === COMPLETED) {
          queueCompletedSegment(boundary, segment);
          const completedSegments = boundary.completedSegments;

          if (completedSegments.length === 1) {
            // This is the first time since we last flushed that we completed anything.
            // We can schedule this boundary to emit its partially completed segments early
            // in case the parent has already been flushed.
            if (boundary.parentFlushed) {
              request.partialBoundaries.push(boundary);
            }
          }
        }
      }
    }
  }

  request.allPendingTasks--;

  if (request.allPendingTasks === 0) {
    // This needs to be called at the very end so that we can synchronously write the result
    // in the callback if needed.
    const onAllReady = request.onAllReady;
    onAllReady();
  }
}

function retryTask(request, task) {
  {
    const blockedBoundary = task.blockedBoundary;
    setCurrentlyRenderingBoundaryResourcesTarget(
      request.resources,
      blockedBoundary ? blockedBoundary.resources : null
    );
  }

  const segment = task.blockedSegment;

  if (segment.status !== PENDING) {
    // We completed this by other means before we had a chance to retry it.
    return;
  } // We restore the context to what it was when we suspended.
  // We don't restore it after we leave because it's likely that we'll end up
  // needing a very similar context soon again.

  switchContext(task.context);

  try {
    // We call the destructive form that mutates this task. That way if something
    // suspends again, we can reuse the same task instead of spawning a new one.
    // Reset the task's thenable state before continuing, so that if a later
    // component suspends we can reuse the same task object. If the same
    // component suspends again, the thenable state will be restored.
    const prevThenableState = task.thenableState;
    task.thenableState = null;
    renderNodeDestructive(request, task, prevThenableState, task.node);
    pushSegmentFinale(
      segment.chunks,
      request.responseState,
      segment.lastPushedText,
      segment.textEmbedded
    );
    task.abortSet.delete(task);
    segment.status = COMPLETED;
    finishedTask(request, task.blockedBoundary, segment);
  } catch (x) {
    resetHooksState();

    if (typeof x === 'object' && x !== null && typeof x.then === 'function') {
      // Something suspended again, let's pick it back up later.
      const ping = task.ping;
      x.then(ping, ping);
      task.thenableState = getThenableStateAfterSuspending();
    } else {
      task.abortSet.delete(task);
      segment.status = ERRORED;
      erroredTask(request, task.blockedBoundary, segment, x);
    }
  } finally {
    {
      setCurrentlyRenderingBoundaryResourcesTarget(request.resources, null);
    }
  }
}

function performWork(request) {
  if (request.status === CLOSED) {
    return;
  }

  const prevContext = getActiveContext();
  const prevDispatcher = ReactCurrentDispatcher$1.current;
  ReactCurrentDispatcher$1.current = HooksDispatcher;
  let prevCacheDispatcher;

  {
    prevCacheDispatcher = ReactCurrentCache.current;
    ReactCurrentCache.current = DefaultCacheDispatcher;
  }

  const previousHostDispatcher = prepareToRender(request.resources);

  const prevResponseState = currentResponseState;
  setCurrentResponseState(request.responseState);

  try {
    const pingedTasks = request.pingedTasks;
    let i;

    for (i = 0; i < pingedTasks.length; i++) {
      const task = pingedTasks[i];
      retryTask(request, task);
    }

    pingedTasks.splice(0, i);

    if (request.destination !== null) {
      flushCompletedQueues(request, request.destination);
    }
  } catch (error) {
    logRecoverableError(request, error);
    fatalError(request, error);
  } finally {
    setCurrentResponseState(prevResponseState);
    ReactCurrentDispatcher$1.current = prevDispatcher;

    {
      ReactCurrentCache.current = prevCacheDispatcher;
    }

    cleanupAfterRender(previousHostDispatcher);

    if (prevDispatcher === HooksDispatcher) {
      // This means that we were in a reentrant work loop. This could happen
      // in a renderer that supports synchronous work like renderToString,
      // when it's called from within another renderer.
      // Normally we don't bother switching the contexts to their root/default
      // values when leaving because we'll likely need the same or similar
      // context again. However, when we're inside a synchronous loop like this
      // we'll to restore the context to what it was before returning.
      switchContext(prevContext);
    }
  }
}

function flushSubtree(request, destination, segment) {
  segment.parentFlushed = true;

  switch (segment.status) {
    case PENDING: {
      // We're emitting a placeholder for this segment to be filled in later.
      // Therefore we'll need to assign it an ID - to refer to it by.
      const segmentID = (segment.id = request.nextSegmentId++); // When this segment finally completes it won't be embedded in text since it will flush separately

      segment.lastPushedText = false;
      segment.textEmbedded = false;
      return writePlaceholder(destination, request.responseState, segmentID);
    }

    case COMPLETED: {
      segment.status = FLUSHED;
      let r = true;
      const chunks = segment.chunks;
      let chunkIdx = 0;
      const children = segment.children;

      for (let childIdx = 0; childIdx < children.length; childIdx++) {
        const nextChild = children[childIdx]; // Write all the chunks up until the next child.

        for (; chunkIdx < nextChild.index; chunkIdx++) {
          writeChunk(destination, chunks[chunkIdx]);
        }

        r = flushSegment(request, destination, nextChild);
      } // Finally just write all the remaining chunks

      for (; chunkIdx < chunks.length - 1; chunkIdx++) {
        writeChunk(destination, chunks[chunkIdx]);
      }

      if (chunkIdx < chunks.length) {
        r = writeChunkAndReturn(destination, chunks[chunkIdx]);
      }

      return r;
    }

    default: {
      throw new Error(
        'Aborted, errored or already flushed boundaries should not be flushed again. This is a bug in React.'
      );
    }
  }
}

function flushSegment(request, destination, segment) {
  const boundary = segment.boundary;

  if (boundary === null) {
    // Not a suspense boundary.
    return flushSubtree(request, destination, segment);
  }

  boundary.parentFlushed = true; // This segment is a Suspense boundary. We need to decide whether to
  // emit the content or the fallback now.

  if (boundary.forceClientRender) {
    // Emit a client rendered suspense boundary wrapper.
    // We never queue the inner boundary so we'll never emit its content or partial segments.
    writeStartClientRenderedSuspenseBoundary(
      destination,
      request.responseState,
      boundary.errorDigest,
      boundary.errorMessage,
      boundary.errorComponentStack
    ); // Flush the fallback.

    flushSubtree(request, destination, segment);
    return writeEndClientRenderedSuspenseBoundary(
      destination,
      request.responseState
    );
  } else if (boundary.pendingTasks > 0) {
    // This boundary is still loading. Emit a pending suspense boundary wrapper.
    // Assign an ID to refer to the future content by.
    boundary.rootSegmentID = request.nextSegmentId++;

    if (boundary.completedSegments.length > 0) {
      // If this is at least partially complete, we can queue it to be partially emitted early.
      request.partialBoundaries.push(boundary);
    } /// This is the first time we should have referenced this ID.

    const id = (boundary.id = assignSuspenseBoundaryID(request.responseState));
    writeStartPendingSuspenseBoundary(destination, request.responseState, id); // Flush the fallback.

    flushSubtree(request, destination, segment);
    return writeEndPendingSuspenseBoundary(destination, request.responseState);
  } else if (boundary.byteSize > request.progressiveChunkSize) {
    // This boundary is large and will be emitted separately so that we can progressively show
    // other content. We add it to the queue during the flush because we have to ensure that
    // the parent flushes first so that there's something to inject it into.
    // We also have to make sure that it's emitted into the queue in a deterministic slot.
    // I.e. we can't insert it here when it completes.
    // Assign an ID to refer to the future content by.
    boundary.rootSegmentID = request.nextSegmentId++;
    request.completedBoundaries.push(boundary); // Emit a pending rendered suspense boundary wrapper.

    writeStartPendingSuspenseBoundary(
      destination,
      request.responseState,
      boundary.id
    ); // Flush the fallback.

    flushSubtree(request, destination, segment);
    return writeEndPendingSuspenseBoundary(destination, request.responseState);
  } else {
    {
      hoistResources(request.resources, boundary.resources);
    } // We can inline this boundary's content as a complete boundary.

    writeStartCompletedSuspenseBoundary(destination, request.responseState);
    const completedSegments = boundary.completedSegments;

    if (completedSegments.length !== 1) {
      throw new Error(
        'A previously unvisited boundary must have exactly one root segment. This is a bug in React.'
      );
    }

    const contentSegment = completedSegments[0];
    flushSegment(request, destination, contentSegment);
    return writeEndCompletedSuspenseBoundary(
      destination,
      request.responseState
    );
  }
}

function flushInitialResources(destination, resources, responseState) {
  writeInitialResources(destination, resources, responseState);
}

function flushImmediateResources(destination, request) {
  writeImmediateResources(
    destination,
    request.resources,
    request.responseState
  );
}

function flushClientRenderedBoundary(request, destination, boundary) {
  return writeClientRenderBoundaryInstruction(
    destination,
    request.responseState,
    boundary.id,
    boundary.errorDigest,
    boundary.errorMessage,
    boundary.errorComponentStack
  );
}

function flushSegmentContainer(request, destination, segment) {
  writeStartSegment(
    destination,
    request.responseState,
    segment.formatContext,
    segment.id
  );
  flushSegment(request, destination, segment);
  return writeEndSegment(destination, segment.formatContext);
}

function flushCompletedBoundary(request, destination, boundary) {
  {
    setCurrentlyRenderingBoundaryResourcesTarget(
      request.resources,
      boundary.resources
    );
  }

  const completedSegments = boundary.completedSegments;
  let i = 0;

  for (; i < completedSegments.length; i++) {
    const segment = completedSegments[i];
    flushPartiallyCompletedSegment(request, destination, boundary, segment);
  }

  completedSegments.length = 0;
  return writeCompletedBoundaryInstruction(
    destination,
    request.responseState,
    boundary.id,
    boundary.rootSegmentID,
    boundary.resources
  );
}

function flushPartialBoundary(request, destination, boundary) {
  {
    setCurrentlyRenderingBoundaryResourcesTarget(
      request.resources,
      boundary.resources
    );
  }

  const completedSegments = boundary.completedSegments;
  let i = 0;

  for (; i < completedSegments.length; i++) {
    const segment = completedSegments[i];

    if (
      !flushPartiallyCompletedSegment(request, destination, boundary, segment)
    ) {
      i++;
      completedSegments.splice(0, i); // Only write as much as the buffer wants. Something higher priority
      // might want to write later.

      return false;
    }
  }

  completedSegments.splice(0, i);
  return true;
}

function flushPartiallyCompletedSegment(
  request,
  destination,
  boundary,
  segment
) {
  if (segment.status === FLUSHED) {
    // We've already flushed this inline.
    return true;
  }

  const segmentID = segment.id;

  if (segmentID === -1) {
    // This segment wasn't previously referred to. This happens at the root of
    // a boundary. We make kind of a leap here and assume this is the root.
    const rootSegmentID = (segment.id = boundary.rootSegmentID);

    if (rootSegmentID === -1) {
      throw new Error(
        'A root segment ID must have been assigned by now. This is a bug in React.'
      );
    }

    return flushSegmentContainer(request, destination, segment);
  } else {
    flushSegmentContainer(request, destination, segment);
    return writeCompletedSegmentInstruction(
      destination,
      request.responseState,
      segmentID
    );
  }
}

function flushCompletedQueues(request, destination) {
  try {
    // The structure of this is to go through each queue one by one and write
    // until the sink tells us to stop. When we should stop, we still finish writing
    // that item fully and then yield. At that point we remove the already completed
    // items up until the point we completed them.
    let i;
    const completedRootSegment = request.completedRootSegment;

    if (completedRootSegment !== null) {
      if (request.pendingRootTasks === 0) {
        if (enableFloat) {
          const preamble = request.preamble;

          for (i = 0; i < preamble.length; i++) {
            // we expect the preamble to be tiny and will ignore backpressure
            writeChunk(destination, preamble[i]);
          }

          flushInitialResources(
            destination,
            request.resources,
            request.responseState
          );
        }

        flushSegment(request, destination, completedRootSegment);
        request.completedRootSegment = null;
        writeCompletedRoot(destination, request.responseState);
      } else {
        // We haven't flushed the root yet so we don't need to check any other branches further down
        return;
      }
    } else if (enableFloat) {
      flushImmediateResources(destination, request);
    } // We emit client rendering instructions for already emitted boundaries first.
    // This is so that we can signal to the client to start client rendering them as
    // soon as possible.

    const clientRenderedBoundaries = request.clientRenderedBoundaries;

    for (i = 0; i < clientRenderedBoundaries.length; i++) {
      const boundary = clientRenderedBoundaries[i];

      if (!flushClientRenderedBoundary(request, destination, boundary)) {
        request.destination = null;
        i++;
        clientRenderedBoundaries.splice(0, i);
        return;
      }
    }

    clientRenderedBoundaries.splice(0, i); // Next we emit any complete boundaries. It's better to favor boundaries
    // that are completely done since we can actually show them, than it is to emit
    // any individual segments from a partially complete boundary.

    const completedBoundaries = request.completedBoundaries;

    for (i = 0; i < completedBoundaries.length; i++) {
      const boundary = completedBoundaries[i];

      if (!flushCompletedBoundary(request, destination, boundary)) {
        request.destination = null;
        i++;
        completedBoundaries.splice(0, i);
        return;
      }
    }

    completedBoundaries.splice(0, i); // Allow anything written so far to flush to the underlying sink before
    // we continue with lower priorities.

    completeWriting(destination);
    beginWriting(destination); // TODO: Here we'll emit data used by hydration.
    // Next we emit any segments of any boundaries that are partially complete
    // but not deeply complete.

    const partialBoundaries = request.partialBoundaries;

    for (i = 0; i < partialBoundaries.length; i++) {
      const boundary = partialBoundaries[i];

      if (!flushPartialBoundary(request, destination, boundary)) {
        request.destination = null;
        i++;
        partialBoundaries.splice(0, i);
        return;
      }
    }

    partialBoundaries.splice(0, i); // Next we check the completed boundaries again. This may have had
    // boundaries added to it in case they were too larged to be inlined.
    // New ones might be added in this loop.

    const largeBoundaries = request.completedBoundaries;

    for (i = 0; i < largeBoundaries.length; i++) {
      const boundary = largeBoundaries[i];

      if (!flushCompletedBoundary(request, destination, boundary)) {
        request.destination = null;
        i++;
        largeBoundaries.splice(0, i);
        return;
      }
    }

    largeBoundaries.splice(0, i);
  } finally {
    if (
      request.allPendingTasks === 0 &&
      request.pingedTasks.length === 0 &&
      request.clientRenderedBoundaries.length === 0 &&
      request.completedBoundaries.length === 0 // We don't need to check any partially completed segments because
      // either they have pending task or they're complete.
    ) {
      {
        const postamble = request.postamble;

        for (let i = 0; i < postamble.length; i++) {
          writeChunk(destination, postamble[i]);
        }
      }

      close(destination);
    }
  }
}

function startWork(request) {
  scheduleWork(() => performWork(request));
}
function startFlowing(request, destination) {
  if (request.status === CLOSING) {
    request.status = CLOSED;
    closeWithError(destination, request.fatalError);
    return;
  }

  if (request.status === CLOSED) {
    return;
  }

  if (request.destination !== null) {
    // We're already flowing.
    return;
  }

  request.destination = destination;

  try {
    flushCompletedQueues(request, destination);
  } catch (error) {
    logRecoverableError(request, error);
    fatalError(request, error);
  }
} // This is called to early terminate a request. It puts all pending boundaries in client rendered state.

function abort(request, reason) {
  try {
    const abortableTasks = request.abortableTasks;

    if (abortableTasks.size > 0) {
      const error =
        reason === undefined
          ? new Error('The render was aborted by the server without a reason.')
          : reason;
      abortableTasks.forEach((task) => abortTask(task, request, error));
      abortableTasks.clear();
    }

    if (request.destination !== null) {
      flushCompletedQueues(request, request.destination);
    }
  } catch (error) {
    logRecoverableError(request, error);
    fatalError(request, error);
  }
}

function renderToReadableStream(children, options) {
  return new Promise((resolve, reject) => {
    let onFatalError;
    let onAllReady;
    const allReady = new Promise((res, rej) => {
      onAllReady = res;
      onFatalError = rej;
    });

    function onShellReady() {
      const stream = new ReadableStream(
        {
          type: 'direct',
          pull: (controller) => {
            // $FlowIgnore
            startFlowing(request, controller);
          },
          cancel: (reason) => {
            abort(request);
          },
        }, // $FlowFixMe size() methods are not allowed on byte streams.
        {
          highWaterMark: 2048,
        }
      ); // TODO: Move to sub-classing ReadableStream.

      stream.allReady = allReady;
      resolve(stream);
    }

    function onShellError(error) {
      // If the shell errors the caller of `renderToReadableStream` won't have access to `allReady`.
      // However, `allReady` will be rejected by `onFatalError` as well.
      // So we need to catch the duplicate, uncatchable fatal error in `allReady` to prevent a `UnhandledPromiseRejection`.
      allReady.catch(() => {});
      reject(error);
    }

    const request = createRequest(
      children,
      createResponseState(
        options ? options.identifierPrefix : undefined,
        options ? options.nonce : undefined,
        options ? options.bootstrapScriptContent : undefined,
        options ? options.bootstrapScripts : undefined,
        options ? options.bootstrapModules : undefined,
        options ? options.unstable_externalRuntimeSrc : undefined
      ),
      createRootFormatContext(options ? options.namespaceURI : undefined),
      options ? options.progressiveChunkSize : undefined,
      options ? options.onError : undefined,
      onAllReady,
      onShellReady,
      onShellError,
      onFatalError
    );

    if (options && options.signal) {
      const signal = options.signal;

      if (signal.aborted) {
        abort(request, signal.reason);
      } else {
        const listener = () => {
          abort(request, signal.reason);
          signal.removeEventListener('abort', listener);
        };

        signal.addEventListener('abort', listener);
      }
    }

    startWork(request);
  });
}

export {renderToReadableStream, ReactVersion as version};
