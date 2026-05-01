// @bun
'use strict';

const object = {};

function opt() {
    return Object.keys(object);
}

for (let i = 0; i < testLoopCount; i++)
    opt();

const tmp = new Array();
