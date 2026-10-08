// Fix D: Bare URLs should not be converted to markdown links
/**
 * Reference: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/a
 * See [example](https://example.com) for details.
 * Also see [https://url](https://url) format.
 * Multiple URLs: https://foo.com and https://bar.com/path?q=1
 */
const a = 1;

// Bare URL in @see tag
/**
 * @see https://example.com/docs for more
 */
const b = 2;
