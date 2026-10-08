// Original issue case: multi-line JSX with leading line comment
const doc = md`
${
	(
		// eslint-disable-next-line @atlaskit/ui-styling-standard/enforce-style-prop -- reason
		<div style={{ marginTop: token('space.100') }}>
			<Child />
		</div>
	)
}
`;

// Single-line JSX with leading line comment
const a = md`
${
	(
		// comment line
		<Child />
	)
}
`;

// Block comment instead of line comment
const c = md`
${
	(
		/* block comment */
		<div>
			<Child />
		</div>
	)
}
`;

// Multiple leading comments
const d = md`
${
	(
		// comment 1
		// comment 2
		<div>
			<Child />
		</div>
	)
}
`;

// JSX Fragment with leading comment
const e = md`
${
	(
		// comment
		<>
			<Child />
		</>
	)
}
`;

// Trailing comment after JSX inside parens
const f = md`
${
	(
		<div>
			<Child />
		</div>
		// trailing
	)
}
`;
