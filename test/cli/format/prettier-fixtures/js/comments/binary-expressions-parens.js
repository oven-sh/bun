Math.min(
  (
    /* $FlowFixMe(>=0.38.0 site=www) - Flow error detected during the
     * deployment of v0.38.0. To see the error, remove this comment and
     * run flow */
    document.body.scrollHeight -
    (window.scrollY + window.innerHeight)
  ) - devsite_footer_height,
  0,
)
