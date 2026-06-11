var webpackRealRemote;
/******/ (() => { // webpackBootstrap
/******/   "use strict";
/******/   var __webpack_modules__ = ({

/***/ 87:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = ({ label: "webpack-remote-button" });


/***/ }),

/***/ 173:
/***/ ((__unused_webpack_module, exports, __webpack_require__) => {

var moduleMap = {
  "./Button": () => {
    return Promise.resolve().then(() => (() => ((__webpack_require__(87)))));
  }
};
var get = (module, getScope) => {
  __webpack_require__.R = getScope;
  getScope = (
    __webpack_require__.o(moduleMap, module)
      ? moduleMap[module]()
      : Promise.resolve().then(() => {
        throw new Error('Module "' + module + '" does not exist in container.');
      })
  );
  __webpack_require__.R = undefined;
  return getScope;
};
var init = (shareScope, initScope) => {
  if (!__webpack_require__.S) return;
  var name = "default"
  var oldScope = __webpack_require__.S[name];
  if(oldScope && oldScope !== shareScope) throw new Error("Container initialization failed as it has already been initialized with a different share scope");
  __webpack_require__.S[name] = shareScope;
  return __webpack_require__.I(name, initScope);
};

// This exports getters to disallow modifications
__webpack_require__.d(exports, {
  get: () => (get),
  init: () => (init)
});

/***/ })

/******/   });
/************************************************************************/
/******/   // The module cache
/******/   var __webpack_module_cache__ = {};
/******/
/******/   // The require function
/******/   function __webpack_require__(moduleId) {
/******/     // Check if module is in cache
/******/     var cachedModule = __webpack_module_cache__[moduleId];
/******/     if (cachedModule !== undefined) {
/******/       return cachedModule.exports;
/******/     }
/******/     // Create a new module (and put it into the cache)
/******/     var module = __webpack_module_cache__[moduleId] = {
/******/       // no module.id needed
/******/       // no module.loaded needed
/******/       exports: {}
/******/     };
/******/
/******/     // Execute the module function
/******/     __webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/
/******/     // Return the exports of the module
/******/     return module.exports;
/******/   }
/******/
/******/   // expose the modules object (__webpack_modules__)
/******/   __webpack_require__.m = __webpack_modules__;
/******/
/******/   // expose the module cache
/******/   __webpack_require__.c = __webpack_module_cache__;
/******/
/************************************************************************/
/******/   /* webpack/runtime/define property getters */
/******/   (() => {
/******/     // define getter functions for harmony exports
/******/     __webpack_require__.d = (exports, definition) => {
/******/       for(var key in definition) {
/******/         if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/           Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/         }
/******/       }
/******/     };
/******/   })();
/******/
/******/   /* webpack/runtime/hasOwnProperty shorthand */
/******/   (() => {
/******/     __webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/   })();
/******/
/******/   /* webpack/runtime/make namespace object */
/******/   (() => {
/******/     // define __esModule on exports
/******/     __webpack_require__.r = (exports) => {
/******/       if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/         Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/       }
/******/       Object.defineProperty(exports, '__esModule', { value: true });
/******/     };
/******/   })();
/******/
/******/   /* webpack/runtime/sharing */
/******/   (() => {
/******/     __webpack_require__.S = {};
/******/     var initPromises = {};
/******/     var initTokens = {};
/******/     __webpack_require__.I = (name, initScope) => {
/******/       if(!initScope) initScope = [];
/******/       // handling circular init calls
/******/       var initToken = initTokens[name];
/******/       if(!initToken) initToken = initTokens[name] = {};
/******/       if(initScope.indexOf(initToken) >= 0) return;
/******/       initScope.push(initToken);
/******/       // only runs once
/******/       if(initPromises[name]) return initPromises[name];
/******/       // creates a new share scope if needed
/******/       if(!__webpack_require__.o(__webpack_require__.S, name)) __webpack_require__.S[name] = {};
/******/       // runs all init snippets from all modules reachable
/******/       var scope = __webpack_require__.S[name];
/******/       var warn = (msg) => {
/******/         if (typeof console !== "undefined" && console.warn) console.warn(msg);
/******/       };
/******/       var uniqueName = "webpackRealRemote";
/******/       var register = (name, version, factory, eager) => {
/******/         var versions = scope[name] = scope[name] || {};
/******/         var activeVersion = versions[version];
/******/         if(!activeVersion || (!activeVersion.loaded && (!eager != !activeVersion.eager ? eager : uniqueName > activeVersion.from))) versions[version] = { get: factory, from: uniqueName, eager: !!eager };
/******/       };
/******/       var initExternal = (id) => {
/******/         var handleError = (err) => (warn("Initialization of sharing external failed: " + err));
/******/         try {
/******/           var module = __webpack_require__(id);
/******/           if(!module) return;
/******/           var initFn = (module) => (module && module.init && module.init(__webpack_require__.S[name], initScope))
/******/           if(module.then) return promises.push(module.then(initFn, handleError));
/******/           var initResult = initFn(module);
/******/           if(initResult && initResult.then) return promises.push(initResult['catch'](handleError));
/******/         } catch(err) { handleError(err); }
/******/       }
/******/       var promises = [];
/******/       switch(name) {
/******/       }
/******/       if(!promises.length) return initPromises[name] = 1;
/******/       return initPromises[name] = Promise.all(promises).then(() => (initPromises[name] = 1));
/******/     };
/******/   })();
/******/
/************************************************************************/
/******/
/******/   // module cache are used so entry inlining is disabled
/******/   // startup
/******/   // Load entry module and return exports
/******/   var __webpack_exports__ = __webpack_require__(173);
/******/   webpackRealRemote = __webpack_exports__;
/******/
/******/ })()
;