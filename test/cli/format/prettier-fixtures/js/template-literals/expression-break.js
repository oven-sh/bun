// https://github.com/prettier/prettier/issues/18369

_ = `
  <div>${long_cond && long_cond && long_cond && long_cond && long_cond ? "content" : ""}</div>
`;
_ = /* comment */ `
  <div>${long_cond && long_cond && long_cond && long_cond && long_cond ? "content" : ""}</div>
`;
_ = /* HTML */ `
  <div>${long_cond && long_cond && long_cond && long_cond && long_cond ? "content" : ""}</div>
`;

_ = unknown`
  <div>${long_cond && long_cond && long_cond && long_cond && long_cond ? "content" : ""}</div>
`;
_ = html`
  <div>${long_cond && long_cond && long_cond && long_cond && long_cond ? "content" : ""}</div>
`;
