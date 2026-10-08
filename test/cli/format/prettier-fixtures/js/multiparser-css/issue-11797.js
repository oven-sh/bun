const paragraph1 = css`
  font-size: 12px;
  transform: ${vert ? 'translateY' : 'translateX'}(${translation + handleOffset}px);
`;

const paragraph2 = css`
  transform: ${expr}(30px);
`;

const paragraph3 = css`
  transform: ${expr} (30px);
`;
