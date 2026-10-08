function excludeFirstFiveResults([first, second, third, fourth, fifth, ...rest]) {
  return rest;
}

function excludeFirstFiveResults2([first, second, third, fourth, fifth, ...rest] = DEFAULT_FIVE_RESULTS) {
  return rest;
}

function excludeFirstFiveResults3([firstResult, secondResult, thirdResult, fourthResult, fifthResult, ...rest] = [1, 2, 3, 4, 5]) {
  return rest;
}

const excludeFirstFiveResults5 = ([first, second, third, fourth, fifth, ...rest]) => {
  return rest;
}

class A {
  excludeFirstFiveResults([first, second, third, fourth, fifth, ...restOfResults]) {
    return restOfResults;
  }
}

promise.then(([firstResult, secondResult, thirdResult, fourthResult, fifthResult, ...rest]) => {
  return rest;
});
