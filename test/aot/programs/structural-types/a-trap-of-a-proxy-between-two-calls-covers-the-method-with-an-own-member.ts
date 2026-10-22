class Plain {
  value = 1;
  extra?: number = 2;
}

function trapped(handler: ProxyHandler<Plain>): Plain {
  return new Proxy(new Plain(), handler);
}

const nothing = (): void => {};

function drive<T extends { norm(): number }>(label: string, p: T, run: (p: T, fire: () => void) => string): void {
  let warm = 0;
  for (let i = 0; i < 2000; i++) warm += run(p, nothing).length;
  const change = (): void => {
    p.norm = () => -1;
  };
  const parts = [String(warm), run(p, nothing), run(p, change), run(p, nothing)];
  Reflect.deleteProperty(p, "norm");
  parts.push(run(p, nothing));
  console.log(label + ": " + parts.join(" | "));
}

class UnderGetTrap {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underGetTrap(p: UnderGetTrap, fire: () => void): string {
  const before = p.norm();
  const made = trapped({
    get(target, key, receiver) {
      fire();
      return Reflect.get(target, key, receiver);
    },
  }).value;
  return before + " " + String(made) + " " + p.norm();
}

drive("get", new UnderGetTrap(), underGetTrap);

class UnderSetTrap {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underSetTrap(p: UnderSetTrap, fire: () => void): string {
  const before = p.norm();
  const made = (trapped({
    set(target, key, value, receiver) {
      fire();
      return Reflect.set(target, key, value, receiver);
    },
  }).value = 5);
  return before + " " + String(made) + " " + p.norm();
}

drive("set", new UnderSetTrap(), underSetTrap);

class UnderHasTrap {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underHasTrap(p: UnderHasTrap, fire: () => void): string {
  const before = p.norm();
  const made =
    "value" in
    trapped({
      has(target, key) {
        fire();
        return Reflect.has(target, key);
      },
    });
  return before + " " + String(made) + " " + p.norm();
}

drive("has", new UnderHasTrap(), underHasTrap);

class UnderDeleteTrap {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underDeleteTrap(p: UnderDeleteTrap, fire: () => void): string {
  const before = p.norm();
  const made = delete trapped({
    deleteProperty(target, key) {
      fire();
      return Reflect.deleteProperty(target, key);
    },
  }).extra;
  return before + " " + String(made) + " " + p.norm();
}

drive("deleteProperty", new UnderDeleteTrap(), underDeleteTrap);

class UnderOwnKeysTrap {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underOwnKeysTrap(p: UnderOwnKeysTrap, fire: () => void): string {
  const before = p.norm();
  const made = Object.keys(
    trapped({
      ownKeys(target) {
        fire();
        return Reflect.ownKeys(target);
      },
    }),
  ).length;
  return before + " " + String(made) + " " + p.norm();
}

drive("ownKeys, by Object.keys", new UnderOwnKeysTrap(), underOwnKeysTrap);

class UnderForIn {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underForIn(p: UnderForIn, fire: () => void): string {
  const before = p.norm();
  let made = 0;
  for (const key in trapped({
    ownKeys(target) {
      fire();
      return Reflect.ownKeys(target);
    },
  }))
    made += key.length;
  return before + " " + String(made) + " " + p.norm();
}

drive("ownKeys, by for-in", new UnderForIn(), underForIn);

class UnderPrototypeTrap {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underPrototypeTrap(p: UnderPrototypeTrap, fire: () => void): string {
  const before = p.norm();
  const made =
    trapped({
      getPrototypeOf(target) {
        fire();
        return Reflect.getPrototypeOf(target);
      },
    }) instanceof Plain;
  return before + " " + String(made) + " " + p.norm();
}

drive("getPrototypeOf, by instanceof", new UnderPrototypeTrap(), underPrototypeTrap);

class UnderDescriptorTrap {
  n = 1;
  norm(): number {
    return this.n;
  }
}

function underDescriptorTrap(p: UnderDescriptorTrap, fire: () => void): string {
  const before = p.norm();
  const made = {
    ...trapped({
      getOwnPropertyDescriptor(target, key) {
        fire();
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    }),
  }.value;
  return before + " " + String(made) + " " + p.norm();
}

drive("getOwnPropertyDescriptor, by a spread", new UnderDescriptorTrap(), underDescriptorTrap);

export {};
