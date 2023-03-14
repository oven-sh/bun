import { describe } from "bun:test";
import { itBundled } from "./expectBundled";

// Tests ported from:
// https://github.com/evanw/esbuild/blob/main/internal/bundler_tests/bundler_loader_test.go

// For debug, all files are written to $TEMP/bun-bundle-tests/loader

describe("bundler", () => {
  itBundled("loader/LoaderFile", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": `console.log(require('./test.svg'))`,
    },
    outdir: "/out/",
    snapshot: true,
  });
  itBundled("loader/LoaderFileMultipleNoCollision", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        console.log(
          require('./a/test.txt'),
          require('./b/test.txt'),
        )
      `,
    },
    outfile: "/dist/out.js",
    snapshot: true,
  });
  itBundled("loader/JSXSyntaxInJSWithJSXLoader", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": `console.log(<div/>)`,
    },
    snapshot: true,
  });
  itBundled("loader/JSXPreserveCapitalLetter", {
    // TODO: hand check and tweak
    files: {
      "/entry.jsx": /* jsx */ `
        import { mustStartWithUpperCaseLetter as Test } from './foo'
        console.log(<Test/>)
      `,
      "/foo.js": `export class mustStartWithUpperCaseLetter {}`,
    },
    snapshot: true,
  });
  itBundled("loader/JSXPreserveCapitalLetterMinify", {
    // TODO: hand check and tweak
    files: {
      "/entry.jsx": /* jsx */ `
        import { mustStartWithUpperCaseLetter as XYYYY } from './foo'
        console.log(<XYYYY tag-must-start-with-capital-letter />)
      `,
      "/foo.js": `export class mustStartWithUpperCaseLetter {}`,
    },
    minifyIdentifiers: true,
    snapshot: true,
  });
  itBundled("loader/JSXPreserveCapitalLetterMinifyNested", {
    // TODO: hand check and tweak
    files: {
      "/entry.jsx": /* jsx */ `
        x = () => {
          class XYYYYY {} // This should be named "Y" due to frequency analysis
          return <XYYYYY tag-must-start-with-capital-letter />
        }
      `,
    },
    minifyIdentifiers: true,
    snapshot: true,
  });
  itBundled("loader/RequireCustomExtensionString", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": `console.log(require('./test.custom'))`,
      "/test.custom": `#include <stdio.h>`,
    },
    snapshot: true,
  });
  itBundled("loader/RequireCustomExtensionBase64", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": `console.log(require('./test.custom'))`,
    },
    snapshot: true,
  });
  itBundled("loader/RequireCustomExtensionDataURL", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": `console.log(require('./test.custom'))`,
    },
    snapshot: true,
  });
  itBundled("loader/RequireCustomExtensionPreferLongest", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": `console.log(require('./test.txt'), require('./test.base64.txt'))`,
      "/test.txt": `test.txt`,
      "/test.base64.txt": `test.base64.txt`,
    },
    snapshot: true,
  });
  itBundled("loader/AutoDetectMimeTypeFromExtension", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": `console.log(require('./test.svg'))`,
    },
    snapshot: true,
  });
  itBundled("loader/LoaderJSONCommonJSAndES6", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        const x_json = require('./x.json')
        import y_json from './y.json'
        import {small, if as fi} from './z.json'
        console.log(x_json, y_json, small, fi)
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
    snapshot: true,
  });
  itBundled("loader/LoaderJSONInvalidIdentifierES6", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        import * as ns from './test.json'
        import * as ns2 from './test2.json'
        console.log(ns['invalid-identifier'], ns2)
      `,
      "/test.json": `{"invalid-identifier": true}`,
      "/test2.json": `{"invalid-identifier": true}`,
    },
    snapshot: true,
  });
  itBundled("loader/LoaderJSONMissingES6", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": `import {missing} from './test.json'`,
      "/test.json": `{"present": true}`,
    },
    snapshot: true,
  });
  itBundled("loader/LoaderTextCommonJSAndES6", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        const x_txt = require('./x.txt')
        import y_txt from './y.txt'
        console.log(x_txt, y_txt)
      `,
    },
    snapshot: true,
  });
  itBundled("loader/LoaderBase64CommonJSAndES6", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        const x_b64 = require('./x.b64')
        import y_b64 from './y.b64'
        console.log(x_b64, y_b64)
      `,
    },
    snapshot: true,
  });
  itBundled("loader/LoaderDataURLCommonJSAndES6", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        const x_url = require('./x.txt')
        import y_url from './y.txt'
        console.log(x_url, y_url)
      `,
    },
    snapshot: true,
  });
  itBundled("loader/LoaderFileCommonJSAndES6", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        const x_url = require('./x.txt')
        import y_url from './y.txt'
        console.log(x_url, y_url)
      `,
    },
    snapshot: true,
  });
  itBundled("loader/LoaderFileRelativePathJS", {
    // TODO: hand check and tweak
    files: {
      "/src/entries/entry.js": /* js */ `
        import x from '../images/image.png'
        console.log(x)
      `,
    },
    outbase: "/src",
    snapshot: true,
  });
  itBundled("loader/LoaderFileRelativePathCSS", {
    // TODO: hand check and tweak
    files: {
      "/src/entries/entry.css": /* css */ `
        div {
          background: url(../images/image.png);
        }
      `,
    },
    outbase: "/src",
    snapshot: true,
  });
  itBundled("loader/LoaderFileRelativePathAssetNamesJS", {
    // TODO: hand check and tweak
    files: {
      "/src/entries/entry.js": /* js */ `
        import x from '../images/image.png'
        console.log(x)
      `,
    },
    outbase: "/src",
    /* TODO: 
        AssetPathTemplate -- []config.PathTemplate{
  				{Data: "", Placeholder: config.DirPlaceholder},
  				{Data: "/", Placeholder: config.NamePlaceholder},
  				{Data: "-", Placeholder: config.HashPlaceholder},
  			}, */
    snapshot: true,
  });
  itBundled("loader/LoaderFileExtPathAssetNamesJS", {
    // TODO: hand check and tweak
    files: {
      "/src/entries/entry.js": /* js */ `
        import x from '../images/image.png'
        import y from '../uploads/file.txt'
        console.log(x, y)
      `,
    },
    outbase: "/src",
    /* TODO: 
        AssetPathTemplate -- []config.PathTemplate{
  				{Data: "", Placeholder: config.ExtPlaceholder},
  				{Data: "/", Placeholder: config.NamePlaceholder},
  				{Data: "-", Placeholder: config.HashPlaceholder},
  			}, */
    snapshot: true,
  });
  itBundled("loader/LoaderFileRelativePathAssetNamesCSS", {
    // TODO: hand check and tweak
    files: {
      "/src/entries/entry.css": /* css */ `
        div {
          background: url(../images/image.png);
        }
      `,
    },
    outbase: "/src",
    /* TODO: 
        AssetPathTemplate -- []config.PathTemplate{
  				{Data: "", Placeholder: config.DirPlaceholder},
  				{Data: "/", Placeholder: config.NamePlaceholder},
  				{Data: "-", Placeholder: config.HashPlaceholder},
  			}, */
    snapshot: true,
  });
  itBundled("loader/LoaderFilePublicPathJS", {
    // TODO: hand check and tweak
    files: {
      "/src/entries/entry.js": /* js */ `
        import x from '../images/image.png'
        console.log(x)
      `,
    },
    outbase: "/src",
    /* TODO: 
        PublicPath -- "https://example.com", */
    snapshot: true,
  });
  itBundled("loader/LoaderFilePublicPathCSS", {
    // TODO: hand check and tweak
    files: {
      "/src/entries/entry.css": /* css */ `
        div {
          background: url(../images/image.png);
        }
      `,
    },
    outbase: "/src",
    /* TODO: 
        PublicPath -- "https://example.com", */
    snapshot: true,
  });
  itBundled("loader/LoaderFilePublicPathAssetNamesJS", {
    // TODO: hand check and tweak
    files: {
      "/src/entries/entry.js": /* js */ `
        import x from '../images/image.png'
        console.log(x)
      `,
    },
    outbase: "/src",
    /* TODO: 
        PublicPath -- "https://example.com", */
    /* TODO: 
        AssetPathTemplate -- []config.PathTemplate{
  				{Data: "", Placeholder: config.DirPlaceholder},
  				{Data: "/", Placeholder: config.NamePlaceholder},
  				{Data: "-", Placeholder: config.HashPlaceholder},
  			}, */
    snapshot: true,
  });
  itBundled("loader/LoaderFilePublicPathAssetNamesCSS", {
    // TODO: hand check and tweak
    files: {
      "/src/entries/entry.css": /* css */ `
        div {
          background: url(../images/image.png);
        }
      `,
    },
    outbase: "/src",
    /* TODO: 
        PublicPath -- "https://example.com", */
    /* TODO: 
        AssetPathTemplate -- []config.PathTemplate{
  				{Data: "", Placeholder: config.DirPlaceholder},
  				{Data: "/", Placeholder: config.NamePlaceholder},
  				{Data: "-", Placeholder: config.HashPlaceholder},
  			}, */
    snapshot: true,
  });
  itBundled("loader/LoaderFileOneSourceTwoDifferentOutputPathsJS", {
    // TODO: hand check and tweak
    files: {
      "/src/entries/entry.js": `import '../shared/common.js'`,
      "/src/entries/other/entry.js": `import '../../shared/common.js'`,
      "/src/shared/common.js": /* js */ `
        import x from './common.png'
        console.log(x)
      `,
    },
    entryPoints: ["/src/entries/entry.js", "/src/entries/other/entry.js"],
    outbase: "/src",
    snapshot: true,
  });
  itBundled("loader/LoaderFileOneSourceTwoDifferentOutputPathsCSS", {
    // TODO: hand check and tweak
    files: {
      "/src/entries/entry.css": `@import "../shared/common.css";`,
      "/src/entries/other/entry.css": `@import "../../shared/common.css";`,
      "/src/shared/common.css": /* css */ `
        div {
          background: url(common.png);
        }
      `,
    },
    entryPoints: ["/src/entries/entry.css", "/src/entries/other/entry.css"],
    outbase: "/src",
    snapshot: true,
  });
  itBundled("loader/LoaderJSONNoBundle", {
    // TODO: hand check and tweak
    files: {
      "/test.json": `{"test": 123, "invalid-identifier": true}`,
    },
    mode: "transform",
    snapshot: true,
  });
  itBundled("loader/LoaderJSONNoBundleES6", {
    // TODO: hand check and tweak
    files: {
      "/test.json": `{"test": 123, "invalid-identifier": true}`,
    },
    format: "esm",
    unsupportedJSFeatures: "ArbitraryModuleNamespaceNames",
    mode: "convertformat",
    snapshot: true,
  });
  itBundled("loader/LoaderJSONNoBundleES6ArbitraryModuleNamespaceNames", {
    // TODO: hand check and tweak
    files: {
      "/test.json": `{"test": 123, "invalid-identifier": true}`,
    },
    format: "esm",
    mode: "convertformat",
    snapshot: true,
  });
  itBundled("loader/LoaderJSONNoBundleCommonJS", {
    // TODO: hand check and tweak
    files: {
      "/test.json": `{"test": 123, "invalid-identifier": true}`,
    },
    format: "cjs",
    mode: "convertformat",
    snapshot: true,
  });
  itBundled("loader/LoaderJSONNoBundleIIFE", {
    // TODO: hand check and tweak
    files: {
      "/test.json": `{"test": 123, "invalid-identifier": true}`,
    },
    format: "iife",
    mode: "convertformat",
    snapshot: true,
  });
  itBundled("loader/LoaderJSONSharedWithMultipleEntriesIssue413", {
    // TODO: hand check and tweak
    files: {
      "/a.js": /* js */ `
        import data from './data.json'
        console.log('a:', data)
      `,
      "/b.js": /* js */ `
        import data from './data.json'
        console.log('b:', data)
      `,
      "/data.json": `{"test": 123}`,
    },
    entryPoints: ["/a.js", "/b.js"],
    format: "esm",
    snapshot: true,
  });
  itBundled("loader/LoaderFileWithQueryParameter", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        // Each of these should have a separate identity (i.e. end up in the output file twice)
        import foo from './file.txt?foo'
        import bar from './file.txt?bar'
        console.log(foo, bar)
      `,
      "/file.txt": `This is some text`,
    },
    snapshot: true,
  });
  itBundled("loader/LoaderFromExtensionWithQueryParameter", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        import foo from './file.abc?query.xyz'
        console.log(foo)
      `,
      "/file.abc": `This should not be base64 encoded`,
    },
    snapshot: true,
  });
  itBundled("loader/LoaderDataURLTextCSS", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": /* css */ `
        @import "data:text/css,body{color:%72%65%64}";
        @import "data:text/css;base64,Ym9keXtiYWNrZ3JvdW5kOmJsdWV9";
        @import "data:text/css;charset=UTF-8,body{color:%72%65%64}";
        @import "data:text/css;charset=UTF-8;base64,Ym9keXtiYWNrZ3JvdW5kOmJsdWV9";
      `,
    },
    snapshot: true,
  });
  itBundled("loader/LoaderDataURLTextCSSCannotImport", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": `@import "data:text/css,@import './other.css';";`,
      "/other.css": `div { should-not-be-imported: true }`,
    },
    snapshot: true,
  });
  itBundled("loader/LoaderDataURLTextJavaScript", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        import "data:text/javascript,console.log('%31%32%33')";
        import "data:text/javascript;base64,Y29uc29sZS5sb2coMjM0KQ==";
        import "data:text/javascript;charset=UTF-8,console.log(%31%32%33)";
        import "data:text/javascript;charset=UTF-8;base64,Y29uc29sZS5sb2coMjM0KQ==";
      `,
    },
    snapshot: true,
  });
  itBundled("loader/LoaderDataURLTextJavaScriptCannotImport", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": `import "data:text/javascript,import './other.js'"`,
      "/other.js": `shouldNotBeImported = true`,
    },
    snapshot: true,
  });
  itBundled("loader/LoaderDataURLTextJavaScriptPlusCharacter", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": `import "data:text/javascript,console.log(1+2)";`,
    },
    snapshot: true,
  });
  itBundled("loader/LoaderDataURLApplicationJSON", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("loader/LoaderDataURLUnknownMIME", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        import a from 'data:some/thing;what,someData%31%32%33';
        import b from 'data:other/thing;stuff;base64,c29tZURhdGEyMzQ=';
        console.log(a, b)
      `,
    },
    snapshot: true,
  });
  itBundled("loader/LoaderDataURLExtensionBasedMIME", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("loader/LoaderDataURLBase64VsPercentEncoding", {
    // TODO: hand check and tweak
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
    },
    snapshot: true,
  });
  itBundled("loader/LoaderDataURLBase64InvalidUTF8", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": /* js */ `
        import a from './binary.txt'
        console.log(a)
      `,
    },
    snapshot: true,
  });
  itBundled("loader/LoaderDataURLEscapePercents", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("loader/LoaderCopyWithBundleFromJS", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": /* js */ `
        import x from "../assets/some.file"
        console.log(x)
      `,
      "/Users/user/project/assets/some.file": `stuff`,
    },
    outbase: "/Users/user/project",
    snapshot: true,
  });
  itBundled("loader/LoaderCopyWithBundleFromCSS", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.css": /* css */ `
        body {
          background: url(../assets/some.file);
        }
      `,
      "/Users/user/project/assets/some.file": `stuff`,
    },
    outbase: "/Users/user/project",
    snapshot: true,
  });
  itBundled("loader/LoaderCopyWithBundleEntryPoint", {
    // TODO: hand check and tweak
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
    snapshot: true,
  });
  itBundled("loader/LoaderCopyWithTransform", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": `console.log('entry')`,
      "/Users/user/project/assets/some.file": `stuff`,
    },
    entryPoints: ["/Users/user/project/src/entry.js", "/Users/user/project/assets/some.file"],
    outbase: "/Users/user/project",
    mode: "passthrough",
    snapshot: true,
  });
  itBundled("loader/LoaderCopyWithFormat", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/entry.js": `console.log('entry')`,
      "/Users/user/project/assets/some.file": `stuff`,
    },
    entryPoints: ["/Users/user/project/src/entry.js", "/Users/user/project/assets/some.file"],
    format: "iife",
    outbase: "/Users/user/project",
    mode: "convertformat",
    snapshot: true,
  });
  itBundled("loader/JSXAutomaticNoNameCollision", {
    // TODO: hand check and tweak
    files: {
      "/entry.jsx": /* jsx */ `
        import { Link } from "@remix-run/react"
        const x = <Link {...y} key={z} />
      `,
    },
    format: "cjs",
    mode: "convertformat",
    snapshot: true,
  });
  itBundled("loader/AssertTypeJSONWrongLoader", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": `import foo from './foo.json' assert { type: 'json' }`,
      "/foo.json": `{}`,
    },
    snapshot: true,
  });
  itBundled("loader/EmptyLoaderJS", {
    // TODO: hand check and tweak
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
    /* TODO: 
        SourceMap -- config.SourceMapExternalWithoutComment, */
    metafile: true,
    snapshot: true,
  });
  itBundled("loader/EmptyLoaderCSS", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": /* css */ `
        @import 'a.empty';
        a { background: url(b.empty) }
      `,
      "/a.empty": `body { color: fail }`,
      "/b.empty": `fail`,
    },
    /* TODO: 
        SourceMap -- config.SourceMapExternalWithoutComment, */
    metafile: true,
    snapshot: true,
  });
  itBundled("loader/ExtensionlessLoaderJS", {
    // TODO: hand check and tweak
    files: {
      "/entry.js": `import './what'`,
      "/what": `foo()`,
    },
    snapshot: true,
  });
  itBundled("loader/ExtensionlessLoaderCSS", {
    // TODO: hand check and tweak
    files: {
      "/entry.css": `@import './what';`,
      "/what": `.foo { color: red }`,
    },
    snapshot: true,
  });
  itBundled("loader/LoaderCopyEntryPointAdvanced", {
    // TODO: hand check and tweak
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
  		}, */ snapshot: true,
  });
  itBundled("loader/LoaderCopyUseIndex", {
    // TODO: hand check and tweak
    files: {
      "/Users/user/project/src/index.copy": `some stuff`,
    },
    snapshot: true,
  });
  itBundled("loader/LoaderCopyExplicitOutputFile", {
    // TODO: hand check and tweak
    files: {
      "/project/TEST FAILED.copy": `some stuff`,
    },
    outfile: "/out/this.worked",
    snapshot: true,
  });
  itBundled("loader/LoaderCopyStartsWithDotAbsPath", {
    // TODO: hand check and tweak
    files: {
      "/project/src/.htaccess": `some stuff`,
      "/project/src/entry.js": `some.stuff()`,
      "/project/src/.ts": `foo as number`,
    },
    entryPoints: ["/project/src/.htaccess", "/project/src/entry.js", "/project/src/.ts"],
    snapshot: true,
  });
  itBundled("loader/LoaderCopyStartsWithDotRelPath", {
    // TODO: hand check and tweak
    files: {
      "/project/src/.htaccess": `some stuff`,
      "/project/src/entry.js": `some.stuff()`,
      "/project/src/.ts": `foo as number`,
    },
    entryPoints: ["./.htaccess", "./entry.js", "./.ts"],
    // TODO FIX absWorkingDir
    snapshot: true,
  });
});
