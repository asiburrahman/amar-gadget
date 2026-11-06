import merge from "deepmerge";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const variants: [string, typeof merge][] = [["CommonJS", merge], ["UMD", jest.requireActual("deepmerge/dist/umd.js") as typeof merge]];
const payload = () => JSON.parse('{"__proto__":{"inheritedPrivilege":true},"safe":1}') as Record<string, unknown>;

it("reproduces the published poisoning path in the unpatched reference implementation", () => {
  const patched = readFileSync(require.resolve("deepmerge"), "utf8");
  // Reconstruct the original assignment only inside an isolated test context.
  // No vulnerable implementation is shipped as an application fallback.
  const reference = patched.replace(/Object\.defineProperty\(destination, key, \{ value: (.+), enumerable: true, configurable: true, writable: true \}\)/g, "destination[key] = $1");
  expect(reference).not.toBe(patched);
  const sandbox = { module: { exports: {} } };
  runInNewContext(reference, sandbox);
  const original = sandbox.module.exports as typeof merge;
  const result = original(Object.create(null) as Record<string, unknown>, payload());
  expect(result.inheritedPrivilege).toBe(true);
  expect(Object.prototype.hasOwnProperty.call(result, "inheritedPrivilege")).toBe(false);
});

describe.each(variants)("%s vendor hardening", (_name, implementation) => {
  it("preserves data without allowing source or target keys to change the result prototype", () => {
    for (const targetSide of [false, true]) {
      const nullTarget = Object.assign(Object.create(null) as Record<string, unknown>, targetSide ? payload() : {});
      const result = implementation(nullTarget, targetSide ? {} : payload());
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(result.inheritedPrivilege).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(result, "__proto__")).toBe(true);
      expect((result.__proto__ as Record<string, unknown>).inheritedPrivilege).toBe(true);
    }
    const ownedTarget = Object.assign(Object.create(null) as Record<string, unknown>, payload());
    const recursivelyMerged = implementation(ownedTarget, payload());
    expect(Object.getPrototypeOf(recursivelyMerged)).toBe(Object.prototype);
    expect(recursivelyMerged.inheritedPrivilege).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(recursivelyMerged, "__proto__")).toBe(true);
  });

  it("hardens nested null-prototype merges and preserves normal merge/descriptor behavior", () => {
    const result = implementation({ nested: Object.create(null) as Record<string, unknown>, list: [1] }, { nested: payload(), list: [2] });
    expect(result.nested.inheritedPrivilege).toBeUndefined();
    expect(Object.getPrototypeOf(result.nested)).toBe(Object.prototype);
    expect(result.list).toEqual([1, 2]);
    expect(Object.getOwnPropertyDescriptor(result.nested, "safe")).toEqual({ value: 1, writable: true, configurable: true, enumerable: true });
  });
});
