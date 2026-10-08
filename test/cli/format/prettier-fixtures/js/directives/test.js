"use strict";

function f1() {
  "use strict";
}

function f2() {
  'ngInject';
  Object.assign(this, { $log, $uibModal });
}

function f3() {

  'ngInject';

  Object.assign(this, { $log, $uibModal });

}

function f4() {
  'ngInject';


  Object.assign(this, { $log, $uibModal });
}
