import { describe, expect, test } from "bun:test";
import { isLinux, libcPathForDlopen } from "harness";
import { existsSync } from "node:fs";
import { hasLibrary } from "./library";
import { hasGPU, renderTo } from "./render";
import { screens } from "./screen";

const hasOpenGL = isLinux && hasGPU;

describe.skipIf(!hasLibrary || !hasOpenGL).concurrent.each(["the app", "a sandbox"])("WebGL in %s", place => {
  const hasSandbox = place === "a sandbox";
  const prelude = `
    const frame = () => new Promise(requestAnimationFrame);
    const create = (id = "webgl2", options, canvas = new OffscreenCanvas(4, 4)) => canvas.getContext(id, { antialias: false, ...options });
    const compile = (gl, type, source) => { const it = gl.createShader(type); gl.shaderSource(it, source); gl.compileShader(it); return it; };
    const use = (gl, vertex, fragment) => {
      const it = gl.createProgram();
      gl.attachShader(it, compile(gl, gl.VERTEX_SHADER, vertex)); gl.attachShader(it, compile(gl, gl.FRAGMENT_SHADER, fragment));
      gl.bindAttribLocation(it, 0, "at"); gl.linkProgram(it);
      if (!gl.getProgramParameter(it, gl.LINK_STATUS)) throw new Error(gl.getAttachedShaders(it).map(it => gl.getShaderInfoLog(it)) + gl.getProgramInfoLog(it));
      gl.useProgram(it);
      return it;
    };
    const fill = (gl, target, data) => { const it = gl.createBuffer(); gl.bindBuffer(target, it); gl.bufferData(target, data, gl.STATIC_DRAW); return it; };
    const cover = gl => { fill(gl, gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3])); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); };
    const plain = "attribute vec4 at; void main() { gl_Position = at; }", plain3 = "#version 300 es\\nin vec4 at; void main() { gl_Position = at; }";
    const read = (gl, x = 0, y = 0) => { const it = new Uint8Array(4); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, it); return it.join(); };
    const clear = (gl, ...color) => (gl.clearColor(...color), gl.clear(gl.COLOR_BUFFER_BIT));
    const error = (gl, run) => { try { run(); } catch (thrown) { return thrown.name; } const it = gl.getError(); return Object.keys(Object.getPrototypeOf(gl)).find(name => gl[name] === it && /ERROR|INVALID|LOST|MEMORY/.test(name)); };
    const program3 = (gl, fragment, vertex = plain3) => use(gl, vertex, "#version 300 es\\nprecision highp float; precision highp sampler2DArray; " + fragment);
    const sharp = (gl, target, define) => { const it = gl.createTexture(); gl.bindTexture(target, it); gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST); define(); return it; };
    const errors = (gl, ...all) => all.map(it => error(gl, it).replace(/INVALID_|_ERROR/, "")).join();
    const texel = (gl, upload) => {
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture); upload();
      gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer()); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      return read(gl);
    };`;
  const run = (script: string, html = "", points: number[][] = [], main = "", where = "memory") =>
    renderTo(where, html, prelude + script, points, 1, main, {
      BUN_DESKTOP_WEBGL: "1",
      BUN_DESKTOP_PAGE_PROCESSES: hasSandbox ? "1" : undefined,
    });

  test.each(["memory", ...screens])("is shown (%s)", async where => {
    const html = `<body style="background: #00f"><canvas id=a width=20 height=20></canvas><canvas id=b width=20 height=20></canvas><canvas id=c width=20 height=20></canvas><canvas id=d width=20 height=20></canvas><canvas id=e width=20 height=20></canvas>`;
    const script = `
      for (const [canvas, id] of [[a, "webgl"], [b, "webgl2"]]) {
        const gl = create(id, { antialias: true }, canvas);
        use(gl, plain, "void main() { gl_FragColor = gl_FragCoord.y < 10. ? vec4(1, 0, 0, 1) : vec4(0, 1, 0, 1); }"); cover(gl);
        clear(gl, 1, 1, 1, 1); await frame(); await frame();
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      clear(create("webgl", {}, c), 0.4, 0, 0, 0.4); clear(create("webgl", { premultipliedAlpha: false }, d), 1, 0, 0, 0.4); clear(create("webgl", { alpha: false }, e), 1, 0, 0, 0);
      await frame(); await frame();`;
    const points = [
      [10, 3],
      [10, 17],
      [30, 3],
      [30, 17],
      [50, 10],
      [70, 10],
      [90, 10],
    ];
    expect(await run(script, html, points, "", where)).toEqual([
      null,
      "00ff00",
      "ff0000",
      "00ff00",
      "ff0000",
      "660099",
      "660099",
      "ff0000",
    ]);
  });

  test("the drawing buffer is cleared once it was shown, unless it is preserved", async () => {
    const script = `
      const copy = canvas => { const it = new OffscreenCanvas(1, 1).getContext("2d"); it.drawImage(canvas, 0, 0); return it.getImageData(0, 0, 1, 1).data.join(); };
      const all = [create("webgl", {}, a), create("webgl", { preserveDrawingBuffer: true }, b), create("webgl", {}, document.createElement("canvas"))];
      all.forEach(it => clear(it, 0, 1, 0, 1));
      const before = all.map(it => copy(it.canvas));
      await frame(); await frame();
      const after = all.map(it => [read(it), copy(it.canvas)]);
      b.width = b.width;
      const same = read(all[1]);
      b.height = 7;
      return [before, after, same, read(all[1]), all[1].drawingBufferHeight, [...all[1].getParameter(all[1].VIEWPORT)]];`;
    const [green, none] = ["0,255,0,255", "0,0,0,0"];
    expect(
      await run(script, "<canvas id=a width=9 height=9></canvas><canvas id=b width=9 height=9></canvas>", [[4, 9]]),
    ).toEqual([
      [
        [green, green, green],
        [
          [none, none],
          [green, green],
          [green, green],
        ],
        green,
        none,
        7,
        [0, 0, 9, 9],
      ],
      "00ff00",
    ]);
  });

  test("a worker draws on a placeholder, and hands over a bitmap", async () => {
    const worker = `${prelude} onmessage = ({ data }) => {
      clear(create("webgl2", {}, data), 1, 0, 1, 1);
      const gl = create("webgl", { preserveDrawingBuffer: true }); clear(gl, 0, 1, 1, 1);
      const bitmap = gl.canvas.transferToImageBitmap();
      postMessage([bitmap, read(gl)], [bitmap]);
    }`;
    const script = `
      const worker = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(worker)}]))), canvas = a.transferControlToOffscreen();
      worker.postMessage(canvas, [canvas]);
      const [bitmap, left] = await new Promise(resolve => (worker.onmessage = event => resolve(event.data)));
      b.getContext("bitmaprenderer").transferFromImageBitmap(bitmap);
      const seen = new OffscreenCanvas(1, 1).getContext("2d");
      do await frame(), seen.drawImage(a, 0, 0); while (!seen.getImageData(0, 0, 1, 1).data[3]);
      await frame();
      return left;`;
    expect(
      await run(
        script,
        "<style>canvas { width: 20px; height: 20px }</style><canvas id=a></canvas><canvas id=b></canvas>",
        [
          [10, 10],
          [30, 10],
        ],
      ),
    ).toEqual(["0,0,0,0", "ff00ff", "00ffff"]);
  });

  test("workers end with their contexts", async () => {
    const worker = `${prelude} const all = [create(), create("webgl")]; all.forEach(it => clear(it, 1, 1, 1, 1)); postMessage(all.map(it => read(it)).join())`;
    const script = `
      const url = URL.createObjectURL(new Blob([${JSON.stringify(worker)}])), seen = new Set();
      for (let i = 0; i < 8; i++) { const it = new Worker(url); seen.add(await new Promise(resolve => (it.onmessage = event => resolve(event.data)))); it.terminate(); }
      return [...seen];`;
    expect(await run(script)).toEqual([[Array(8).fill(255).join()]]);
  });

  test.each(["webgl", "webgl2"])("%s draws nothing that is outside of its buffers", async id => {
    const script = `
      const gl = create("${id}"); use(gl, plain, "void main() { gl_FragColor = vec4(1); }"); cover(gl);
      const indices = fill(gl, gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 3]));
      return [
        () => gl.drawArrays(gl.TRIANGLES, 1, 3),
        () => gl.drawArrays(gl.TRIANGLES, 0x7fffffff, 3),
        () => gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 2),
        () => gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 4),
        () => gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 2 ** 32),
        () => (gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0), gl.clear(gl.COLOR_BUFFER_BIT)),
        () => (gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 2, new Uint16Array([9])), gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0)),
        () => gl.bindBuffer(gl.ARRAY_BUFFER, indices),
        () => (gl.bufferData(gl.ARRAY_BUFFER, 23, gl.STATIC_DRAW), gl.drawArrays(gl.TRIANGLES, 0, 3)),
        () => gl.bufferSubData(gl.ARRAY_BUFFER, 20, new Uint8Array(4)),
        () => (gl.bindTexture(gl.TEXTURE_2D, gl.createTexture()), gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 3, 2, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(20))),
        () => gl.readPixels(0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(15)),
        () => gl.bindTexture(gl.TEXTURE_2D, create("${id}").createTexture()),
      ].map(it => error(gl, it)).concat(read(gl));`;
    const [operation, value] = ["INVALID_OPERATION", "INVALID_VALUE"];
    expect(await run(script)).toEqual([
      [
        operation,
        operation,
        operation,
        operation,
        operation,
        "NO_ERROR",
        operation,
        operation,
        operation,
        value,
        operation,
        operation,
        operation,
        "0,0,0,0",
      ],
    ]);
  });

  test("what was never written to is zero", async () => {
    const script = `
      const gl = create(), side = 64, seen = [];
      const all = () => { const it = new Uint8Array(side * side * 4); gl.readPixels(0, 0, side, side, gl.RGBA, gl.UNSIGNED_BYTE, it); return Math.max(...it); };
      const attach = {
        image: it => (gl.bindTexture(gl.TEXTURE_2D, it), gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE, null), gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, it, 0)),
        layer: it => (gl.bindTexture(gl.TEXTURE_3D, it), gl.texStorage3D(gl.TEXTURE_3D, 1, gl.RGBA8, side, side, 2), gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, it, 0, 1)),
        outside: it => (gl.bindTexture(gl.TEXTURE_2D, it), gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null), gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, -9, -9, side, side, 0), gl.bindFramebuffer(gl.READ_FRAMEBUFFER, gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)), gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, it, 0)),
      };
      gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
      for (let round = 0; round < 3; round++) {
        for (const it of Object.values(attach)) { const texture = gl.createTexture(); it(texture); seen.push(all()); clear(gl, 1, 1, 1, 1); gl.deleteTexture(texture); }
        const renderbuffer = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, side, side);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, renderbuffer); seen.push(all()); clear(gl, 1, 1, 1, 1); gl.deleteRenderbuffer(renderbuffer);
        const buffer = fill(gl, gl.ARRAY_BUFFER, 4096), bytes = new Uint8Array(4096).fill(1);
        gl.getBufferSubData(gl.ARRAY_BUFFER, 0, bytes); seen.push(Math.max(...bytes)); gl.bufferSubData(gl.ARRAY_BUFFER, 0, bytes.fill(1)); gl.deleteBuffer(buffer);
      }
      return [seen.length, Math.max(...seen), gl.getError()];`;
    expect(await run(script)).toEqual([[15, 0, 0]]);
  });

  test("shaders start from zero and stay inside of their arrays", async () => {
    const script = `
      const gl = create(); cover(gl);
      return [
        "vec4 it; color = it;",
        "struct S { float a[2]; mat2 m; } s; color = vec4(s.a[1], s.m[1], global);",
        "color = vec4(float[](.2, .4, .6)[far], float[](.2, .4, .6)[-far], vec2(.8, 1)[far], mat2(1)[far][-far]);",
        "color = vec4(list[far], list[-far], float(1 / (far - 99) == 7), 1);",
        "unset(color);",
      ].map(body => {
        const program = use(gl, plain3, "#version 300 es\\nprecision highp float; uniform int far; uniform float list[2]; out vec4 color; float global; void unset(out vec4 it) {} void main() { " + body + " }");
        gl.uniform1i(gl.getUniformLocation(program, "far"), 99); gl.uniform1fv(gl.getUniformLocation(program, "list"), [0.2, 0.4]);
        clear(gl, 1, 1, 1, 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
        return read(gl);
      });`;
    expect(await run(script)).toEqual([["0,0,0,0", "0,0,0,0", "153,51,255,0", "102,51,0,255", "0,0,0,0"]]);
  });

  test("what has no defined result does not move an index out of range", async () => {
    const script = `
      const gl = create(); cover(gl);
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([9, 9, 9, 9]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, fill(gl, gl.UNIFORM_BUFFER, new Float32Array(Array.from({ length: 32 }, (_, i) => i / 255))));
      const program = use(gl, plain3, \`#version 300 es
        precision highp float; uniform int i; uniform float list[4]; uniform sampler2D s; out vec4 color;
        struct S { mat2x3 m; }; layout(std140, row_major) uniform B { mat2 a; S b[2]; };
        void main() {
          int n = 100 / (i >> 9) + (1 << i) + int(1e20 * float(i)) + 5 % (i >> 9); n /= i - 99; ivec2 v = ivec2(7) / ivec2(1, i >> 9);
          S copy = b[1];
          color = vec4(list[i] + float(n == 12345 || v.x != 7), texelFetch(s, ivec2(i), 0).r + texelFetchOffset(s, ivec2(-1), 0, ivec2(1)).r, a[1][0], copy.m[1][2] + b[0].m[0].y);
        }\`);
      gl.uniform1i(gl.getUniformLocation(program, "i"), 99); gl.uniform1fv(gl.getUniformLocation(program, "list"), [0, 0, 0, 0.2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return read(gl);`;
    expect(await run(script)).toEqual(["51,9,1,41"]);
  });

  test("instances, lists of draws and restarts stay inside of their buffers", async () => {
    const script = `
      const gl = create(), multi = gl.getExtension("WEBGL_multi_draw"); cover(gl);
      program3(gl, "flat in float v; out vec4 color; void main() { color = vec4(v); }", "#version 300 es\\n#extension GL_ANGLE_multi_draw : require\\nin vec4 at; layout(location = 1) in float a; flat out float v; void main() { gl_Position = at; v = a + float(gl_DrawID) / 255.; }");
      fill(gl, gl.ARRAY_BUFFER, Uint8Array.of(10, 20)); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.UNSIGNED_BYTE, true, 0, 0); gl.vertexAttribDivisor(1, 2);
      fill(gl, gl.ELEMENT_ARRAY_BUFFER, Uint16Array.of(0, 1, 65535, 0, 1, 2, 3));
      const drawn = draw => (clear(gl, 0, 0, 0, 0), errors(gl, draw) + " " + read(gl).split(",")[0]);
      return [
        () => gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, 4),
        () => gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, 5),
        () => gl.drawElements(gl.TRIANGLE_STRIP, 6, gl.UNSIGNED_SHORT, 0),
        () => gl.drawElements(gl.TRIANGLE_STRIP, 7, gl.UNSIGNED_SHORT, 0),
        () => gl.drawRangeElements(gl.TRIANGLES, 0, 2, 3, gl.UNSIGNED_SHORT, 8),
        () => multi.multiDrawArraysWEBGL(gl.TRIANGLES, [0, 0], 0, [3, 3], 0, 2),
        () => multi.multiDrawArraysWEBGL(gl.TRIANGLES, [0, 0], 1, [3, 3], 0, 2),
        () => multi.multiDrawElementsInstancedWEBGL(gl.TRIANGLES, [3], 0, gl.UNSIGNED_SHORT, [6], 0, [5], 0, 1),
        () => (fill(gl, gl.COPY_READ_BUFFER, 14), gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.ELEMENT_ARRAY_BUFFER, 0, 0, 2)),
        () => (gl.copyBufferSubData(gl.ELEMENT_ARRAY_BUFFER, gl.ELEMENT_ARRAY_BUFFER, 12, 6, 2), gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 6)),
        () => (gl.disableVertexAttribArray(0), gl.disableVertexAttribArray(1), gl.drawArraysInstanced(gl.POINTS, 0, 2 ** 31 - 1, 2 ** 31 - 1)),
      ].map(drawn);`;
    expect(await run(script)).toEqual([
      [
        "NO 20",
        "OPERATION 0",
        "NO 10",
        "OPERATION 0",
        "OPERATION 0",
        "NO 11",
        "OPERATION 0",
        "OPERATION 0",
        "OPERATION 0",
        "OPERATION 0",
        "OUT_OF_MEMORY 0",
      ],
    ]);
  });

  test("transform feedback stays inside of its buffers", async () => {
    const script = `
      const gl = create(), program = program3(gl, "void main() {}", "#version 300 es\\nout float a[2]; void main() { a[0] = 1.; a[1] = float(gl_VertexID); }");
      gl.transformFeedbackVaryings(program, ["a[+1]"], gl.SEPARATE_ATTRIBS); gl.linkProgram(program);
      const buffer = fill(gl, gl.COPY_READ_BUFFER, new Float32Array(6).fill(9)), seen = new Float32Array(6);
      gl.enable(gl.RASTERIZER_DISCARD); gl.bindBuffer(gl.COPY_READ_BUFFER, null); gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buffer, 4, 12);
      const first = errors(gl, () => gl.beginTransformFeedback(gl.POINTS), () => gl.drawArrays(gl.POINTS, 5, 2), () => gl.drawArrays(gl.POINTS, 0, 2), () => gl.drawArrays(gl.LINES, 0, 1), () => gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, 4, gl.STATIC_DRAW),
        () => gl.linkProgram(program), () => (gl.pauseTransformFeedback(), gl.drawArrays(gl.POINTS, 0, 9), gl.resumeTransformFeedback()), () => gl.drawArrays(gl.POINTS, 7, 1), () => gl.endTransformFeedback());
      gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, seen);
      const second = errors(gl, () => gl.beginTransformFeedback(gl.POINTS), () => gl.drawArrays(gl.POINTS, 0, 1), () => (gl.deleteBuffer(buffer), gl.deleteProgram(program)), () => gl.drawArrays(gl.POINTS, 0, 1), () => gl.endTransformFeedback(), () => gl.beginTransformFeedback(gl.POINTS));
      return [first, seen.join(), second];`;
    expect(await run(script)).toEqual([
      ["NO,NO,OPERATION,OPERATION,OPERATION,OPERATION,NO,NO,NO", "9,5,6,7,9,9", "NO,NO,NO,NO,NO,OPERATION"],
    ]);
  });

  test("what is out of range until it is used", async () => {
    const script = `
      const gl = create(); cover(gl);
      const program = program3(gl, "uniform B { vec4 a; }; out vec4 color; void main() { color = a; }"), buffer = gl.createBuffer();
      gl.bindBufferRange(gl.UNIFORM_BUFFER, 0, buffer, 256, 999);
      const sizes = [271, 272].map(it => (gl.bufferData(gl.UNIFORM_BUFFER, new Uint8Array(new Float32Array(68).fill(0.2, 64).buffer, 0, it), gl.STATIC_DRAW), errors(gl, () => gl.drawArrays(gl.TRIANGLES, 0, 3))));
      const drawn = read(gl);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture()); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 2 ** 30);
      gl.texStorage2D(gl.TEXTURE_2D, 3, gl.R8, 8, 8); gl.generateMipmap(gl.TEXTURE_2D);
      texel(gl, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 2, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, Uint8Array.of(1, 1, 1, 1, 2, 2, 2, 2)));
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, 2, 1, 2 - 2 ** 29, 0, 2 + 2 ** 29, 2 ** 31 - 1, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      const capturing = program3(gl, "void main() {}", "#version 300 es\\nout float v; void main() { v = 1.; }");
      gl.transformFeedbackVaryings(capturing, ["v"], gl.SEPARATE_ATTRIBS); gl.linkProgram(capturing);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, fill(gl, gl.COPY_READ_BUFFER, new Float32Array(4)));
      gl.beginTransformFeedback(gl.POINTS); gl.pauseTransformFeedback(); gl.useProgram(program); gl.endTransformFeedback();
      return [sizes, drawn, read(gl, 1, 3), read(gl, 2, 3), gl.getError()];`;
    expect(await run(script)).toEqual([[["OPERATION", "NO"], "51,51,51,51", "1,1,1,1", "2,2,2,2", 0]]);
  });

  test("rows that are skipped, padded or far apart", async () => {
    const script = `
      const gl = create(), bytes = Uint8Array.from({ length: 64 }, (_, i) => i);
      const store = (...all) => ["UNPACK_ROW_LENGTH", "UNPACK_SKIP_PIXELS", "UNPACK_SKIP_ROWS", "PACK_ROW_LENGTH", "PACK_SKIP_PIXELS", "PACK_SKIP_ROWS"].forEach((name, at) => gl.pixelStorei(gl[name], all[at] ?? 0));
      const upload = (width, height, source) => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
      store(3, 1, 1);
      const seen = [texel(gl, () => upload(2, 2, bytes.subarray(0, 36))), read(gl, 1, 1)];
      seen.push(errors(gl, () => upload(2, 2, bytes.subarray(0, 35)), () => upload(3, 1, bytes), () => upload(0, 0, new ImageData(2, 1)), () => (store(2 ** 29 + 16), upload(2, 1, bytes)), () => upload(2, 2, new Uint8Array(2 ** 31 + 256))));
      store(); upload(2, 2, bytes); store(0, 0, 0, 3, 1, 1);
      const into = (length, it = new Uint8Array(length).fill(99)) => errors(gl, () => gl.readPixels(1, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, it)) + " " + it.filter((_, at) => at % 4 === 0);
      seen.push(into(36), into(35));
      fill(gl, gl.PIXEL_PACK_BUFFER, new Uint8Array(40).fill(99));
      const packed = new Uint8Array(40);
      seen.push(errors(gl, () => gl.readPixels(0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, 5), () => gl.readPixels(0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, 4), () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, packed), () => gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, packed), () => gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 1, packed)));
      return [...seen, packed.filter((_, at) => at % 4 === 0).join()];`;
    expect(await run(script)).toEqual([
      [
        "16,17,18,19",
        "32,33,34,35",
        "OPERATION,OPERATION,NO,OPERATION,OPERATION",
        "NO 99,99,99,99,4,99,99,12,99",
        "OPERATION 99,99,99,99,99,99,99,99,99",
        "OPERATION,NO,OPERATION,NO,VALUE",
        "99,99,99,99,99,0,4,99,8,12",
      ],
    ]);
  });

  test("arrays that are detached, shared or resized", async () => {
    const script = `
      const gl = create(), detached = new Uint8Array(4), resized = new Uint8Array(new ArrayBuffer(8, { maxByteLength: 8 })), memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
      detached.buffer.transfer(); resized.buffer.resize(3);
      const size = data => (fill(gl, gl.ARRAY_BUFFER, data), gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE));
      clear(gl, 0, 1, 0, 1); gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      const shared = new Uint8Array(memory.buffer, 8, 4), late = new Uint8Array(4);
      return [size(detached), size(shared), ...[detached, resized, shared].map(it => errors(gl, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, it), () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, it))),
        shared.join(), errors(gl, () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, late, { valueOf: () => (late.buffer.transfer(), 0) }))];`;
    expect(await run(script)).toEqual([
      [0, 4, "OPERATION,OPERATION", "OPERATION,OPERATION", "NO,NO", "0,255,0,255", "OPERATION"],
    ]);
  });

  test("compressed textures have as many bytes as their blocks", async () => {
    const script = `
      const gl = create(), format = gl.getExtension("WEBGL_compressed_texture_etc").COMPRESSED_RGB8_ETC2; cover(gl);
      program3(gl, "uniform sampler2D s; out vec4 color; void main() { color = texelFetch(s, ivec2(5), 0); }");
      const define = (width, height, bytes) => gl.compressedTexImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, new Uint8Array(bytes).fill(255)), update = (x, y, side, bytes) => gl.compressedTexSubImage2D(gl.TEXTURE_2D, 0, x, y, side, side, format, new Uint8Array(bytes).fill(255));
      sharp(gl, gl.TEXTURE_2D, () => {});
      const seen = errors(gl, () => define(5, 5, 31), () => define(5, 5, 33), () => define(5, 5, 32), () => update(4, 4, 4, 8), () => update(1, 0, 4, 8), () => update(4, 4, 1, 8), () => gl.generateMipmap(gl.TEXTURE_2D));
      sharp(gl, gl.TEXTURE_2D, () => gl.texStorage2D(gl.TEXTURE_2D, 1, gl.getExtension("WEBGL_compressed_texture_etc").COMPRESSED_R11_EAC, 8, 8)); gl.drawArrays(gl.TRIANGLES, 0, 3);
      return [seen, read(gl)];`;
    expect(await run(script)).toEqual([["VALUE,VALUE,NO,VALUE,OPERATION,NO,OPERATION", "0,0,0,255"]]);
  });

  test("draw buffers get all their components", async () => {
    const script = `
      const attach = (gl, count) => { gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer()); return Array.from({ length: count }, (_, at) => { const it = sharp(gl, gl.TEXTURE_2D, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, Uint8Array.of(7, 7, 7, 7))); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + at, gl.TEXTURE_2D, it, 0); return it; }); };
      const colors = (gl, all) => (gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer()), all.map(it => (gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, it, 0), read(gl))));
      const old = create("webgl"), extension = old.getExtension("WEBGL_draw_buffers"), first = attach(old, 2); cover(old); old.bindTexture(old.TEXTURE_2D, null);
      extension.drawBuffersWEBGL([old.COLOR_ATTACHMENT0, old.COLOR_ATTACHMENT0 + 1]);
      use(old, plain, "void main() { gl_FragData[0] = vec4(1); }");
      const seen = [errors(old, () => old.drawArrays(old.TRIANGLES, 0, 3))];
      use(old, plain, "#extension GL_EXT_draw_buffers : require\\nvoid main() { gl_FragData[0] = vec4(1); }"); old.drawArrays(old.TRIANGLES, 0, 3);
      const gl = create(), second = attach(gl, 3); cover(gl);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
      program3(gl, "layout(location = 0) out float a; layout(location = 1) out vec2 b[2]; void main() { a = 1.; b[1] = vec2(1); }"); gl.drawArrays(gl.TRIANGLES, 0, 3);
      program3(gl, "uniform sampler2D s; layout(location = 2) out vec4 a; void main() { a = texture(s, vec2(0)); }"); gl.drawBuffers([gl.NONE, gl.NONE, gl.COLOR_ATTACHMENT2]);
      seen.push(errors(gl, () => gl.drawArrays(gl.TRIANGLES, 0, 3), () => gl.drawBuffers([gl.COLOR_ATTACHMENT1])));
      return [seen, colors(old, first), colors(gl, second)];`;
    expect(await run(script)).toEqual([
      [
        ["OPERATION", "OPERATION,OPERATION"],
        ["255,255,255,255", "0,0,0,0"],
        ["255,0,0,255", "0,0,0,255", "255,255,0,255"],
      ],
    ]);
  });

  test("what is sampled, resolved or tested before it was written", async () => {
    const script = `
      const gl = create(), seen = []; cover(gl);
      for (let round = 0; round < 3; round++) {
        program3(gl, "uniform sampler2DArray s; out vec4 color; void main() { color = texelFetch(s, ivec3(1), 0) + texelFetch(s, ivec3(1), 1) + textureLod(s, vec3(.5), 2.); }");
        const layers = sharp(gl, gl.TEXTURE_2D_ARRAY, () => (gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 8, 8, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null), gl.generateMipmap(gl.TEXTURE_2D_ARRAY), gl.texImage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 4, 4, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)));
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
        clear(gl, 1, 1, 1, 1); gl.drawArrays(gl.TRIANGLES, 0, 3); seen.push(read(gl));
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 8, 8, 2, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(512).fill(255)); gl.generateMipmap(gl.TEXTURE_2D_ARRAY); gl.deleteTexture(layers);
        gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
        const both = [[gl.RGBA8, gl.COLOR_ATTACHMENT0], [gl.DEPTH24_STENCIL8, gl.DEPTH_STENCIL_ATTACHMENT]].map(([format, point]) => { const it = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, it); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, 4, format, 4, 4); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, point, gl.RENDERBUFFER, it); return it; });
        const samples = gl.getParameter(gl.FRAMEBUFFER_BINDING), resolved = () => (texel(gl, () => gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 4, 4)), gl.bindFramebuffer(gl.READ_FRAMEBUFFER, samples), gl.blitFramebuffer(0, 0, 4, 4, 0, 0, 4, 4, gl.COLOR_BUFFER_BIT, gl.NEAREST), gl.bindFramebuffer(gl.READ_FRAMEBUFFER, gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING)), read(gl));
        seen.push(resolved());
        gl.bindFramebuffer(gl.FRAMEBUFFER, samples); gl.enable(gl.DEPTH_TEST); gl.enable(gl.STENCIL_TEST); gl.depthFunc(gl.EQUAL); gl.stencilFunc(gl.EQUAL, 0, 255);
        program3(gl, "out vec4 color; void main() { color = vec4(1); gl_FragDepth = 1.; }"); gl.drawArrays(gl.TRIANGLES, 0, 3); seen.push(resolved());
        gl.bindFramebuffer(gl.FRAMEBUFFER, samples); gl.clearBufferfi(gl.DEPTH_STENCIL, 0, 0.5, 9); gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.COLOR_ATTACHMENT0]);
        seen.push(+["0,0,0,0", "255,255,255,255"].includes(resolved()));
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.bindFramebuffer(gl.FRAMEBUFFER, null); both.forEach(it => gl.deleteRenderbuffer(it));
      }
      return [seen.join(" "), gl.getError()];`;
    expect(await run(script)).toEqual([[Array(3).fill("0,0,0,0 0,0,0,0 255,255,255,255 1").join(" "), 0]]);
  });

  test("an image that was replaced, or could not be, cannot be read as it was", async () => {
    const script = `
      const gl = create(), old = create("webgl"), image = (level, format, side, layers, data) => gl.texImage3D(gl.TEXTURE_2D_ARRAY, level, gl[format], side, side, layers, 0, gl.RGBA, format === "RGBA8" ? gl.UNSIGNED_BYTE : gl.FLOAT, data);
      cover(gl); program3(gl, "uniform sampler2DArray s; out vec4 color; void main() { color = texelFetch(s, ivec3(0), 1); }");
      const seen = [[2, 1], [4096, 16]].flatMap(([side, layers]) => {
        sharp(gl, gl.TEXTURE_2D_ARRAY, () => (image(0, "RGBA8", 2, 1, null), image(1, "RGBA8", 1, 1, new Uint8Array(4).fill(9))));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const before = read(gl);
        errors(gl, () => image(1, "RGBA32F", side, layers, null)); gl.drawArrays(gl.TRIANGLES, 0, 3);
        return [before, read(gl) === before && error(gl, () => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 1, 0, 0, 0, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))) !== "NO_ERROR"];
      });
      old.getExtension("OES_texture_float"); old.getExtension("OES_texture_float_linear");
      sharp(old, old.TEXTURE_2D, () => [2, 1].forEach((side, level) => old.texImage2D(old.TEXTURE_2D, level, old.RGB, side, side, 0, old.RGB, old.FLOAT, null)));
      return [...seen, gl.isContextLost(), errors(old, () => old.generateMipmap(old.TEXTURE_2D)) !== "OUT_OF_MEMORY", errors(old, () => old.texSubImage2D(old.TEXTURE_2D, 1, 0, 0, 1, 1, old.RGB, old.FLOAT, new Float32Array(3)))];`;
    expect(await run(script)).toEqual([["9,9,9,9", false, "9,9,9,9", false, false, true, "NO"]]);
  });

  test("what is too much is refused", async () => {
    const script = `
      const gl = create("webgl"), debug = gl.getExtension("WEBGL_debug_shaders"), shader = compile(gl, gl.VERTEX_SHADER, "attribute vec4 named; void main() { gl_Position = named; }");
      const translated = debug.getTranslatedShaderSource(shader), wide = create("webgl", {}, new OffscreenCanvas(2 ** 32 - 1, 1)), endless = create();
      const many = "uniform sampler2D s[9999]; void main() { for (int i = 0; i < 1; i++) gl_Position = texture2D(s[i" + "+i".repeat(99) + "], vec2(0)); }";
      cover(endless); endless.scissor(0, 0, 1, 1); endless.enable(endless.SCISSOR_TEST);
      program3(endless, "uniform int n; out vec4 color; void main() { while (n == 0) {} color = vec4(1); }"); endless.drawArrays(endless.TRIANGLES, 0, 3);
      return [translated.includes("gl_Position") && !translated.includes("named"), errors(gl, () => gl.shaderSource(shader, " ".repeat(2 ** 23 + 1))), debug.getTranslatedShaderSource(compile(gl, gl.VERTEX_SHADER, many)),
        wide.getError(), wide.getParameter(wide.VIEWPORT)[2] === wide.drawingBufferWidth, read(endless)];`;
    expect(await run(script)).toEqual([[true, "OUT_OF_MEMORY", "", 0, true, "255,255,255,255"]]);
  });

  test("copies stay inside of what they copy from", async () => {
    const script = `
      const gl = create(), far = 2 ** 30, pixels = Uint8Array.from({ length: 21 }, (_, i) => i);
      fill(gl, gl.PIXEL_UNPACK_BUFFER, pixels);
      texel(gl, () => (gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGB8, 3, 2), gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 3, 2, gl.RGB, gl.UNSIGNED_BYTE, 0)));
      const uploaded = [read(gl, 2, 0), read(gl, 2, 1)];
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null); clear(gl, 1, 1, 1, 1);
      gl.blitFramebuffer(1 - far, 1 - far, far, far, 2 - far, 2 - far, 1 + far, 1 + far, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      return [uploaded, [[0, 0], [1, 1], [3, 2], [3, 3]].map(it => read(gl, ...it)), gl.getError()];`;
    expect(await run(script)).toEqual([
      [["6,7,8,255", "18,19,20,255"], ["255,255,255,255", "0,1,2,255", "18,19,20,255", "255,255,255,255"], 0],
    ]);
  });

  test("shaders that are refused", async () => {
    const script = `
      const nested = (count, before, after) => "void main() { gl_FragColor = vec4(" + before.repeat(count) + "1." + after.repeat(count) + "); }";
      const doubled = count => Array.from({ length: count }, (_, i) => "#define a" + (i + 1) + " a" + i + " a" + i + "\\n").join("") + "#define a0 ;\\nvoid main() { a" + count + " }";
      const calls = count => "void f0() {}" + Array.from({ length: count }, (_, i) => "void f" + (i + 1) + "() { f" + i + "(); }").join("") + "void main() { f" + count + "(); }";
      const sources = {
        webgl: [nested(50, "(", ")"), nested(5000, "(", ")"), nested(5000, "gl_FragCoord.x + ", ""), doubled(4), doubled(40), calls(9), calls(2000),
          "void f(); void g() { f(); } void f() { g(); } void main() { f(); }", "void main() { while (true) {} }", "uniform int n; void main() { for (int i = 0; i < n; i++) {} }",
          "void main() { mediump float webgl_a; }", "void main() { mediump float a[99999999]; }", "#version 300 es\\nvoid main() {}", "#include <a>\\nvoid main() {}", "void main() { \\"a\\"; }",
          "#extension GL_OES_standard_derivatives : require\\nvoid main() {}"],
        webgl2: ["#version 300 es\\nvoid main() { while (false) {} }", "#version 310 es\\nvoid main() {}", "#version 300 es\\nuniform mediump sampler2D s[2]; uniform int i; void main() { texture(s[i], vec2(0)); }",
          "#version 300 es\\nlayout(packed) uniform A { mediump float a; }; void main() {}", "#version 300 es\\nlayout(location = 99) out mediump vec4 a; void main() {}"],
      };
      return Object.entries(sources).map(([id, all]) => { const gl = create(id); return all.map(it => +gl.getShaderParameter(compile(gl, gl.FRAGMENT_SHADER, it), gl.COMPILE_STATUS)).join(""); });`;
    expect(await run(script)).toEqual([["1001010000000000", "10000"]]);
  });

  test("an object lives for as long as the context can hand it out", async () => {
    const setup = `{${prelude}
      gl = create(); gone = 0; registry = new FinalizationRegistry(() => gone++);
      texel(gl, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null));
      gl.getParameter(gl.TEXTURE_BINDING_2D).mark = 1; gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindVertexArray((kept = gl.createVertexArray())); cover(gl); gl.getParameter(gl.ARRAY_BUFFER_BINDING).mark = 2; gl.bindVertexArray(null);
      gl.deleteProgram(use(gl, plain, "void main() {}")); gl.getParameter(gl.CURRENT_PROGRAM).mark = 3;
      for (let i = 0; i < 500; i++) registry.register(fill(gl, gl.ARRAY_BUFFER, 8));
    }`;
    const main = `
      await page.executeJavaScript(${JSON.stringify(setup)});
      page.debugger.attach();
      await until(async () => (await page.debugger.sendCommand("HeapProfiler.collectGarbage"), await page.executeJavaScript("gone > 400")));`;
    const script = `
      for (let i = 0; i < 500; i++) fill(gl, gl.ARRAY_BUFFER, 8);
      gl.bindVertexArray(kept);
      return [gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME), gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING), gl.getParameter(gl.CURRENT_PROGRAM)]
        .map(it => it.mark).concat(gl.getError());`;
    expect(await run(script, "", [], main)).toEqual([[1, 2, 3, 0]]);
  });

  test("a context is lost and restored", async () => {
    const script = `
      const gl = create("webgl", {}, a), extension = gl.getExtension("WEBGL_lose_context"), old = gl.createBuffer(), arrays = gl.getExtension("OES_vertex_array_object");
      const next = name => new Promise(resolve => a.addEventListener(name, event => (event.preventDefault(), resolve(event.constructor.name)), { once: true }));
      extension.loseContext();
      const seen = [gl.isContextLost(), error(gl, () => {}), error(gl, () => gl.enable(0)), gl.getParameter(gl.VERSION), gl.getContextAttributes(), gl.getExtension("OES_texture_float"), await next("webglcontextlost")];
      await frame();
      extension.restoreContext();
      seen.push(await next("webglcontextrestored"), gl.isContextLost(), error(gl, () => gl.bindBuffer(gl.ARRAY_BUFFER, old)), arrays === gl.getExtension("OES_vertex_array_object"));
      clear(gl, 0, 1, 0, 1); await frame(); await frame();
      const many = Array.from({ length: 17 }, () => create());
      return [seen, [gl, ...many].map(it => +it.isContextLost()).join("")];`;
    expect(await run(script, "<canvas id=a width=9 height=9></canvas>")).toEqual([
      [
        [
          true,
          "CONTEXT_LOST_WEBGL",
          "NO_ERROR",
          null,
          null,
          null,
          "WebGLContextEvent",
          "WebGLContextEvent",
          false,
          "INVALID_OPERATION",
          false,
        ],
        "11" + "0".repeat(16),
      ],
    ]);
  });

  test("textures are made from what the page may read, as it is", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"), {
          headers: { "content-type": "image/gif" },
        }),
    });
    const script = `
      const gl = create(), upload = it => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, it), from = it => texel(gl, () => upload(it));
      const foreign = new Image(); foreign.src = ${JSON.stringify(server.url.href)}; await foreign.decode();
      const tainted = new OffscreenCanvas(1, 1); tainted.getContext("2d").drawImage(foreign, 0, 0);
      const data = new ImageData(new Uint8ClampedArray([255, 192, 128, 1, 9, 8, 7, 0]), 1), straight = { premultiplyAlpha: "none" };
      const drawn = create("webgl", { premultipliedAlpha: false }); clear(drawn, 1, 192 / 255, 128 / 255, 1 / 255);
      const file = await drawn.canvas.convertToBlob(), image = new Image(); image.src = URL.createObjectURL(file); await image.decode();
      const flipped = await createImageBitmap(data, { ...straight, imageOrientation: "flipY" }), closed = await createImageBitmap(data); closed.close();
      const exact = [data, drawn.canvas, image, ...(await Promise.all([data, file, image].map(it => createImageBitmap(it, straight))))].map(from);
      const moved = structuredClone(flipped, { transfer: [flipped] }), shown = new OffscreenCanvas(1, 2).getContext("2d"); shown.drawImage(moved, 0, 0);
      const others = [from(moved), shown.getImageData(0, 0, 1, 1).data.join(), from(await createImageBitmap(data))];
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); others.push(from(data), from(moved));
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); others.push(from(data), from(moved));
      return [exact, others, [foreign, tainted, await createImageBitmap(foreign), closed, new Image()].map(it => error(gl, () => upload(it)))];`;
    expect(await run(script)).toEqual([
      [
        Array(6).fill("255,192,128,1"),
        ["9,8,7,0", "0,0,0,0", "1,1,1,1", "1,1,1,1", "9,8,7,0", "9,8,7,0", "9,8,7,0"],
        ["SecurityError", "SecurityError", "SecurityError", "INVALID_VALUE", "INVALID_VALUE"],
      ],
    ]);
  });

  test.each(["webgl", "webgl2"])("%s answers the same whether it has to ask or not", async id => {
    const script = `
      let seed = 1;
      const random = list => list[(seed = (seed * 48271) % 0x7fffffff) % list.length];
      const [gl, other] = [create("${id}"), create("${id}")], names = Object.keys(Object.getPrototypeOf(gl)), three = make => [null, make(), make(), make()];
      const make = { Buffer: () => gl.createBuffer(), Texture: () => gl.createTexture(), Framebuffer: () => gl.createFramebuffer(), Renderbuffer: () => gl.createRenderbuffer(), Program: () => use(gl, plain, "uniform lowp vec4 a; void main() { gl_FragColor = a; }") };
      if (gl.createVertexArray) make.VertexArray = () => gl.createVertexArray();
      const all = Object.fromEntries(Object.entries(make).map(([kind, make]) => [kind, three(make)])), constant = pattern => gl[random(names.filter(it => pattern.test(it)))];
      const factor = () => constant(/^(ZERO|ONE|BLEND|SRC_ALPHA_SATURATE|(ONE_MINUS_)?(SRC|DST|CONSTANT)_(COLOR|ALPHA))$/), size = () => random([-1, 0, 5, 4096, 99999]), flag = () => random([true, false]);
      const steps = [
        () => gl.activeTexture(gl.TEXTURE0 + random([0, 1, 20, 999])), () => gl.bindBuffer(constant(/ARRAY_BUFFER$|^BLEND$/), random([...all.Buffer, other.createBuffer()])),
        () => gl.bindTexture(constant(/^TEXTURE_(2D|3D|CUBE_MAP|2D_ARRAY)$/), random(all.Texture)), () => gl.bindFramebuffer(constant(/FRAMEBUFFER$/), random(all.Framebuffer)),
        () => gl.bindRenderbuffer(gl.RENDERBUFFER, random(all.Renderbuffer)), () => gl.useProgram(random(all.Program)), () => gl.bindVertexArray?.(random(all.VertexArray)),
        () => gl[random(["enable", "disable"])](constant(/_TEST$|^(BLEND|CULL_FACE|DITHER|VIEWPORT|RASTERIZER_DISCARD)$/)), () => gl[random(["viewport", "scissor"])](size(), size(), size(), size()),
        () => gl.blendFunc(factor(), factor()), () => gl.blendFuncSeparate(factor(), factor(), factor(), factor()), () => gl.blendEquationSeparate(constant(/^FUNC_|^M(IN|AX)$/), constant(/^FUNC_|^ONE$/)),
        () => gl.colorMask(flag(), flag(), flag(), flag()), () => gl.depthMask(flag()), () => gl.depthFunc(constant(/EQUAL$|^BLEND$/)), () => gl.cullFace(constant(/^FRONT|^BACK$/)), () => gl.frontFace(constant(/^C?CW$|^BLEND$/)),
        () => { const [kind, list] = random(Object.entries(all)), at = random([1, 2, 3]); gl["delete" + kind](list[at]); if (flag()) list[at] = make[kind](); },
        () => { const it = random(all.Program); if (gl.isProgram(it)) gl.getAttachedShaders(it).forEach(shader => flag() && flag() && gl.detachShader(it, shader)), gl.linkProgram(it); },
      ];
      const asked = names.filter(it => /BINDING|_TEST$|^BLEND($|_[ESD])|^(ACTIVE_TEXTURE|CURRENT_PROGRAM|VIEWPORT|SCISSOR_BOX|CULL_FACE.*|DITHER|FRONT_FACE|DEPTH_FUNC|RASTERIZER_DISCARD|(COLOR|DEPTH)_WRITEMASK)$/.test(it));
      const state = () => asked.map(it => gl.getParameter(gl[it])).map(it => (it?.length ? String(it) : it)).concat(all.Program.map(it => it && [!gl.getUniformLocation(it, "a"), gl.getAttribLocation(it, "at")].join()));
      for (let round = 0; round < 30; round++) {
        state();
        for (let i = 0; i < 6; i++) random(steps)(), flag() && gl.getParameter(gl[random(asked)]);
        const recalled = state();
        for (let i = 0; i < 300; i++) gl.flush();
        const wrong = state().findIndex((it, at) => it !== recalled[at]);
        if (wrong >= 0) return [round, asked[wrong] ?? wrong];
      }`;
    expect(await run(script)).toEqual([null]);
  });

  test("the options of a context that exists", async () => {
    const script = `
      const reads = id => { let count = 0; const canvas = new OffscreenCanvas(1, 1); for (const _ of [1, 2]) canvas.getContext(id, { get alpha() { return ++count; } }); return count; };
      return [reads("2d"), reads("webgl")];`;
    expect(await run(script)).toEqual([[2, 1]]);
  });

  test("colors of Display P3", async () => {
    const script = `
      const gl = create(), wide = new OffscreenCanvas(1, 1).getContext("2d", { colorSpace: "display-p3" });
      const copy = () => (wide.drawImage(gl.canvas, 0, 0), wide.getImageData(0, 0, 1, 1).data.join());
      clear(gl, 1, 0, 0, 1);
      const seen = [copy()];
      gl.drawingBufferColorSpace = "display-p3"; clear(gl, 1, 0, 0, 1);
      seen.push(copy());
      const upload = () => texel(gl, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, new ImageData(Uint8ClampedArray.of(255, 0, 0, 255), 1)));
      seen.push(upload());
      gl.unpackColorSpace = "display-p3";
      return [...seen, upload()];`;
    expect(await run(script)).toEqual([["234,51,35,255", "255,0,0,255", "255,0,0,255", "234,51,35,255"]]);
  });

  test("invalidating a part leaves the rest", async () => {
    const script = `
      const gl = create("webgl2", { preserveDrawingBuffer: true });
      clear(gl, 0, 1, 0, 1); gl.invalidateSubFramebuffer(gl.FRAMEBUFFER, [gl.COLOR], 1, 1, 4, 4);
      return [read(gl), error(gl, () => gl.invalidateSubFramebuffer(gl.FRAMEBUFFER, [gl.COLOR], 0, 0, -1, 4))];`;
    expect(await run(script)).toEqual([["0,255,0,255", "INVALID_VALUE"]]);
  });

  test("a number that comes back is a number", async () => {
    const script = `
      const gl = create(), program = use(gl, plain, "uniform highp float a; void main() { gl_FragColor = vec4(a); }"), location = gl.getUniformLocation(program, "a");
      return [0xffffffff, 0xfff00001, 0x7fffffff].map(bits => (gl.uniform1fv(location, new Float32Array(new Uint32Array([bits]).buffer)), String(gl.getUniform(program, location))));`;
    expect(await run(script)).toEqual([["NaN", "NaN", "NaN"]]);
  });

  test("the GPU gets nowhere during a task", async () => {
    const script = `
      const gl = create(), query = gl.createQuery(); use(gl, plain, "void main() { gl_FragColor = vec4(1); }"); cover(gl);
      gl.beginQuery(gl.ANY_SAMPLES_PASSED, query); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.endQuery(gl.ANY_SAMPLES_PASSED);
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      const poll = () => [gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE), gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.SIGNALED, gl.clientWaitSync(sync, 0, 0) !== gl.TIMEOUT_EXPIRED];
      const early = (read(gl), poll()).concat((read(gl), poll()));
      do await frame(); while (poll().includes(false));
      const result = gl.getQueryParameter(query, gl.QUERY_RESULT);
      const deleted = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.clientWaitSync(deleted, 0, 0); gl.deleteSync(deleted);
      return [early.includes(true), result, gl.clientWaitSync(deleted, 0, 0) === gl.WAIT_FAILED];`;
    expect(await run(script)).toEqual([[false, 1, true]]);
  });

  test("the app can turn it off", async () => {
    const main = `
      const ask = async webPreferences => {
        const other = new BrowserWindow({ webPreferences });
        await other.loadFile("index.html");
        return other.webContents.executeJavaScript(\`new Promise(resolve => {
          const canvas = document.createElement("canvas"), seen = []; canvas.addEventListener("webglcontextcreationerror", event => seen.push(event.type));
          const frame = document.body.appendChild(document.createElement("iframe")), { OffscreenCanvas } = frame.contentWindow; frame.remove();
          seen.push(!!canvas.getContext("webgl"), !!canvas.getContext("2d"));
          new Worker(URL.createObjectURL(new Blob(['postMessage(!!new OffscreenCanvas(1, 1).getContext("webgl2"))']))).onmessage = event => resolve([...seen, event.data, !!new OffscreenCanvas(1, 1).getContext("webgl")].join());
        })\`);
      };
      const seen = [await ask({}), await ask({ webgl: false }), app.getGPUFeatureStatus().webgl];
      app.disableHardwareAcceleration();
      seen.push(await ask({}), app.getGPUFeatureStatus().webgl);
      await page.executeJavaScript("seen = " + JSON.stringify(seen));`;
    const off = "webglcontextcreationerror,false,true,false,false";
    expect(await run("return seen", "", [], main)).toEqual([
      ["true,false,true,true", off, "enabled", off, "disabled_off"],
    ]);
  });

  test.skipIf(!isLinux)("the driver is loaded when it is asked for", async () => {
    const main = `
      const isLoaded = () => require("fs").readFileSync("/proc/self/maps", "utf8").includes("libEGL");
      await page.executeJavaScript("a.getContext('2d').fillRect(0, 0, 9, 9); WebGL2RenderingContext.TEXTURE_2D; new Promise(requestAnimationFrame)");
      const before = isLoaded();
      await page.executeJavaScript("void new OffscreenCanvas(1, 1).getContext('webgl')");
      await page.executeJavaScript("seen = " + JSON.stringify([before, isLoaded()]));`;
    expect(await run("return seen", "<canvas id=a></canvas>", [], main)).toEqual([[false, !hasSandbox]]);
  });

  const processes = `
    const read = (pid, name) => require("fs").readFileSync("/proc/" + pid + "/" + name, "latin1");
    const find = () => require("fs").readdirSync("/proc/self/task").flatMap(it => read("self", "task/" + it + "/children").split(" ")).filter(it => it && read(it, "cmdline").includes("=gpu"));
    await page.executeJavaScript(${JSON.stringify(`${prelude}
      const gl = create("webgl", {}, a), next = name => new Promise(resolve => a.addEventListener(name, event => resolve(event.preventDefault()), { once: true }));
      const both = [next("webglcontextlost"), next("webglcontextrestored")];
      const again = async () => { let isOver; for (Promise.all(both).then(() => (isOver = true)); !isOver; await frame()) gl.flush(); clear(gl, 0, 1, 0, 1); return read(gl); }; 0`)});
    const [first] = find();`;
  const withProcesses = (main: string) =>
    renderTo(
      "memory",
      "<canvas id=a></canvas>",
      "return seen",
      [],
      1,
      `${processes}${main}; await page.executeJavaScript("seen = " + JSON.stringify(seen));`,
      { BUN_DESKTOP_WEBGL: "1", BUN_DESKTOP_PAGE_PROCESSES: "1" },
    );

  test.if(hasSandbox)("the driver is in a sandbox of its own, and can crash", async () => {
    const main = `
      const seen = [/Seccomp:\\s2/.test(read(first, "status")), read(first, "maps").includes("libEGL"), read(page.getOSProcessId(), "maps").includes("libEGL")];
      process.kill(first, "SIGKILL");
      seen.push(await page.executeJavaScript("again()"), find()[0] !== first, page.isCrashed())`;
    expect(await withProcesses(main)).toEqual([[true, true, false, "0,255,0,255", true, false]]);
  });

  test.if(hasSandbox)("a driver that hangs is replaced", async () => {
    const main = `
      process.kill(first, "SIGSTOP");
      const seen = [await page.executeJavaScript("const other = create(); clear(other, 0, 0, 1, 1); read(other)"), find().map(it => it === first), await page.executeJavaScript("again()")]`;
    expect(await withProcesses(main)).toEqual([["0,0,255,255", [false], "0,255,0,255"]]);
  });

  test.skipIf(!isLinux)("there is none in a process that cannot make memory executable", async () => {
    const main = `
      const libc = require("bun:ffi").dlopen(${JSON.stringify(libcPathForDlopen())}, { prctl: { args: ["i32", "u64", "u64", "u64", "u64"], returns: "i32" } });
      const PR_SET_MDWE = 65;
      await page.executeJavaScript("isRefused = " + (libc.symbols.prctl(PR_SET_MDWE, 1, 0, 0, 0) === 0));`;
    expect(await run("return (create() === null) === isRefused", "", [], main)).toEqual([true]);
  });
});

test.skipIf(!hasLibrary || (hasOpenGL && existsSync("/dev/dri")))("there is no WebGL without a GPU", async () => {
  expect(await renderTo("memory", "", `return new OffscreenCanvas(1, 1).getContext("webgl")`)).toEqual([null]);
});
