// Copyright (C) 2015 the V8 project authors. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
es6id: 13.3.3
description: >
  The ObjectBindingPattern with binding elements
info: |
  Destructuring Binding Patterns - Syntax

  ObjectBindingPattern[Yield] :
    { }
    { BindingPropertyList[?Yield] }
    { BindingPropertyList[?Yield] , }

  BindingPropertyList[Yield] :
    BindingProperty[?Yield]
    BindingPropertyList[?Yield] , BindingProperty[?Yield]

  BindingProperty[Yield] :
    SingleNameBinding[?Yield]
    PropertyName[?Yield] : BindingElement[?Yield]

  BindingElement[Yield ] :
    SingleNameBinding[?Yield]
    BindingPattern[?Yield] Initializer[In, ?Yield]opt

  SingleNameBinding[Yield] :
    BindingIdentifier[?Yield] Initializer[In, ?Yield]opt

features: [destructuring-binding]
---*/

// BindingElement w/ SingleNameBinding
function fna({x: y}) {}

// BindingElement w/ SingleNameBinding with initializer
function fnb({x: y = 42}) {}

// BindingElement w/ BindingPattern
function fnc({x: {}}) {}
function fnd({x: {y}}) {}

// BindingElement w/ BindingPattern w/ initializer
function fne({x: {} = 42}) {}
function fnf({x: {y} = 42}) {}
