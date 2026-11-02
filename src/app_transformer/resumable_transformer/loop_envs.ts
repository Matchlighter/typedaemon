// @ts-nocheck
import * as util from "./util";

/**
 * Hoisting flattens every binding into one shared `state.<name>`, which loses JS's per-iteration
 * binding identity for closures created in loops (td-8tr). For each loop-scoped let/const that a
 * nested function references, this moves the binding into a per-iteration env object (`_env.x`):
 * - declared in a block inside a loop (incl. a for-of/in head): a fresh `_env = {}` at each block entry
 * - declared in a classic `for` head: created before the loop, copied (`_env = { ..._env }`) before each update
 * Each capturing closure is wrapped as `((_env) => fn)(_env)`, so it keeps the env of the iteration it was
 * created in, shared with the loop body for that iteration. `_env` is itself an ordinary (serializable)
 * hoisted binding. Loops without capturing closures are left untouched.
 *
 * Limitation: closures that can't be wrapped as an expression (object/class methods) fall back to reading the
 * hoisted env, i.e. the latest iteration's.
 */
export function materializeLoopEnvs(funPath, ownBindings: Set<any>) {
  const t = util.getTypes();
  const fnNode = funPath.node;
  const parentFn = (p) => p.getFunctionParent()?.node;
  const inLoop = (p) => !!p.findParent(q => q.node === fnNode || q.isLoop())?.isLoop();

  // Where a fresh env lives for `binding`: a block, a for-of/in (its body), or a classic for head
  function envOwner(binding) {
    if (binding.kind !== "let" && binding.kind !== "const") return null;
    const sp = binding.scope.path;
    if (sp.isForStatement()) return sp;
    if (sp.isForXStatement()) {
      const body = sp.get("body");
      return body.isBlockStatement() ? body : sp;
    }
    if (sp.isBlockStatement() && inLoop(sp)) return sp;
    if (sp.isCatchClause() && inLoop(sp)) return sp.get("body");
    return null;
  }

  const isCaptured = (binding) =>
    [...binding.referencePaths, ...binding.constantViolations].some(p => parentFn(p) !== fnNode);

  // owner node -> env; binding -> env
  const envs = new Map();
  const envOf = new Map();
  const getEnv = (owner) => {
    let env = envs.get(owner.node);
    if (!env) envs.set(owner.node, env = { owner, id: funPath.scope.generateUidIdentifier("env"), heads: [], decls: new Set() });
    return env;
  };

  // A captured binding pulls in every binding of the same declarator (a pattern is rewritten as a whole),
  // or the whole loop head
  for (const binding of ownBindings) {
    if (envOf.has(binding) || !isCaptured(binding)) continue;
    const owner = envOwner(binding);
    if (!owner) continue;
    const env = getEnv(owner);
    const decl = binding.path.parentPath; // VariableDeclaration
    const declarators = binding.scope.path.isFor() ? decl.get("declarations") : [binding.path];
    for (const dec of declarators) {
      for (const name of Object.keys(dec.getBindingIdentifiers())) {
        const b = dec.scope.getBinding(name);
        if (b) envOf.set(b, env);
      }
      env.decls.add(dec);
    }
    if (binding.scope.path.isFor() && !env.heads.includes(decl)) env.heads.push(decl);
  }
  if (envs.size === 0) return;

  const envMember = (env, name) => t.memberExpression(t.cloneNode(env.id), t.identifier(name));

  // Rewrite every reference/write to `_env.name`, noting the outermost closure each capture sits in
  const closures = new Map(); // fn node -> { path, envs: Set }
  for (const [binding, env] of envOf) {
    const name = binding.identifier.name;
    const idPaths = [...binding.referencePaths];
    for (const v of binding.constantViolations) {
      const lhs = v.isUpdateExpression() ? v.get("argument") : (v.isAssignmentExpression() || v.isForXStatement()) ? v.get("left") : null;
      if (!lhs) continue;
      if (lhs.isIdentifier()) idPaths.push(lhs);
      else lhs.traverse({
        Identifier(p) {
          if (p.node.name === name && util.isVariableUse(p) && p.scope.getBinding(name) === binding) idPaths.push(p);
        },
      });
    }
    for (const p of idPaths) {
      if (p.node.name !== name) continue; // already rewritten
      let fn = p.getFunctionParent();
      if (fn.node !== fnNode) {
        while (parentFn(fn.parentPath) !== fnNode) fn = fn.parentPath.getFunctionParent();
        if (!closures.has(fn.node)) closures.set(fn.node, { path: fn, envs: new Set() });
        closures.get(fn.node).envs.add(env);
      }
      if (t.isObjectProperty(p.parent) && p.parent.shorthand) p.parent.shorthand = false;
      p.replaceWith(envMember(env, name));
    }
    binding.scope.removeBinding(name);
  }

  // Statements to put at the top of a block: env creation, then wrapped function declarations
  const preludes = new Map(); // block node -> { path, stmts }
  const prelude = (block) => {
    if (!preludes.has(block.node)) preludes.set(block.node, { path: block, stmts: [], fns: [] });
    return preludes.get(block.node);
  };

  for (const { path: fn, envs: fnEnvs } of closures.values()) {
    const ids = [...fnEnvs].map(e => e.id);
    const wrap = (expr) => t.callExpression(
      t.arrowFunctionExpression(ids.map(id => t.cloneNode(id)), expr),
      ids.map(id => t.cloneNode(id)),
    );
    if (fn.isArrowFunctionExpression() || fn.isFunctionExpression()) {
      fn.replaceWith(wrap(fn.node));
    } else if (fn.isFunctionDeclaration() && fn.parentPath.isBlockStatement()) {
      // Function declarations are hoisted to their block's top; keep that, after the block's env creation
      const { node } = fn;
      const expr = t.functionExpression(node.id, node.params, node.body, node.generator, node.async);
      prelude(fn.parentPath).fns.push(t.variableDeclaration("const", [t.variableDeclarator(t.cloneNode(node.id), wrap(expr))]));
      fn.scope.removeBinding(node.id.name);
      fn.remove();
    }
    // else: a method; reads the hoisted env (latest iteration)
  }

  // `PAT = init` with each env binding of PAT as `_env.name`
  function toEnvTarget(node) {
    switch (node.type) {
      case "Identifier": {
        const env = [...envOf].find(([b]) => b.identifier === node)?.[1];
        return env ? envMember(env, node.name) : t.identifier(node.name);
      }
      case "ObjectPattern":
        return t.objectPattern(node.properties.map(p => t.isRestElement(p)
          ? t.restElement(toEnvTarget(p.argument))
          : t.objectProperty(p.key, toEnvTarget(p.value), p.computed, false)));
      case "ArrayPattern": return t.arrayPattern(node.elements.map(e => e && toEnvTarget(e)));
      case "AssignmentPattern": return t.assignmentPattern(toEnvTarget(node.left), node.right);
      case "RestElement": return t.restElement(toEnvTarget(node.argument));
    }
    throw new Error(`Unexpected binding target ${node.type}`);
  }
  const assign = (target, value) => t.expressionStatement(t.assignmentExpression("=", toEnvTarget(target), value));

  const registered = [];
  for (const env of envs.values()) {
    const { owner } = env;
    const create = t.variableDeclaration("let", [t.variableDeclarator(t.cloneNode(env.id), t.objectExpression([]))]);

    // In-block declarations become assignments in place (a bare `let x;` needs nothing: the env is fresh)
    const done = new Set(env.heads);
    for (const dec of env.decls) {
      const declPath = dec.parentPath;
      if (done.has(declPath)) continue;
      done.add(declPath);
      const stmts = [];
      for (const d of declPath.get("declarations")) {
        if (!env.decls.has(d)) stmts.push(t.variableDeclaration(declPath.node.kind, [d.node]));
        else if (d.node.init) stmts.push(assign(d.node.id, d.node.init));
      }
      if (stmts.length) declPath.replaceWithMultiple(stmts);
      else declPath.remove();
    }

    if (owner.isForStatement()) {
      // for (let i = 0; test; update) -> let _env = {}; _env.i = 0; for (; test; _env = { ..._env }, update)
      const init = owner.node.init;
      const copy = t.assignmentExpression("=", t.cloneNode(env.id), t.objectExpression([t.spreadElement(t.cloneNode(env.id))]));
      owner.node.update = owner.node.update ? t.sequenceExpression([copy, owner.node.update]) : copy;
      owner.node.init = null;
      let target = owner;
      while (target.parentPath.isLabeledStatement()) target = target.parentPath;
      registered.push(...target.insertBefore([create, ...init.declarations.filter(d => d.init).map(d => assign(d.id, d.init))]));
      continue;
    }

    const forX = owner.isForXStatement() ? owner : owner.parentPath.isForXStatement() && owner.key === "body" ? owner.parentPath : null;
    const stmts = [create];
    if (forX && env.heads.length) {
      // for (const PAT of xs) -> for (const _v of xs) { let _env = {}; PAT = _v; ... }
      const left = forX.node.left;
      const tmp = funPath.scope.generateUidIdentifier("v");
      stmts.push(assign(left.declarations[0].id, t.cloneNode(tmp)));
      forX.node.left = t.variableDeclaration(left.kind, [t.variableDeclarator(tmp)]);
      forX.scope.registerDeclaration(forX.get("left"));
    }
    if (owner.isBlockStatement()) prelude(owner).stmts.unshift(...stmts);
    else owner.get("body").replaceWith(t.blockStatement([...stmts, owner.node.body]));
  }

  for (const { path: block, stmts, fns } of preludes.values()) {
    registered.push(...block.unshiftContainer("body", [...stmts, ...fns]));
  }
  for (const p of registered) if (p.isVariableDeclaration()) p.scope.registerDeclaration(p);
}
