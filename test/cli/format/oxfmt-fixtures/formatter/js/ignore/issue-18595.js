// prettier-ignore on class property should not add extra semicolon
export class Counter {
	// prettier-ignore
	'count' = $state(0);
	constructor() {
		this['count'] = $state(0);
	}
}

export class Counter2 {
	// prettier-ignore
	'count' = $state(0)
	constructor() {
		this['count'] = $state(0);
	}
}

export class Counter3 {
	'count' = $state(0)
	constructor() {
		this['count'] = $state(0);
	}
}

export class Counter4 {
	'count' = $state(0);;
	constructor() {
		this['count'] = $state(0);
	}
}
