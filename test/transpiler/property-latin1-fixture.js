// prettier-ignore
let object2 = {
    código: 1,
    ["código2"]: 2,
    "código3": 3,
    'código4': 4,
    [`código5`]: 5,
  };
// prettier-ignore
let {
      código,
      ["código3"]: bound3,
      ['código2']: bound2,
      [`código2`]: bound22,
      "código4": bound4,
      'código5': bound5,
  } = object2;
// prettier-ignore
console.log(object2, código, object2.código, object2['código2'],
       object2["código3"],
       object2[`código4`], bound3, bound2, bound4, bound5, bound22);
