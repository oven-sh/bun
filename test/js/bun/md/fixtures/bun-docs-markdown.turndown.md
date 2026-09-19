[Skip to content](#main)

[![](/logo.svg)](/)

[Docs](/docs)[Guides](/guides)[Reference](/reference)[Blog](/blog)

Search docs, APIs, guides…/

[](https://github.com/oven-sh/bun)[](/discord)[Install](/get)

[![](/logo.svg)](/)

[Home](/)[Docs](/docs)[Guides](/guides)[Reference](/reference)[Blog](/blog)

[Install Bun v1.4.2](/get)

[](https://github.com/oven-sh/bun)[](/discord)[](https://x.com/bunjavascript)

[Runtime](/docs)[Package Manager](/docs/pm/cli/install)[Bundler](/docs/bundler)[Test Runner](/docs/test)[Guides](/guides)[Reference](/reference)[Blog](/blog)[Feedback](/docs/feedback)

Browse docs

Runtime

-   Get Started
    
    -   [Welcome to Bun](/docs)
    -   [Installation](/docs/installation)
    -   [Quickstart](/docs/quickstart)
    -   [TypeScript](/docs/typescript)
    -   [TypeScript 6 and 7](/docs/typescript-6)
    -   [bun init](/docs/runtime/templating/init)
    -   [bun create](/docs/runtime/templating/create)
-   Core Runtime
    
    -   [Bun Runtime](/docs/runtime)
    -   [Watch Mode](/docs/runtime/watch-mode)
    -   [Debugging](/docs/runtime/debugger)
    -   [REPL](/docs/runtime/repl)
    -   [bunfig.toml](/docs/runtime/bunfig)
-   File & Module System
    
    -   [File Types](/docs/runtime/file-types)
    -   [Module Resolution](/docs/runtime/module-resolution)
    -   [JSX](/docs/runtime/jsx)
    -   [Auto-install](/docs/runtime/auto-install)
    -   [Plugins](/docs/runtime/plugins)
    -   [File System Router](/docs/runtime/file-system-router)
-   HTTP server
    
    -   [Server](/docs/runtime/http/server)
    -   [Routing](/docs/runtime/http/routing)
    -   [Cookies](/docs/runtime/http/cookies)
    -   [TLS](/docs/runtime/http/tls)
    -   [Error Handling](/docs/runtime/http/error-handling)
    -   [Metrics](/docs/runtime/http/metrics)
-   Networking
    
    -   [Fetch](/docs/runtime/networking/fetch)
    -   [WebSockets](/docs/runtime/http/websockets)
    -   [TCP](/docs/runtime/networking/tcp)
    -   [UDP](/docs/runtime/networking/udp)
    -   [DNS](/docs/runtime/networking/dns)
-   Data & Storage
    
    -   [Cookies](/docs/runtime/cookies)
    -   [File I/O](/docs/runtime/file-io)
    -   [Streams](/docs/runtime/streams)
    -   [Binary Data](/docs/runtime/binary-data)
    -   [Archive](/docs/runtime/archive)
    -   [SQL](/docs/runtime/sql)
    -   [SQLite](/docs/runtime/sqlite)
    -   [S3](/docs/runtime/s3)
    -   [Redis](/docs/runtime/redis)
-   Concurrency
    
    -   [Workers](/docs/runtime/workers)
-   Process & System
    
    -   [Environment Variables](/docs/runtime/environment-variables)
    -   [Shell](/docs/runtime/shell)
    -   [Spawn](/docs/runtime/child-process)
    -   [WebView](/docs/runtime/webview)
    -   [Cron](/docs/runtime/cron)
-   Interop & Tooling
    
    -   [Node-API](/docs/runtime/node-api)
    -   [FFI](/docs/runtime/ffi)
    -   [C Compiler](/docs/runtime/c-compiler)
    -   [Transpiler](/docs/runtime/transpiler)
-   Utilities
    
    -   [CSRF Protection](/docs/runtime/csrf)
    -   [Secrets](/docs/runtime/secrets)
    -   [Console](/docs/runtime/console)
    -   [TOML](/docs/runtime/toml)
    -   [YAML](/docs/runtime/yaml)
    -   [Markdown](/docs/runtime/markdown)
    -   [JSON5](/docs/runtime/json5)
    -   [XML](/docs/runtime/xml)
    -   [JSONL](/docs/runtime/jsonl)
    -   [HTMLRewriter](/docs/runtime/html-rewriter)
    -   [Image](/docs/runtime/image)
    -   [Hashing](/docs/runtime/hashing)
    -   [Glob](/docs/runtime/glob)
    -   [Semver](/docs/runtime/semver)
    -   [Color](/docs/runtime/color)
    -   [Utils](/docs/runtime/utils)
-   Standards & Compatibility
    
    -   [Globals](/docs/runtime/globals)
    -   [Bun APIs](/docs/runtime/bun-apis)
    -   [Web APIs](/docs/runtime/web-apis)
    -   [Node.js Compatibility](/docs/runtime/nodejs-compat)
-   Contributing
    
    -   [Roadmap](/docs/project/roadmap)
    -   [Benchmarking](/docs/project/benchmarking)
    -   [Contributing](/docs/project/contributing)
    -   [Building Windows](/docs/project/building-windows)
    -   [Bindgen](/docs/project/bindgen)
    -   [License](/docs/project/license)

1.  [Runtime](/docs)
2.  ›Utilities

Copy page

# Markdown

Parse and render Markdown with Bun's built-in Markdown API, supporting GFM extensions and custom rendering callbacks

**Unstable API** — This API is under active development and may change in future versions of Bun.

Bun includes a fast, built-in Markdown parser written in Rust. It supports GitHub Flavored Markdown (GFM) extensions and provides three APIs:

-   `Bun.markdown.html()` — render Markdown to an HTML string
-   `Bun.markdown.render()` — render Markdown with custom callbacks for each element
-   `Bun.markdown.react()` — render Markdown to React JSX elements

---

## `Bun.markdown.html()`[#](#bun-markdown-html)

Convert a Markdown string to HTML.

```
const html = Bun.markdown.html("# Hello **world**");
// "<h1>Hello <strong>world</strong></h1>\n"
```

GFM extensions like tables, strikethrough, and task lists are enabled by default:

```
const html = Bun.markdown.html(`
| Feature      | Status |
|-------------|--------|
| Tables       | ~~done~~ |
| Strikethrough| ~~done~~ |
| Task lists   | done |
`);
```

### Options[#](#options)

Pass an options object as the second argument to configure the parser:

```
const html = Bun.markdown.html("some markdown", {
  tables: true, // GFM tables (default: true)
  strikethrough: true, // GFM strikethrough (default: true)
  tasklists: true, // GFM task lists (default: true)
  tagFilter: true, // GFM tag filter for disallowed HTML tags
  autolinks: true, // Autolink URLs, emails, and www. links
});
```

All available options:

| Option | Default | Description |
| --- | --- | --- |
| `tables` | `true` | GFM tables |
| `strikethrough` | `true` | GFM strikethrough (`~~text~~`) |
| `tasklists` | `true` | GFM task lists (`- [x] item`) |
| `autolinks` | `false` | Enable autolinks — see [Autolinks](#autolinks) |
| `headings` | `false` | Heading IDs and autolinks — see [Heading IDs](#heading-ids) |
| `hardSoftBreaks` | `false` | Treat soft line breaks as hard breaks |
| `wikiLinks` | `false` | Enable `[[wiki links]]` |
| `underline` | `false` | `__text__` renders as `<u>` instead of `<strong>` |
| `latexMath` | `false` | Enable `$inline$` and `$$display$$` math |
| `collapseWhitespace` | `false` | Collapse whitespace in text |
| `permissiveAtxHeaders` | `false` | ATX headers without space after `#` |
| `noIndentedCodeBlocks` | `false` | Disable indented code blocks |
| `noHtmlBlocks` | `false` | Disable HTML blocks |
| `noHtmlSpans` | `false` | Disable inline HTML |
| `tagFilter` | `false` | GFM tag filter for disallowed HTML tags |

#### Autolinks[#](#autolinks)

Pass `true` to enable all autolink types, or an object for granular control:

```
// Enable all autolinks (URL, WWW, email)
Bun.markdown.html("Visit www.example.com", { autolinks: true });

// Enable only specific types
Bun.markdown.html("Visit www.example.com", {
  autolinks: { url: true, www: true },
});
```

#### Heading IDs[#](#heading-ids)

Pass `true` to enable both heading IDs and autolink headings, or an object for granular control:

```
// Enable heading IDs and autolink headings
Bun.markdown.html("## Hello World", { headings: true });
// '<h2 id="hello-world"><a href="#hello-world">Hello World</a></h2>\n'

// Enable only heading IDs (no autolink)
Bun.markdown.html("## Hello World", { headings: { ids: true } });
// '<h2 id="hello-world">Hello World</h2>\n'
```

---

## `Bun.markdown.render()`[#](#bun-markdown-render)

Parse Markdown and render it using custom JavaScript callbacks. The callbacks give you full control over the output format. You can generate HTML with custom classes, ANSI terminal output, or any other string format.

```
const result = Bun.markdown.render("# Hello **world**", {
  heading: (children, { level }) => `<h${level} class="title">${children}</h${level}>`,
  strong: children => `<b>${children}</b>`,
  paragraph: children => `<p>${children}</p>`,
});
// '<h1 class="title">Hello <b>world</b></h1>'
```

### Callback signature[#](#callback-signature)

Each callback receives:

1.  **`children`** — the accumulated content of the element as a string
2.  **`meta`** (optional) — an object with element-specific metadata

Return a string to replace the element's rendering. Return `null` or `undefined` to omit the element from the output entirely. If an element has no callback, its children pass through unchanged.

### Block callbacks[#](#block-callbacks)

| Callback | Meta | Description |
| --- | --- | --- |
| `heading` | `{ level, id? }` | Heading level 1–6. `id` is set when `headings: { ids: true }` is enabled |
| `paragraph` | — | Paragraph block |
| `blockquote` | — | Blockquote block |
| `code` | `{ language? }` | Fenced or indented code block. `language` is the info-string when specified on the fence |
| `list` | `{ ordered, start?, depth }` | `depth` is nesting level (0 = top-level). `start` is set for ordered lists |
| `listItem` | `{ index, depth, ordered, start?, checked? }` | See [List item meta](#list-item-meta) below |
| `hr` | — | Horizontal rule |
| `table` | — | Table block |
| `thead` | — | Table head |
| `tbody` | — | Table body |
| `tr` | — | Table row |
| `th` | `{ align? }` | Table header cell. `align` is `"left"`, `"center"`, `"right"`, or absent |
| `td` | `{ align? }` | Table data cell |
| `html` | — | Raw HTML content |

#### List item meta[#](#list-item-meta)

The `listItem` callback receives everything needed to render markers directly:

-   `index` — 0-based position within the parent list
-   `depth` — the parent list's nesting level (0 = top-level)
-   `ordered` — whether the parent list is ordered
-   `start` — the parent list's start number (only when `ordered` is true)
-   `checked` — task list state (only for `- [x]` / `- [ ]` items)

### Inline callbacks[#](#inline-callbacks)

| Callback | Meta | Description |
| --- | --- | --- |
| `strong` | — | Strong emphasis (`**text**`) |
| `emphasis` | — | Emphasis (`*text*`) |
| `link` | `{ href: string, title?: string }` | Link |
| `image` | `{ src: string, title?: string }` | Image |
| `codespan` | — | Inline code (`` `code` ``) |
| `strikethrough` | — | Strikethrough (`~~text~~`) |
| `text` | — | Plain text content |

### Examples[#](#examples)

#### Custom HTML with classes[#](#custom-html-with-classes)

```
const html = Bun.markdown.render("# Title\n\nHello **world**", {
  heading: (children, { level }) => `<h${level} class="heading heading-${level}">${children}</h${level}>`,
  paragraph: children => `<p class="body">${children}</p>`,
  strong: children => `<strong class="bold">${children}</strong>`,
});
```

#### Stripping all formatting[#](#stripping-all-formatting)

```
const plaintext = Bun.markdown.render("# Hello **world**", {
  heading: children => children,
  paragraph: children => children,
  strong: children => children,
  emphasis: children => children,
  link: children => children,
  image: () => "",
  code: children => children,
  codespan: children => children,
});
// "Hello world"
```

#### Omitting elements[#](#omitting-elements)

Return `null` or `undefined` to remove an element from the output:

```
const result = Bun.markdown.render("# Title\n\n![logo](img.png)\n\nHello", {
  image: () => null, // Remove all images
  heading: children => children,
  paragraph: children => children + "\n",
});
// "Title\nHello\n"
```

#### ANSI terminal output[#](#ansi-terminal-output)

```
const ansi = Bun.markdown.render("# Hello\n\nThis is **bold** and *italic*", {
  heading: (children, { level }) => `\x1b[1;4m${children}\x1b[0m\n`,
  paragraph: children => children + "\n",
  strong: children => `\x1b[1m${children}\x1b[22m`,
  emphasis: children => `\x1b[3m${children}\x1b[23m`,
});
```

#### Nested list numbering[#](#nested-list-numbering)

The `listItem` callback receives everything needed to render markers directly — no post-processing:

```
const result = Bun.markdown.render("1. first\n   1. sub-a\n   2. sub-b\n2. second", {
  listItem: (children, { index, depth, ordered, start }) => {
    const n = (start ?? 1) + index;
    // 1. 2. 3. at depth 0, a. b. c. at depth 1, i. ii. iii. at depth 2
    const marker = !ordered
      ? "-"
      : depth === 0
        ? `${n}.`
        : depth === 1
          ? `${String.fromCharCode(96 + n)}.`
          : `${toRoman(n)}.`;
    return "  ".repeat(depth) + marker + " " + children.trimEnd() + "\n";
  },
  // Prepend a newline so nested lists are separated from their parent item's text
  list: children => "\n" + children,
});
// 1. first
//   a. sub-a
//   b. sub-b
// 2. second
```

#### Code block syntax highlighting[#](#code-block-syntax-highlighting)

```
const result = Bun.markdown.render("```js\nconsole.log('hi')\n```", {
  code: (children, meta) => {
    const lang = meta?.language ?? "";
    return `<pre><code class="language-${lang}">${children}</code></pre>`;
  },
});
```

### Parser options[#](#parser-options)

Pass parser options as a separate third argument:

```
const result = Bun.markdown.render(
  "Visit www.example.com",
  {
    link: (children, { href }) => `[${children}](${href})`,
    paragraph: children => children,
  },
  { autolinks: true },
);
```

---

## `Bun.markdown.react()`[#](#bun-markdown-react)

Render Markdown directly to React elements. Returns a `<Fragment>` that you can use as a component return value.

```
function Markdown({ text }: { text: string }) {
  return Bun.markdown.react(text);
}
```

### Server-side rendering[#](#server-side-rendering)

Works with `renderToString()` and React Server Components:

```
import { renderToString } from "react-dom/server";

const html = renderToString(Bun.markdown.react("# Hello **world**"));
// "<h1>Hello <strong>world</strong></h1>"
```

### Component overrides[#](#component-overrides)

Replace any HTML element with a custom React component by passing it in the second argument, keyed by tag name:

```
function Code({ language, children }) {
  return (
    <pre data-language={language}>
      <code>{children}</code>
    </pre>
  );
}

function Link({ href, title, children }) {
  return (
    <a href={href} title={title} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Heading({ id, children }) {
  return (
    <h2 id={id}>
      <a href={`#${id}`}>{children}</a>
    </h2>
  );
}

const el = Bun.markdown.react(
  content,
  {
    pre: Code,
    a: Link,
    h2: Heading,
  },
  { headings: { ids: true } },
);
```

#### Available overrides[#](#available-overrides)

You can override every HTML tag the parser produces:

| Option | Props | Description |
| --- | --- | --- |
| `h1`–`h6` | `{ id?, children }` | Headings. `id` is set when `headings: { ids: true }` is enabled |
| `p` | `{ children }` | Paragraph |
| `blockquote` | `{ children }` | Blockquote |
| `pre` | `{ language?, children }` | Code block. `language` is the info string (e.g. `"js"`) |
| `hr` | `{}` | Horizontal rule (no children) |
| `ul` | `{ children }` | Unordered list |
| `ol` | `{ start, children }` | Ordered list. `start` is the first item number |
| `li` | `{ checked?, children }` | List item. `checked` is set for task list items |
| `table` | `{ children }` | Table |
| `thead` | `{ children }` | Table head |
| `tbody` | `{ children }` | Table body |
| `tr` | `{ children }` | Table row |
| `th` | `{ align?, children }` | Table header cell |
| `td` | `{ align?, children }` | Table data cell |
| `em` | `{ children }` | Emphasis (`*text*`) |
| `strong` | `{ children }` | Strong (`**text**`) |
| `a` | `{ href, title?, children }` | Link |
| `img` | `{ src, alt?, title? }` | Image (no children) |
| `code` | `{ children }` | Inline code |
| `del` | `{ children }` | Strikethrough (`~~text~~`) |
| `br` | `{}` | Hard line break (no children) |

### React 18 and older[#](#react-18-and-older)

By default, elements use `Symbol.for('react.transitional.element')` as the `$$typeof` symbol. For React 18 and older, pass `reactVersion: 18` in the options (third argument):

```
function Markdown({ text }: { text: string }) {
  return Bun.markdown.react(text, undefined, { reactVersion: 18 });
}
```

### Parser options[#](#parser-options-1)

Pass any of the [parser options](#options) as the third argument:

```
const el = Bun.markdown.react("## Hello World", undefined, {
  headings: { ids: true },
  autolinks: true,
});
```

[PreviousYAML](/docs/runtime/yaml)[NextJSON5](/docs/runtime/json5)

[Edit this page on GitHub](https://github.com/oven-sh/bun/blob/main/docs/runtime/markdown.mdx)[View as Markdown](/docs/runtime/markdown.md)

On this page

-   [`Bun.markdown.html()`](#bun-markdown-html)
    -   [Options](#options)
-   [`Bun.markdown.render()`](#bun-markdown-render)
    -   [Callback signature](#callback-signature)
    -   [Block callbacks](#block-callbacks)
    -   [Inline callbacks](#inline-callbacks)
    -   [Examples](#examples)
    -   [Parser options](#parser-options)
-   [`Bun.markdown.react()`](#bun-markdown-react)
    -   [Server-side rendering](#server-side-rendering)
    -   [Component overrides](#component-overrides)
    -   [React 18 and older](#react-18-and-older)
    -   [Parser options](#parser-options-1)

Ask AI
