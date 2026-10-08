const OverlapWrapper =
  /** @type {import('styled-components').ThemedStyledFunction<'div',null,{overlap: boolean}>} */
  (styled.div)`
position:relative;
    > {
  position: absolute;
  bottom: ${p => p.overlap === 'previous' && 0};
top: ${p => p.overlap === 'next' && 0};
}
`
