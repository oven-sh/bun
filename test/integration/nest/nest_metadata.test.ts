import "reflect-metadata";

import { Inject, Injectable } from "@nestjs/common";
import { NestContainer } from "@nestjs/core";

import { PARAMTYPES_METADATA, SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants";
import { InstanceWrapper } from "@nestjs/core/injector/instance-wrapper";
import { Module } from "@nestjs/core/injector/module";

import { beforeEach, describe, expect, it } from "bun:test";

describe("Reflect metadata for nestjs", () => {
  @Injectable()
  class DependencyOne {}

  @Injectable()
  class DependencyTwo {}

  @Injectable()
  class MainTest {
    @Inject() property: DependencyOne;

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
});
