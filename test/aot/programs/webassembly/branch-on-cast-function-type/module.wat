;; Source of module.wasm. Any assembler that supports the proposals below can rebuild it; the bytes may differ.
;; Proposals: typed function references, GC (br_on_cast, br_on_cast_fail). The module declares no struct or array type.
(module
  (type (;0;) (func (param i32 i32) (result i32)))
  (type (;1;) (func (param i32) (result i32)))
  (type (;2;) (func (param funcref) (result i32)))
  (type (;3;) (func (param funcref i32 i32) (result i32)))
  (type (;4;) (func (param anyref) (result i32)))
  (table 3 funcref)
  (export "add" (func $add))
  (export "subtract" (func $subtract))
  (export "negate" (func $negate))
  (export "isBinary" (func $isBinary))
  (export "isBinaryOrNull" (func $isBinaryOrNull))
  (export "isNotBinary" (func $isNotBinary))
  (export "applyIfBinary" (func $applyIfBinary))
  (export "kindOf" (func $kindOf))
  (export "classify" (func $classify))
  (elem (i32.const 0) func $add $negate)

  (func $add (type 0)
    local.get 0
    local.get 1
    i32.add)

  (func $subtract (type 0)
    local.get 0
    local.get 1
    i32.sub)

  (func $negate (type 1)
    i32.const 0
    local.get 0
    i32.sub)

  ;; Interpreted in an image because it tests a reference type, like the next four functions.
  (func $isBinary (type 2)
    block (result (ref 0))
      local.get 0
      br_on_cast 0 funcref (ref 0)
      drop
      i32.const 0
      return
    end
    drop
    i32.const 1)

  (func $isBinaryOrNull (type 2)
    block (result (ref null 0))
      local.get 0
      br_on_cast 0 funcref (ref null 0)
      drop
      i32.const 0
      return
    end
    drop
    i32.const 1)

  (func $isNotBinary (type 2)
    block (result funcref)
      local.get 0
      br_on_cast_fail 0 funcref (ref 0)
      drop
      i32.const 0
      return
    end
    drop
    i32.const 1)

  (func $applyIfBinary (type 3)
    block (result funcref)
      local.get 1
      local.get 2
      local.get 0
      br_on_cast_fail 0 funcref (ref 0)
      call_ref 0
      return
    end
    drop
    i32.const -1)

  ;; 1: i31, 2: struct, 3: array, 0: anything else.
  (func $kindOf (type 4)
    block (result (ref i31))
      block (result (ref struct))
        block (result (ref array))
          local.get 0
          br_on_cast 2 anyref (ref i31)
          br_on_cast 1 anyref (ref struct)
          br_on_cast 0 anyref (ref array)
          drop
          i32.const 0
          return
        end
        drop
        i32.const 3
        return
      end
      drop
      i32.const 2
      return
    end
    drop
    i32.const 1)

  ;; Compiled. isBinary + 2 * isBinaryOrNull + 4 * isNotBinary of the table element.
  (func $classify (type 1)
    local.get 0
    table.get 0
    call $isBinary
    local.get 0
    table.get 0
    call $isBinaryOrNull
    i32.const 1
    i32.shl
    i32.add
    local.get 0
    table.get 0
    call $isNotBinary
    i32.const 2
    i32.shl
    i32.add)
)
