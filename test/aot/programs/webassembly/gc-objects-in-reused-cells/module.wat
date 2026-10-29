;; Source of module.wasm. Any assembler that supports the proposal below can rebuild it; the bytes may differ.
;; Proposal: GC.
;; A build leaves a module with struct or array types to the interpreter (HasGCTypes). Once it compiles them, ../gc-objects-in-reused-cells.json
;; gets BUN_JSC_crashIfInterpreterIsUsed, as ../adds-two-numbers.json has, and the compiled struct.new and array.new are what this program tests.
(module
  (type $s (;0;) (struct (field i32) (field i32)))
  (type $a (;1;) (array (mut i32)))
  (type $b (;2;) (array (mut i8)))
  (type (;3;) (func (param i32 i32) (result (ref $s))))
  (type (;4;) (func (param i32 i32) (result (ref $a))))
  (type (;5;) (func (param i32) (result (ref $a))))
  (type (;6;) (func (param i32) (result (ref $b))))
  (type (;7;) (func (param (ref $s)) (result i32)))
  (type (;8;) (func (param (ref $a)) (result i32)))
  (type (;9;) (func (param (ref $b)) (result i32)))
  (export "makeStruct" (func $makeStruct))
  (export "makeArray" (func $makeArray))
  (export "makePair" (func $makePair))
  (export "makeBytes" (func $makeBytes))
  (export "structSum" (func $structSum))
  (export "arraySum" (func $arraySum))
  (export "bytesLength" (func $bytesLength))

  (func $makeStruct (type 3)
    local.get 0
    local.get 1
    struct.new $s)

  ;; The element, then the length.
  (func $makeArray (type 4)
    local.get 0
    local.get 1
    array.new $a)

  ;; A length the compiler knows.
  (func $makePair (type 5)
    local.get 0
    i32.const 2
    array.new $a)

  (func $makeBytes (type 6)
    local.get 0
    array.new_default $b)

  (func $structSum (type 7)
    local.get 0
    struct.get $s 0
    local.get 0
    struct.get $s 1
    i32.add)

  ;; The length plus the first element.
  (func $arraySum (type 8)
    local.get 0
    array.len
    local.get 0
    i32.const 0
    array.get $a
    i32.add)

  (func $bytesLength (type 9)
    local.get 0
    array.len)
)
