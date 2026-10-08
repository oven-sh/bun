const Broken = React.forwardRef(({
	children,
	// 1
	// 2
	title,
	hidden,
	// 3
}, ref) => (
	<div ref={ref}>
		{children}
	</div>
))
