type Node = { id: string; name: string; parentId?: string | null };
export function categoryLabel(category: Node, categories: readonly Node[]) {
  const byId = new Map(categories.map((node) => [node.id, node])), visited = new Set<string>(), names: string[] = [];
  let current: Node | undefined = category;
  while (current && !visited.has(current.id)) { visited.add(current.id); names.push(current.name); current = current.parentId ? byId.get(current.parentId) : undefined; }
  return names.reverse().join(" / ");
}
/** Each category carries only its own product slice. Descendant selection is
 * derived without duplicating every ancestor's entire catalog in page props. */
export function categoryProducts<T extends { id: string }>(id: string, categories: readonly (Node & { products: T[] })[]) {
  const byId = new Map(categories.map((node) => [node.id, node])), children = new Map<string, string[]>();
  for (const node of categories) if (node.parentId) children.set(node.parentId, [...children.get(node.parentId) ?? [], node.id]);
  const pending = [id], visited = new Set<string>(), result = new Map<string, T>();
  while (pending.length) { const next = pending.pop()!; if (visited.has(next)) continue; visited.add(next); for (const product of byId.get(next)?.products ?? []) result.set(product.id, product); pending.push(...children.get(next) ?? []); }
  return [...result.values()];
}
