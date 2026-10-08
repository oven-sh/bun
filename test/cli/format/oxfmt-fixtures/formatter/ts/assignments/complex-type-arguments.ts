// Type argument is a `TSMappedType`
const emitter = createGlobalEmitter<{
  [key in Event["type"]]: Extract<Event, { type: key }>
}>()

// Type argument is a `TSTypeLiteral`
const emitter2 = createGlobalEmitter<{
  longlonglonglongKey: Extract<Event, { type: key }>
}>()

// Type argument is an `TSTypeReference`
// https://github.com/oxc-project/oxc/issues/17275
export class Test {
  	readonly coordinates = model.required<
		  Immutable<{
		  	latitude: number;
		  	longitude: number;
		  }>
	  >();
}

// Non-complex type arguments, as none of the type arguments of Record is a complex type.
const result = configurationService.getValue<Record<string, boolean>>(
  enalementSetting
);
