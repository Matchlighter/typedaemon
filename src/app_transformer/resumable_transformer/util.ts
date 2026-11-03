/**
 * Copyright (c) 2014-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { types, NodePath } from "@babel/core";
import type { Binding } from "@babel/traverse";

export type BabelTypes = typeof types;

let currentTypes = null;

export function wrapWithTypes<T extends (...args: any[]) => any>(types: any, fn: T): T {
  return function (...args) {
    const oldTypes = currentTypes;
    currentTypes = types;
    try {
      return fn.apply(this, args);
    } finally {
      currentTypes = oldTypes;
    }
  } as any;
}

export function getTypes() {
  return currentTypes;
}

export function runtimeProperty(name) {
  const t = getTypes();
  return t.memberExpression(
    t.identifier("_regen_executor"),
    t.identifier(name),
    false
  );
}

// Whether an Identifier names a variable (read, write, pattern target or declaration), as opposed to
// a property/member key or a label, which merely share the spelling.
export function isVariableUse(path) {
  const { node, parent } = path;
  switch (parent.type) {
    case "MemberExpression":
    case "OptionalMemberExpression":
      return parent.object === node || parent.computed;
    case "ObjectProperty":
    case "ObjectMethod":
    case "ClassProperty":
    case "ClassAccessorProperty":
    case "ClassMethod":
      return parent.key !== node || parent.computed;
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return parent.label !== node;
    case "MetaProperty":
      return false;
  }
  return true;
}

export function replaceWithOrRemove(path, replacement) {
  if (replacement) {
    path.replaceWith(replacement)
  } else {
    path.remove();
  }
}

/**
 * Every use (see `isVariableUse`) under `root` of one of `bindings`, with the binding it resolves to. Uses in nested
 * functions are included; a nested declaration shadowing the name is not one.
 */
export function findBindingUses(root: NodePath, bindings: { has(b: Binding): boolean }) {
  const uses: { path: NodePath<types.Identifier>, binding: Binding }[] = [];
  root.traverse({
    Identifier(path) {
      if (!isVariableUse(path)) return;
      const binding = path.scope.getBinding(path.node.name);
      if (binding && bindings.has(binding)) uses.push({ path, binding });
    },
  });
  return uses;
}

/** Replaces a use of a variable (see `isVariableUse`) with `expr`, unfolding a shorthand `{ x }`/`{ x = d }` to `{ x: expr }` */
export function replaceVariableUse(path: NodePath<types.Identifier>, expr: types.Expression) {
  const t = getTypes();
  const prop: any = t.isAssignmentPattern(path.parent) && path.key === "left" ? path.parentPath.parent : path.parent;
  if (t.isObjectProperty(prop) && prop.shorthand) prop.shorthand = false;
  path.replaceWith(expr);
}
