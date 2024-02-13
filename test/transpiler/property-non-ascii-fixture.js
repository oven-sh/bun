// biome-ignore: format ignore
let object2 = {
    código: 1,
    ["código2"]: 2,
    "código3": 3,
    'código4': 4,
    [`código5`]: 5,
    "😋 Get ": 6,
  };
// biome-ignore: format ignoreormat ignore
let {
      código,
      ["código3"]: bound3,
      ['código2']: bound2,
      [`código2`]: bound22,
      "código4": bound4,
      'código5': bound5,
      "😋 Get ": bound6,
      '😋 Get ': bound7,
      [`😋 Get `]: bound8,
      ["😋 Get "]: bound9,
      ['😋 Get ']: bound10,
  } = object2;
// biome-ignore: format ignoreormat ignore
console.log(object2, código, object2.código, object2['código2'],
       object2["código3"],
       object2[`código4`], bound3, bound2, bound4, bound5, bound22,bound6,
       bound7,
       bound8,
       bound9,
       bound10,
      object2[`😋 Get `],
      object2["😋 Get "],
      object2['😋 Get '],);
