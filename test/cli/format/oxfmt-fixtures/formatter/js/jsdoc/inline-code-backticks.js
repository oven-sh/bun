/**
 * `` ```js /Hello|Hi/ ``
 *
 * Meta word highlight
 *
 * @param parser - Code parser instance
 * @param meta - Meta string
 */
function highlight(parser, meta) {}

/**
 * Single backtick: `foo` and double-backtick escaping: `` a`b ``.
 */
function a() {}

/**
 * Content with leading backtick: `` `leading ``, trailing: `` trailing` ``.
 */
function b() {}

/**
 * *emph* triggers mdast parsing. Pure single backtick: `` ` ``.
 */
function c() {}

/**
 * *emph* then double-backtick escape: `` a`b ``.
 */
function d() {}
