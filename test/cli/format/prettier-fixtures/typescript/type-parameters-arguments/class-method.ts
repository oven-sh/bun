// https://github.com/prettier/prettier/issues/4070
export class Thing implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize((type: ObjectType): Provider<Opts> => {});
}

export class Thing2 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize((type: ObjectType): Provider<Opts> => { const someVar = doSomething(type); if (someVar) {return someVar.method()} return false;});
}

export class Thing3 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize((type) => { const someVar = doSomething(type); if (someVar) {return someVar.method()} return false;});
}

export class Thing4 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize((type: ObjectType): Provider<Opts> => type.doSomething());
}

export class Thing5 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize((type: ObjectType): Provider<Opts> => <any>type.doSomething());
}

export class Thing6 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize((type: ObjectType): Provider<Opts> => <Provider<Opts>>type.doSomething());
}

export class Thing7 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize((type: ObjectType) => <Provider<Opts>>type.doSomething());
}

export class Thing8 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize((type: ObjectType) => <Provider<Opts>>type.doSomething(withArgs, soIt, does, not, fit).extraCall());
}

export class Thing9 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize((type: ObjectType) => type.doSomething());
}

export class Thing10 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize((veryLongArgName: ObjectType): Provider<Options, MoreOptions> => veryLongArgName );
}

export class Thing11 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize((type: ObjectType): Provider => {});
}

// regular non-arrow functions

export class Thing12 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize(function(type: ObjectType): Provider<Opts> {return type});
}

export class Thing13 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize(function(type: ObjectType): Provider<Opts> { const someVar = doSomething(type); if (someVar) {return someVar.method()} return false;});
}

export class Thing14 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize(function(type) { const someVar = doSomething(type); if (someVar) {return someVar.method()} return false;});
}

export class Thing15 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize(function(type: ObjectType): Provider<Opts> {return type.doSomething()});
}

export class Thing16 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize(function(type: ObjectType): Provider<Opts> {return <any>type.doSomething()});
}

export class Thing17 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize(function(type: ObjectType): Provider<Opts>  {return <Provider<Opts>>type.doSomething()});
}

export class Thing18 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize(function(type: ObjectType) {return <Provider<Opts>>type.doSomething()});
}

export class Thing19 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize(function(type: ObjectType) { return <Provider<Opts>>type.doSomething(withArgs, soIt, does, not, fit).extraCall()});
}

export class Thing20 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize(function(type: ObjectType) {return type.doSomething()});
}

export class Thing21 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize(function(veryLongArgName: ObjectType): Provider<Options, MoreOptions> { return veryLongArgName });
}

export class Thing22 implements OtherThing {
    do: (type: Type) => Provider<Prop> = memoize(function(type: ObjectType): Provider {});
}


// case from https://github.com/prettier/prettier/issues/2581

const appIDs = createSelector(
    PubXURLParams.APP_IDS,
   (rawAppIDs): Array<AppID> => deserializeList(rawAppIDs),
);