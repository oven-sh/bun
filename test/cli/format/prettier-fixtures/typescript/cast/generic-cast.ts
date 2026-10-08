// https://github.com/prettier/prettier/issues/4171
function y() {

  const fits = <Immutable.Map<string, any>>fits();
  const fitsObjLiteral = <Immutable.Map<string, any>>{ a: "test" };
  const fitsArrayLiteral = <Immutable.Map<string, any>>["test", "test2"]

  const breakAfterCast = <Immutable.Map<string, any>>someExistingConfigMap.mergeDeep(fallbackOpts);

  const stillTooLong = <Immutable.Map<string, boolean, number, object, null, undefined, any, void, never>>someExistingConfigMap.mergeDeep(fallbackOptions);

  const stillTooLong2 = <Immutable.Map<string, boolean, number, object, null, undefined, any, void, never> | undefined>someExistingConfigMap.mergeDeep(fallbackOptions);

  const stillTooLong3 = <Immutable.Map<string>>someExistingConfigMap.mergeDeep(fallbackOptions.someMethodWithLongName(param1, param2));

  const stillTooLong4 = <Immutable.Map<string, boolean, number, object, null, undefined, any, void, never> | undefined>someExistingConfigMap.mergeDeep(fallbackOptions.someMethodWithLongName(param1, param2));
  
  const testObjLiteral = <Immutable.Map<string, any>>{ property1: "myPropertyVal" };

  const testObjLiteral2 = <Immutable.Map<string, any, number, boolean, object, null, undefined, never, "extra long">>{ property1: "myPropertyVal" };

  const testArrayLiteral = <Immutable.Map<string, any>>["first", "second", "third"];

  const testArrayLiteral2 = <Immutable.Map<string, any, number, boolean, object, null, undefined, never, "extra long">>["first", "second", "third"];

  const insideFuncCall = myFunc(param1, <Immutable.Map<string, any>>param2, param3)
}

// https://github.com/prettier/prettier/issues/4168
function x() {
  const fits = <PermissionsChecker<any> | undefined>(<any>permissions)[type];
  const fitsObjLiteral = <PermissionsChecker<any> | undefined>{ a: "test" };
  const fitsArrayLiteral = <PermissionsChecker<any> | undefined>["t1", "t2"];

  const breakAfterCast = <PermissionsChecker<any> | undefined>(<any>permissions)[receiverType];

  const stillTooLong = <PermissionsChecker<object> | undefined | number | string | boolean>(<any>permissions)[receiverType];

  const stillTooLong2 = <PermissionsChecker<object> | undefined | number | string | boolean | null | never>(<any>permissions)[receiverType];

  const stillTooLong3 = <PermissionsChecker<object> | undefined>(<any>permissions.someMethodWithLongName(parameter1, parameter2))[receiverTypeLongName];

  const stillTooLong4 = <PermissionsChecker<object> | undefined | number | string | boolean | null | never>(<any>permissions.someMethodWithLongName(parameter1, parameter2))[receiverTypeLongName];

  const testObjLiteral =  <PermissionsChecker<any> | undefined>{ prop1: "myPropVal" };

  const testObjLiteral2 = <PermissionsChecker<object> | undefined | number | string | boolean | null | never | object>{ prop1: "myPropVal" };

  const testArrayLiteral = <PermissionsChecker<any> | undefined>["first", "second", "third"];

  const testArrayLiteral2 = <PermissionsChecker<object> | undefined | number | string | boolean | null | never | object>["first", "second", "third"];

  const insideFuncCall = myFunc(param1, <PermissionsChecker<any> | undefined>param2, param3)
}
