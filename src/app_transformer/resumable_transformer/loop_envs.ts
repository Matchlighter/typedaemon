// @ts-nocheck
import type { NodePath } from "@babel/core";
import type { Binding } from "@babel/traverse";
import type * as types from "@babel/types";
import * as util from "./util";

/** A per-iteration env object (`_env`), holding the captured bindings declared by one loop block or head */
interface LoopEnv {
  /** Where a fresh env is made: a block (incl. a for-of/in body) or a for-of/in/classic for (its head) */
  owner: NodePath;
  id: types.Identifier;
  /** Head declarations (of a for owner) whose bindings live in the env */
  heads: NodePath<types.VariableDeclaration>[];
  /** Declarators whose bindings live in the env */
  decls: Set<NodePath<types.VariableDeclarator>>;
}

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
export function materializeLoopEnvs(funPath: NodePath<types.Function>, ownBindings: Set<Binding>) {
  const envOf = assignEnvs(funPath, ownBindings);
  if (envOf.size === 0) return;

  const closures = rewriteUses(funPath, envOf);
  const preludes = new Preludes();
  wrapClosures(closures, preludes);
  const registered = [];
  for (const env of new Set(envOf.values())) registered.push(...createEnv(funPath, env, preludes));
  registered.push(...preludes.insert());
  for (const p of registered) if (p.isVariableDeclaration()) p.scope.registerDeclaration(p);
}

/** Which env each captured loop binding moves to */
function assignEnvs(funPath, ownBindings: Set<Binding>) {
  const fnNode = funPath.node;
  const inLoop = (p) => !!p.findParent(q => q.node === fnNode || q.isLoop())?.isLoop();

  // Where a fresh env lives for `binding`: a block, a for-of/in (its body), or a classic for head
  function envOwner(binding: Binding) {
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

  const isCaptured = (binding: Binding) =>
    [...binding.referencePaths, ...binding.constantViolations].some(p => p.getFunctionParent()?.node !== fnNode);

  const envs = new Map<types.Node, LoopEnv>(); // owner node -> env
  const envOf = new Map<Binding, LoopEnv>();

  // A captured binding pulls in every binding of the same declarator (a pattern is rewritten as a whole),
  // or the whole loop head
  for (const binding of ownBindings) {
    if (envOf.has(binding) || !isCaptured(binding)) continue;
    const owner = envOwner(binding);
    if (!owner) continue;
    let env = envs.get(owner.node);
    if (!env) envs.set(owner.node, env = { owner, id: funPath.scope.generateUidIdentifier("env"), heads: [], decls: new Set() });
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
  return envOf;
}

/**
 * Rewrites every use of a moved binding (declarations included, which `createEnv` then turns into assignments) to
 *   `_env.name`. Returns the outermost closure each capture sits in, with the envs it captures.
 */
function rewriteUses(funPath, envOf: Map<Binding, LoopEnv>) {
  const t = util.getTypes();
  const fnNode = funPath.node;
  const closures = new Map<types.Node, { path: NodePath, envs: Set<LoopEnv> }>(); // fn node -> closure
  for (const { path, binding } of util.findBindingUses(funPath.get("body"), envOf)) {
    const env = envOf.get(binding);
    let fn = path.getFunctionParent();
    if (fn.node !== fnNode) {
      while (fn.parentPath.getFunctionParent().node !== fnNode) fn = fn.parentPath.getFunctionParent();
      if (!closures.has(fn.node)) closures.set(fn.node, { path: fn, envs: new Set() });
      closures.get(fn.node).envs.add(env);
    }
    util.replaceVariableUse(path, t.memberExpression(t.cloneNode(env.id), t.identifier(binding.identifier.name)));
  }
  for (const binding of envOf.keys()) binding.scope.removeBinding(binding.identifier.name);
  return closures;
}

/** Statements to put at the top of a block: env creation, then wrapped function declarations */
class Preludes {
  private blocks = new Map<types.Node, { path: NodePath<types.BlockStatement>, stmts: types.Statement[], fns: types.Statement[] }>();

  of(block: NodePath<types.BlockStatement>) {
    if (!this.blocks.has(block.node)) this.blocks.set(block.node, { path: block, stmts: [], fns: [] });
    return this.blocks.get(block.node);
  }

  insert() {
    return [...this.blocks.values()].flatMap(({ path, stmts, fns }) => path.unshiftContainer("body", [...stmts, ...fns]));
  }
}

/** Wraps each capturing closure as `((_env) => fn)(_env)`, binding it to the envs of the iteration it is created in */
function wrapClosures(closures: ReturnType<typeof rewriteUses>, preludes: Preludes) {
  const t = util.getTypes();
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
      preludes.of(fn.parentPath).fns.push(t.variableDeclaration("const", [t.variableDeclarator(t.cloneNode(node.id), wrap(expr))]));
      fn.scope.removeBinding(node.id.name);
      fn.remove();
    }
    // else: a method; reads the hoisted env (latest iteration)
  }
}

/**
 * Makes `env` fresh where its owner says, and turns the declarations of its (already rewritten, see `rewriteUses`)
 *   bindings into assignments. Returns the statements it inserted outside of preludes.
 */
function createEnv(funPath, env: LoopEnv, preludes: Preludes): NodePath[] {
  const t = util.getTypes();
  const { owner } = env;
  const create = t.variableDeclaration("let", [t.variableDeclarator(t.cloneNode(env.id), t.objectExpression([]))]);
  const assign = (target, value) => t.expressionStatement(t.assignmentExpression("=", target, value));

  // In-block declarations become assignments in place (a bare `let x;` needs nothing: the env is fresh)
  const done = new Set<NodePath>(env.heads);
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
    return target.insertBefore([create, ...init.declarations.filter(d => d.init).map(d => assign(d.id, d.init))]);
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
  if (owner.isBlockStatement()) preludes.of(owner).stmts.unshift(...stmts);
  else owner.get("body").replaceWith(t.blockStatement([...stmts, owner.node.body]));
  return [];
}
