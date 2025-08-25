// Test our ECMAScript decorators runtime function
var __decorateClassES = function (decorators, target, key, desc) {
  var c = arguments.length,
    r = c < 3 ? target : desc === null ? (desc = Object.getOwnPropertyDescriptor(target, key)) : desc,
    d,
    initializers = [];
  
  // Create decorator context object for ECMAScript decorators
  var createContext = function(kind, name, isStatic, isPrivate) {
    var context = {
      kind: kind,
      name: name,
      static: isStatic || false,
      private: isPrivate || false,
      addInitializer: function(initializer) {
        if (typeof initializer !== 'function') {
          throw new TypeError('addInitializer must be called with a function');
        }
        initializers.push(initializer);
      }
    };
    
    // Add access property for field decorators
    if (kind === 'field' && name && typeof name === 'string') {
      context.access = {
        has: function(obj) { return name in obj; },
        get: function(obj) { return obj[name]; },
        set: function(obj, value) { obj[name] = value; }
      };
    }
    
    return context;
  };
  
  var kind = c < 3 ? 'class' : 'field';
  var isStatic = false;
  var isPrivate = false;
  var name = key;
  
  // Determine if this is a static member
  if (c >= 3 && desc && target && target.constructor && target.constructor !== target) {
    isStatic = target.constructor === target;
  }
  
  var context = createContext(kind, name, isStatic, isPrivate);
  
  // Apply decorators in reverse order (like TypeScript experimental decorators)
  for (var i = decorators.length - 1; i >= 0; i--) {
    if ((d = decorators[i])) {
      if (c < 3) {
        // Class decorator
        r = d(r, context) || r;
      } else {
        // Field/method decorator - pass value and context
        var value = desc ? desc.value : undefined;
        var result = d(value, context);
        if (result !== undefined) {
          r = result;
        }
      }
    }
  }
  
  // Run initializers after decoration
  if (initializers.length > 0) {
    var originalDescriptor = r;
    if (kind === 'field') {
      // For field decorators, we need to run initializers when the instance is created
      var originalInit = originalDescriptor ? originalDescriptor.initializer : undefined;
      r = {
        enumerable: true,
        configurable: true,
        writable: true,
        initializer: function() {
          var value = originalInit ? originalInit.call(this) : undefined;
          // Run initializers with the instance as 'this'
          for (var j = 0; j < initializers.length; j++) {
            initializers[j].call(this);
          }
          return value;
        }
      };
    }
  }
  
  return (c > 3 && r && Object.defineProperty(target, key, r), r);
};

// Test case similar to issue 4122
function wrap(value, ctx) {
  console.log('Wrapping', value, ctx);
  console.log('Context kind:', ctx.kind);
  console.log('Context name:', ctx.name);
  console.log('Context has addInitializer:', typeof ctx.addInitializer === 'function');
  
  ctx.addInitializer(function() {
    console.log('Initialized', this, value);
  });
}

class A {
  constructor() {
    this.a = 1;
  }
}

// Test ECMAScript decorator call
__decorateClassES([wrap], A.prototype, "a", undefined);

var a = new A();
console.log('a.a =', a.a);