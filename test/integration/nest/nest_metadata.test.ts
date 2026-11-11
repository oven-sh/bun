import "reflect-metadata";

import { Inject, Injectable } from "@nestjs/common";
import { NestContainer } from "@nestjs/core";

import { PARAMTYPES_METADATA, SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants";
import { InstanceWrapper } from "@nestjs/core/injector/instance-wrapper";
import { Module } from "@nestjs/core/injector/module";

import { beforeEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";

describe("Reflect metadata for nestjs", () => {
  @Injectable()
  class DependencyOne {}

  @Injectable()
  class DependencyTwo {}

  @Injectable()
  class MainTest {
    @Inject() property!: DependencyOne;

    constructor(
      public one: DependencyOne,
      @Inject() public two: DependencyTwo,
    ) {}
  }

  let moduleDeps: Module;
  let mainTest, depOne, depTwo;

  beforeEach(() => {
    moduleDeps = new Module(DependencyTwo, new NestContainer());
    mainTest = new InstanceWrapper({
      name: "MainTest",
      token: "MainTest",
      metatype: MainTest,
      instance: Object.create(MainTest.prototype),
      isResolved: false,
    });
    depOne = new InstanceWrapper({
      name: DependencyOne,
      token: DependencyOne,
      metatype: DependencyOne,
      instance: Object.create(DependencyOne.prototype),
      isResolved: false,
    });
    depTwo = new InstanceWrapper({
      name: DependencyTwo,
      token: DependencyTwo,
      metatype: DependencyTwo,
      instance: Object.create(DependencyTwo.prototype),
      isResolved: false,
    });
    moduleDeps.providers.set("MainTest", mainTest);
    moduleDeps.providers.set(DependencyOne, depOne);
    moduleDeps.providers.set(DependencyTwo, depTwo);
    moduleDeps.providers.set("MainTestResolved", {
      ...mainTest,
      isResolved: true,
    });
  });

  it("Should be return self:paramtypes from class constructor", () => {
    const selfParamtypes = Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, mainTest.metatype);

    expect(selfParamtypes).toStrictEqual([{ index: 1, param: DependencyTwo }]);
  });

  it("Should be return design:paramtypes from class constructor", () => {
    const designParamtypes = [...(Reflect.getMetadata(PARAMTYPES_METADATA, mainTest.metatype) || [])];

    expect(designParamtypes).toStrictEqual([DependencyOne, DependencyTwo]);
  });

  // With `useDefineForClassFields: false` Bun adds a constructor for the assigned fields. It has no
  // `design:paramtypes`, as in what tsc emits, so the injector of Nest reads the ones of the parent class.
  it("Should return design:paramtypes of the parent for a subclass without a constructor", async () => {
    using dir = tempDir("nest-subclass", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { useDefineForClassFields: false, experimentalDecorators: true, emitDecoratorMetadata: true },
      }),
      "index.ts": `
        import "reflect-metadata";
        import { PARAMTYPES_METADATA } from "@nestjs/common/constants";

        function Injectable(): ClassDecorator {
          return () => {};
        }

        @Injectable()
        class Dependency {}
        @Injectable()
        class Parent {
          constructor(public dependency: Dependency) {}
        }
        @Injectable()
        class AssignsField extends Parent {
          label = "x";
        }
        @Injectable()
        class FieldWithoutValue extends Parent {
          label?: string;
        }

        // What the injector of Nest asks for the parameters of a constructor.
        const reflected = (type: Function) =>
          (Reflect.getMetadata(PARAMTYPES_METADATA, type) ?? []).map((param: Function) => param.name);
        console.log(JSON.stringify({
          parent: reflected(Parent),
          assignsField: reflected(AssignsField),
          fieldWithoutValue: reflected(FieldWithoutValue),
        }));
      `,
    });
    symlinkSync(join(import.meta.dir, "..", "..", "node_modules"), join(String(dir), "node_modules"), "junction");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      parent: ["Dependency"],
      assignsField: ["Dependency"],
      fieldWithoutValue: ["Dependency"],
    });
    expect(exitCode).toBe(0);
  });
});
