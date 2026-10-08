// Fix 2: Spaces inside fenced code blocks should not be converted to tabs

	/**
	 * Creates a dispatcher for component events.
	 *
	 * @example
	 * ```ts
	 * const dispatch = createEventDispatcher<{
	 *  loaded: null; // does not take a detail argument
	 *  change: string; // takes a detail argument of type string
	 *  optional: number | null; // takes an optional detail argument
	 * }>();
	 * ```
	 */
	function createEventDispatcher() {}
