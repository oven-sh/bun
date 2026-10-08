export const foo = css`
&.foo .${bar}::before,&.foo[value="hello"] .${bar}::before {
	position: absolute;
}
`;

export const foo2 = css`
a.${bar}:focus,a.${bar}:hover {
  color: red;
}
`;

export const global = css`
button.${foo}.${bar} {
  color: #fff;
}
`;
