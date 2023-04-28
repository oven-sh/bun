import { RUN_UNCHECKED_TESTS, itBundled, testForFile } from "../expectBundled";
var { describe, test, expect } = testForFile(import.meta.path);

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_loader_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/loader

describe("bundler", () => {
  itBundled("loader/LoaderJSONCommonJSAndES6", {
    files: {
      "/entry.js": /* js */ `
        const x_json = require('./x.json')
        import y_json from './y.json'
        import {small, if as fi} from './z.json'
        console.log(JSON.stringify(x_json), JSON.stringify(y_json), small, fi)
      `,
      "/x.json": `{"x": true}`,
      "/y.json": `{"y1": true, "y2": false}`,
      "/z.json": /* json */ `
        {
        "big": "this is a big long line of text that should be discarded",
        "small": "some small text",
        "if": "test keyword imports"
      }
      `,
    },
    run: {
      stdout: '{"x":true} {} some small text test keyword imports',
    },
  });

  itBundled("loader/LoaderJSONSharedWithMultipleEntriesESBuildIssue413", {
    files: {
      "/a.js": /* js */ `
        import data from './data.json'
        import {test} from './data.json';
        import * as NSData from './data.json';

        console.log('a:', JSON.stringify(data), data.test, test === data.test, NSData.test === data.test, NSData.default === data, NSData.default.test === data.test, JSON.stringify(NSData))
      `,
      "/b.js": /* js */ `
        import data from './data.json'
        import {test} from './data.json';
        import * as NSData from './data.json';
        console.log('b:', JSON.stringify(data), data.test, test === data.test, NSData.test === data.test, NSData.default === data, NSData.default.test === data.test, JSON.stringify(NSData))
      `,
      "/data.json": `{"test": 123}`,
    },
    entryPoints: ["/a.js", "/b.js"],
    format: "esm",
    run: [
      {
        file: "/out/a.js",
        stdout: 'a: {"test":123} 123 true true true true {"test":123,"default":{"test":123}}',
      },
      {
        file: "/out/b.js",
        stdout: 'b: {"test":123} 123 true true true true {"test":123,"default":{"test":123}}',
      },
    ],
  });
  itBundled("loader/LoaderFile", {
    files: {
      "/entry.js": `console.log(require('./test.svg'))`,
      "/test.svg": `<svg></svg>`,
    },
    outdir: "/out",
    loader: {
      // ".svg": "file",
    },
    run: {
      stdout: /\.\/test-.*\.svg/,
    },
  });
  itBundled("loader/LoaderFileMultipleNoCollision", {
    files: {
      "/entry.js": /* js */ `
        console.log(require('./a/test.svg'))
        console.log(require('./b/test.svg'))
      `,
      "/a/test.svg": `<svg></svg>`,
      "/b/test.svg": `<svg></svg>`,
    },
    outdir: "/out",
    assetNames: "assets/[name].[ext]",
    run: {
      stdout: /\.\/test-.*\.svg \.\/test-.*\.svg/,
    },
  });
  itBundled("loader/JSXSyntaxInJSWithJSXLoader", {
    // GENERATED
    files: {
      "/entry.js": `console.log(<div/>)`,
    },
  });
  itBundled("loader/JSXPreserveCapitalLetter", {
    // GENERATED
    files: {
      "/entry.jsx": /* jsx */ `
        import { mustStartWithUpperCaseLetter as Test } from './foo'
        console.log(<Test/>)
      `,
      "/foo.js": `export class mustStartWithUpperCaseLetter {}`,
    },
  });
  itBundled("loader/JSXPreserveCapitalLetterMinify", {
    files: {
      "/entry.jsx": /* jsx */ `
        import { mustStartWithUpperCaseLetter as XYYYY } from './foo'
        // This should be named "Y" due to frequency analysis
        console.log(<XYYYY YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY />)
      `,
      "/foo.js": `export class mustStartWithUpperCaseLetter {}`,
    },
    external: ["react"],
    minifyIdentifiers: true,
  });
  itBundled("loader/JSXPreserveCapitalLetterMinifyNested", {
    files: {
      "/entry.jsx": /* jsx */ `
        x = () => {
          class RENAME_ME {} // This should be named "Y" due to frequency analysis
          capture(RENAME_ME)
          return <RENAME_ME YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY />
        }
      `,
    },
    external: ["react"],
    minifyIdentifiers: true,
  });
  itBundled("loader/RequireCustomExtensionString", {
    // GENERATED
    files: {
      "/entry.js": `console.log(require('./test.custom'))`,
      "/test.custom": `#include <stdio.h>`,
    },
  });
  itBundled("loader/RequireCustomExtensionBase64", {
    // GENERATED
    files: {
      "/entry.js": `console.log(require('./test.custom'))`,
      "/test.custom": `a\x00b\x80c\xFFd`,
    },
  });
  itBundled("loader/RequireCustomExtensionDataURL", {
    // GENERATED
    files: {
      "/entry.js": `console.log(require('./test.custom'))`,
      "/test.custom": `a\x00b\x80c\xFFd`,
    },
  });
  itBundled("loader/RequireCustomExtensionPreferLongest", {
    // GENERATED
    files: {
      "/entry.js": `console.log(require('./test.txt'), require('./test.base64.txt'))`,
      "/test.txt": `test.txt`,
      "/test.base64.txt": `test.base64.txt`,
    },
  });
  itBundled("loader/AutoDetectMimeTypeFromExtension", {
    // GENERATED
    files: {
      "/entry.js": `console.log(require('./test.svg'))`,
      "/test.svg": `a\x00b\x80c\xFFd`,
    },
  });
  itBundled("loader/LoaderJSONInvalidIdentifierES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import * as ns from './test.json'
        import * as ns2 from './test2.json'
        console.log(ns['invalid-identifier'], ns2)
      `,
      "/test.json": `{"invalid-identifier": true}`,
      "/test2.json": `{"invalid-identifier": true}`,
    },
  });
  itBundled("loader/LoaderJSONMissingES6", {
    // GENERATED
    files: {
      "/entry.js": `import {missing} from './test.json'`,
      "/test.json": `{"present": true}`,
    },
    /* TODO FIX expectedCompileLog: `entry.js: ERROR: No matching export in "test.json" for import "missing"
  `, */
  });
  itBundled("loader/LoaderTextCommonJSAndES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        const x_txt = require('./x.txt')
        import y_txt from './y.txt'
        console.log(x_txt, y_txt)
      `,
      "/x.txt": `x`,
      "/y.txt": `y`,
    },
  });
  itBundled("loader/LoaderBase64CommonJSAndES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        const x_b64 = require('./x.b64')
        import y_b64 from './y.b64'
        console.log(x_b64, y_b64)
      `,
      "/x.b64": `x`,
      "/y.b64": `y`,
    },
  });
  itBundled("loader/LoaderDataURLCommonJSAndES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        const x_url = require('./x.txt')
        import y_url from './y.txt'
        console.log(x_url, y_url)
      `,
      "/x.txt": `x`,
      "/y.txt": `y`,
    },
  });
  itBundled("loader/LoaderFileCommonJSAndES6", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        const x_url = require('./x.txt')
        import y_url from './y.txt'
        console.log(x_url, y_url)
      `,
      "/x.txt": `x`,
      "/y.txt": `y`,
    },
  });
  itBundled("loader/LoaderFileRelativePathJS", {
    // GENERATED
    files: {
      "/src/entries/entry.js": /* js */ `
        import x from '../images/image.png'
        console.log(x)
      `,
      "/src/images/image.png": `x`,
    },
    outbase: "/src",
  });
  itBundled("loader/LoaderFileRelativePathCSS", {
    // GENERATED
    files: {
      "/src/entries/entry.css": /* css */ `
        div {
          background: url(../images/image.png);
        }
      `,
      "/src/images/image.png": `x`,
    },
    outbase: "/src",
  });
  itBundled("loader/LoaderFileRelativePathAssetNamesJS", {
    // GENERATED
    files: {
      "/src/entries/entry.js": /* js */ `
        import x from '../images/image.png'
        console.log(x)
      `,
      "/src/images/image.png": `x`,
    },
    outbase: "/src",
    assetNames: "[dir]/[name]-[hash]",
  });
  itBundled("loader/LoaderFileExtPathAssetNamesJS", {
    // GENERATED
    files: {
      "/src/entries/entry.js": /* js */ `
        import x from '../images/image.png'
        import y from '../uploads/file.txt'
        console.log(x, y)
      `,
      "/src/images/image.png": `x`,
      "/src/uploads/file.txt": `y`,
    },
    outbase: "/src",
    assetNames: "[ext]/[name]-[hash]",
  });
  itBundled("loader/LoaderFileRelativePathAssetNamesCSS", {
    // GENERATED
    files: {
      "/src/entries/entry.css": /* css */ `
        div {
          background: url(../images/image.png);
        }
      `,
      "/src/images/image.png": `x`,
    },
    outbase: "/src",
    assetNames: "[dir]/[name]-[hash]",
  });
  itBundled("loader/LoaderFilePublicPathJS", {
    // GENERATED
    files: {
      "/src/entries/entry.js": /* js */ `
        import x from '../images/image.png'
        console.log(x)
      `,
      "/src/images/image.png": `x`,
    },
    outbase: "/src",
    publicPath: "https://example.com",
  });
  itBundled("loader/LoaderFilePublicPathCSS", {
    // GENERATED
    files: {
      "/src/entries/entry.css": /* css */ `
        div {
          background: url(../images/image.png);
        }
      `,
      "/src/images/image.png": `x`,
    },
    outbase: "/src",
    publicPath: "https://example.com",
  });
  itBundled("loader/LoaderFilePublicPathAssetNamesJS", {
    // GENERATED
    files: {
      "/src/entries/entry.js": /* js */ `
        import x from '../images/image.png'
        console.log(x)
      `,
      "/src/images/image.png": `x`,
    },
    outbase: "/src",
    publicPath: "https://example.com",
    assetNames: "[dir]/[name]-[hash]",
  });
  itBundled("loader/LoaderFilePublicPathAssetNamesCSS", {
    // GENERATED
    files: {
      "/src/entries/entry.css": /* css */ `
        div {
          background: url(../images/image.png);
        }
      `,
      "/src/images/image.png": `x`,
    },
    outbase: "/src",
    publicPath: "https://example.com",
    assetNames: "[dir]/[name]-[hash]",
  });
  itBundled("loader/LoaderFileOneSourceTwoDifferentOutputPathsJS", {
    // GENERATED
    files: {
      "/src/entries/entry.js": `import '../shared/common.js'`,
      "/src/entries/other/entry.js": `import '../../shared/common.js'`,
      "/src/shared/common.js": /* js */ `
        import x from './common.png'
        console.log(x)
      `,
      "/src/shared/common.png": `x`,
    },
    entryPoints: ["/src/entries/entry.js", "/src/entries/other/entry.js"],
    outbase: "/src",
  });
  itBundled("loader/LoaderFileOneSourceTwoDifferentOutputPathsCSS", {
    // GENERATED
    files: {
      "/src/entries/entry.css": `@import "../shared/common.css";`,
      "/src/entries/other/entry.css": `@import "../../shared/common.css";`,
      "/src/shared/common.css": /* css */ `
        div {
          background: url(common.png);
        }
      `,
      "/src/shared/common.png": `x`,
    },
    entryPoints: ["/src/entries/entry.css", "/src/entries/other/entry.css"],
    outbase: "/src",
  });
  itBundled("loader/LoaderJSONNoBundle", {
    // GENERATED
    files: {
      "/test.json": `{"test": 123, "invalid-identifier": true}`,
    },
    mode: "transform",
  });
  itBundled("loader/LoaderJSONNoBundleES6", {
    // GENERATED
    files: {
      "/test.json": `{"test": 123, "invalid-identifier": true}`,
    },
    format: "esm",
    unsupportedJSFeatures: "ArbitraryModuleNamespaceNames",
    mode: "convertformat",
  });
  itBundled("loader/LoaderJSONNoBundleES6ArbitraryModuleNamespaceNames", {
    // GENERATED
    files: {
      "/test.json": `{"test": 123, "invalid-identifier": true}`,
    },
    format: "esm",
    mode: "convertformat",
  });
  itBundled("loader/LoaderJSONNoBundleCommonJS", {
    // GENERATED
    files: {
      "/test.json": `{"test": 123, "invalid-identifier": true}`,
    },
    format: "cjs",
    mode: "convertformat",
  });
  itBundled("loader/LoaderJSONNoBundleIIFE", {
    // GENERATED
    files: {
      "/test.json": `{"test": 123, "invalid-identifier": true}`,
    },
    format: "iife",
    mode: "convertformat",
  });
  itBundled("loader/LoaderFileWithQueryParameter", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        // Each of these should have a separate identity (i.e. end up in the output file twice)
        import foo from './file.txt?foo'
        import bar from './file.txt?bar'
        console.log(foo, bar)
      `,
      "/file.txt": `This is some text`,
    },
  });
  itBundled("loader/LoaderFromExtensionWithQueryParameter", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import foo from './file.abc?query.xyz'
        console.log(foo)
      `,
      "/file.abc": `This should not be base64 encoded`,
    },
  });
  itBundled("loader/LoaderDataURLTextCSS", {
    // GENERATED
    files: {
      "/entry.css": /* css */ `
        @import "data:text/css,body{color:%72%65%64}";
        @import "data:text/css;base64,Ym9keXtiYWNrZ3JvdW5kOmJsdWV9";
        @import "data:text/css;charset=UTF-8,body{color:%72%65%64}";
        @import "data:text/css;charset=UTF-8;base64,Ym9keXtiYWNrZ3JvdW5kOmJsdWV9";
      `,
    },
  });
  itBundled("loader/LoaderDataURLTextCSSCannotImport", {
    // GENERATED
    files: {
      "/entry.css": `@import "data:text/css,@import './other.css';";`,
      "/other.css": `div { should-not-be-imported: true }`,
    },
    /* TODO FIX expectedScanLog: `<data:text/css,@import './other.css';>: ERROR: Could not resolve "./other.css"
  `, */
  });
  itBundled("loader/LoaderDataURLTextJavaScript", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import "data:text/javascript,console.log('%31%32%33')";
        import "data:text/javascript;base64,Y29uc29sZS5sb2coMjM0KQ==";
        import "data:text/javascript;charset=UTF-8,console.log(%31%32%33)";
        import "data:text/javascript;charset=UTF-8;base64,Y29uc29sZS5sb2coMjM0KQ==";
      `,
    },
  });
  itBundled("loader/LoaderDataURLTextJavaScriptCannotImport", {
    // GENERATED
    files: {
      "/entry.js": `import "data:text/javascript,import './other.js'"`,
      "/other.js": `shouldNotBeImported = true`,
    },
    /* TODO FIX expectedScanLog: `<data:text/javascript,import './other.js'>: ERROR: Could not resolve "./other.js"
  `, */
  });
  itBundled("loader/LoaderDataURLTextJavaScriptPlusCharacter", {
    // GENERATED
    files: {
      "/entry.js": `import "data:text/javascript,console.log(1+2)";`,
    },
  });
  itBundled("loader/LoaderDataURLApplicationJSON", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import a from 'data:application/json,"%31%32%33"';
        import b from 'data:application/json;base64,eyJ3b3JrcyI6dHJ1ZX0=';
        import c from 'data:application/json;charset=UTF-8,%31%32%33';
        import d from 'data:application/json;charset=UTF-8;base64,eyJ3b3JrcyI6dHJ1ZX0=';
        console.log([
          a, b, c, d,
        ])
      `,
    },
  });
  itBundled("loader/LoaderDataURLUnknownMIME", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import a from 'data:some/thing;what,someData%31%32%33';
        import b from 'data:other/thing;stuff;base64,c29tZURhdGEyMzQ=';
        console.log(a, b)
      `,
    },
  });
  itBundled("loader/LoaderDataURLExtensionBasedMIME", {
    // GENERATED
    files: {
      "/entry.foo": /* foo */ `
        export { default as css }   from "./example.css"
        export { default as eot }   from "./example.eot"
        export { default as gif }   from "./example.gif"
        export { default as htm }   from "./example.htm"
        export { default as html }  from "./example.html"
        export { default as jpeg }  from "./example.jpeg"
        export { default as jpg }   from "./example.jpg"
        export { default as js }    from "./example.js"
        export { default as json }  from "./example.json"
        export { default as mjs }   from "./example.mjs"
        export { default as otf }   from "./example.otf"
        export { default as pdf }   from "./example.pdf"
        export { default as png }   from "./example.png"
        export { default as sfnt }  from "./example.sfnt"
        export { default as svg }   from "./example.svg"
        export { default as ttf }   from "./example.ttf"
        export { default as wasm }  from "./example.wasm"
        export { default as webp }  from "./example.webp"
        export { default as woff }  from "./example.woff"
        export { default as woff2 } from "./example.woff2"
        export { default as xml }   from "./example.xml"
      `,
      "/example.css": `css`,
      "/example.eot": `eot`,
      "/example.gif": `gif`,
      "/example.htm": `htm`,
      "/example.html": `html`,
      "/example.jpeg": `jpeg`,
      "/example.jpg": `jpg`,
      "/example.js": `js`,
      "/example.json": `json`,
      "/example.mjs": `mjs`,
      "/example.otf": `otf`,
      "/example.pdf": `pdf`,
      "/example.png": `png`,
      "/example.sfnt": `sfnt`,
      "/example.svg": `svg`,
      "/example.ttf": `ttf`,
      "/example.wasm": `wasm`,
      "/example.webp": `webp`,
      "/example.woff": `woff`,
      "/example.woff2": `woff2`,
      "/example.xml": `xml`,
    },
  });
  itBundled("loader/LoaderDataURLBase64VsPercentEncoding", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import a from './shouldUsePercent_1.txt'
        import b from './shouldUsePercent_2.txt'
        import c from './shouldUseBase64_1.txt'
        import d from './shouldUseBase64_2.txt'
        console.log(
          a,
          b,
          c,
          d,
        )
      `,
      "/shouldUsePercent_1.txt": `\n\n\n`,
      "/shouldUsePercent_2.txt": `\n\n\n\n`,
      "/shouldUseBase64_1.txt": `\n\n\n\n\n`,
      "/shouldUseBase64_2.txt": `\n\n\n\n\n\n`,
    },
  });
  itBundled("loader/LoaderDataURLBase64InvalidUTF8", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import a from './binary.txt'
        console.log(a)
      `,
      "/binary.txt": `\xFF`,
    },
  });
  itBundled("loader/LoaderDataURLEscapePercents", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import a from './percents.txt'
        console.log(a)
      `,
      "/percents.txt": /* txt */ `
        %, %3, %33, %333
  %, %e, %ee, %eee
  %, %E, %EE, %EEE
      `,
    },
  });
  itBundled("loader/LoaderCopyWithBundleFromJS", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import x from "../assets/some.file"
        console.log(x)
      `,
      "/Users/user/project/assets/some.file": `stuff`,
    },
    outbase: "/Users/user/project",
  });
  itBundled("loader/LoaderCopyWithBundleFromCSS", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.css": /* css */ `
        body {
          background: url(../assets/some.file);
        }
      `,
      "/Users/user/project/assets/some.file": `stuff`,
    },
    outbase: "/Users/user/project",
  });
  itBundled("loader/LoaderCopyWithBundleEntryPoint", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import x from "../assets/some.file"
        console.log(x)
      `,
      "/Users/user/project/src/entry.css": /* css */ `
        body {
          background: url(../assets/some.file);
        }
      `,
      "/Users/user/project/assets/some.file": `stuff`,
    },
    entryPoints: [
      "/Users/user/project/src/entry.js",
      "/Users/user/project/src/entry.css",
      "/Users/user/project/assets/some.file",
    ],
    outbase: "/Users/user/project",
  });
  itBundled("loader/LoaderCopyWithTransform", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `console.log('entry')`,
      "/Users/user/project/assets/some.file": `stuff`,
    },
    entryPoints: ["/Users/user/project/src/entry.js", "/Users/user/project/assets/some.file"],
    outbase: "/Users/user/project",
    mode: "passthrough",
  });
  itBundled("loader/LoaderCopyWithFormat", {
    // GENERATED
    files: {
      "/Users/user/project/src/entry.js": `console.log('entry')`,
      "/Users/user/project/assets/some.file": `stuff`,
    },
    entryPoints: ["/Users/user/project/src/entry.js", "/Users/user/project/assets/some.file"],
    format: "iife",
    outbase: "/Users/user/project",
    mode: "convertformat",
  });
  itBundled("loader/JSXAutomaticNoNameCollision", {
    // GENERATED
    files: {
      "/entry.jsx": /* jsx */ `
        import { Link } from "@remix-run/react"
        const x = <Link {...y} key={z} />
      `,
    },
    format: "cjs",
    mode: "convertformat",
  });
  itBundled("loader/AssertTypeJSONWrongLoader", {
    // GENERATED
    files: {
      "/entry.js": `import foo from './foo.json' assert { type: 'json' }`,
      "/foo.json": `{}`,
    },
    /* TODO FIX expectedScanLog: `entry.js: ERROR: The file "foo.json" was loaded with the "js" loader
  entry.js: NOTE: This import assertion requires the loader to be "json" instead:
  NOTE: You need to either reconfigure esbuild to ensure that the loader for this file is "json" or you need to remove this import assertion.
  `, */
  });
  itBundled("loader/EmptyLoaderJS", {
    // GENERATED
    files: {
      "/entry.js": /* js */ `
        import './a.empty'
        import * as ns from './b.empty'
        import def from './c.empty'
        import { named } from './d.empty'
        console.log(ns, def, named)
      `,
      "/a.empty": `throw 'FAIL'`,
      "/b.empty": `throw 'FAIL'`,
      "/c.empty": `throw 'FAIL'`,
      "/d.empty": `throw 'FAIL'`,
    },
    sourceMap: "external",
    metafile: true,
    /* TODO FIX expectedCompileLog: `entry.js: WARNING: Import "named" will always be undefined because the file "d.empty" has no exports
  `, */
  });
  itBundled("loader/EmptyLoaderCSS", {
    // GENERATED
    files: {
      "/entry.css": /* css */ `
        @import 'a.empty';
        a { background: url(b.empty) }
      `,
      "/a.empty": `body { color: fail }`,
      "/b.empty": `fail`,
    },
    sourceMap: "external",
    metafile: true,
  });
  itBundled("loader/ExtensionlessLoaderJS", {
    // GENERATED
    files: {
      "/entry.js": `import './what'`,
      "/what": `foo()`,
    },
  });
  itBundled("loader/ExtensionlessLoaderCSS", {
    // GENERATED
    files: {
      "/entry.css": `@import './what';`,
      "/what": `.foo { color: red }`,
    },
  });
  itBundled("loader/LoaderCopyEntryPointAdvanced", {
    // GENERATED
    files: {
      "/project/entry.js": /* js */ `
        import xyz from './xyz.copy'
        console.log(xyz)
      `,
      "/project/TEST FAILED.copy": `some stuff`,
      "/project/xyz.copy": `more stuff`,
    },
    /* TODO FIX entryPathsAdvanced: []bundler.EntryPoint{
  			{
  				InputPath:                "/project/entry.js",
  				OutputPath:               "js/input/path",
  				InputPathInFileNamespace: true,
  			},
  			{
  				InputPath:                "/project/TEST FAILED.copy",
  				OutputPath:               "copy/input/path",
  				InputPathInFileNamespace: true,
  			},
  		}, */
  });
  itBundled("loader/LoaderCopyUseIndex", {
    // GENERATED
    files: {
      "/Users/user/project/src/index.copy": `some stuff`,
    },
  });
  itBundled("loader/LoaderCopyExplicitOutputFile", {
    // GENERATED
    files: {
      "/project/TEST FAILED.copy": `some stuff`,
    },
    outfile: "/out/this.worked",
  });
  itBundled("loader/LoaderCopyStartsWithDotAbsPath", {
    // GENERATED
    files: {
      "/project/src/.htaccess": `some stuff`,
      "/project/src/entry.js": `some.stuff()`,
      "/project/src/.ts": `foo as number`,
    },
    entryPoints: ["/project/src/.htaccess", "/project/src/entry.js", "/project/src/.ts"],
  });
  itBundled("loader/LoaderCopyStartsWithDotRelPath", {
    // GENERATED
    files: {
      "/project/src/.htaccess": `some stuff`,
      "/project/src/entry.js": `some.stuff()`,
      "/project/src/.ts": `foo as number`,
    },
    entryPoints: ["./.htaccess", "./entry.js", "./.ts"],
    /* TODO FIX absWorkingDir: "/project/src", */
  });
});
