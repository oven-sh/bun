const obj0 = conditionIsTruthy ? shortThing : otherShortThing

const obj1 = conditionIsTruthy ? { some: 'long', object: 'with', lots: 'of', stuff } : shortThing

const obj2 = conditionIsTruthy ? shortThing : { some: 'long', object: 'with', lots: 'of', stuff }

const obj3 = conditionIsTruthy ? { some: 'eeeeeeeeeeeeven looooooooooooooooooooooooooooooonger', object: 'with', lots: 'of', stuff } : shortThing

const obj4 = conditionIsTruthy ? shortThing : { some: 'eeeeeeeeeeeeven looooooooooooooooooooooooooooooonger', object: 'with', lots: 'of', stuff }

const obj5 = conditionIsTruthy ? { some: 'long', object: 'with', lots: 'of', stuff } : { some: 'eeeeeeeeeeeeven looooooooooooooooooooooooooooooonger', object: 'with', lots: 'of', stuff }
