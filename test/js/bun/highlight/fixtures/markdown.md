---
title: Release notes
tags: [runtime, bundler]
draft: false
---

# Bun 1.5 release notes #

Setext heading
==============

Second level
------------

Some **bold**, *italic*, _also italic_, ~~gone~~ and ***bold with *nested* italic***.
Inline `code`, ``code with a ` backtick`` and math: $a^2 + b^2$ or $$c^2$$.
A hard break with a backslash\
and one with two spaces  
end here. Escapes: \* \_ \# \[ and references: &amp; &#35; &#x1F600;

## Links

An [inline link](https://bun.sh/docs "The docs"), one with [angle brackets](<a b.md> 'title')
and an ![image **alt**](./logo.svg (Logo)). A [full reference][docs], a [collapsed][] one
and a [shortcut]. Autolinks: <https://bun.sh>, <hi@bun.sh>, https://bun.sh/blog?a=1, www.bun.sh
and jarred@bun.sh. A footnote[^1] and another[^note]. No definition: [text][nowhere].

[docs]: https://bun.sh/docs "Documentation"
[collapsed]: <https://bun.sh/a b>
[shortcut]: ./shortcut.md
  'Title on the next line'

[^1]: The first footnote.
[^note]: The second one has `code`

    and a second paragraph.

## Quotes and lists

> A quote with **markup** and a
lazy line.
>
> > Nested quote
>
> ```ts
> const quoted: number = 1;
> /* a comment
>    over two lines */
> ```
>
> - a list in a quote

- dash
* star
+ plus
  1. ordered
  2) with a parenthesis
- [ ] to do
- [x] done
- code in an item:

  ```json
  { "name": "bun", "private": true }
  ```

***

- - -

## Tables

| Name     | Speed | Notes          |
| :------- | :---: | -------------: |
| `bun`    | fast  | **very** \| so |
| [node][] | ok    |                |

[node]: https://nodejs.org

## Code

```js title="index.js"
export default { fetch: () => new Response("hi") };
```

~~~css
a:hover { color: red; }
~~~

```unknown-language
left as it is
```

````md
# Markdown in Markdown

```sh
echo nested
```
````

    indented code
      keeps its indentation

$$
\sum_{i=0}^{n} i
$$

## HTML

<details open>
<summary>Click <b>me</b></summary>
</details>

<!-- a comment -->

Text with <kbd class="key">Ctrl</kbd> and <br/> inline.
