export interface HierarchyNode {
  orderIndex: number;
  parentOrderIndex?: number;
}

/**
 * A parent reference must point at a DIFFERENT node that actually exists
 * in the same result set - never itself, never a dangling reference.
 */
export function isValidParentReference(
  node: HierarchyNode,
  allOrderIndexes: ReadonlySet<number>
): boolean {
  if (node.parentOrderIndex === undefined) {
    return true;
  }
  if (node.parentOrderIndex === node.orderIndex) {
    return false;
  }
  return allOrderIndexes.has(node.parentOrderIndex);
}

/**
 * Walks each node's parent chain looking for a repeated orderIndex - a
 * segmenter bug could otherwise produce A -> B -> A, which would infinite-
 * loop any later "walk up to the top-level clause" UI code.
 */
export function hasHierarchyCycle(nodes: readonly HierarchyNode[]): boolean {
  const parentByIndex = new Map<number, number | undefined>();
  for (const node of nodes) {
    parentByIndex.set(node.orderIndex, node.parentOrderIndex);
  }

  for (const node of nodes) {
    const visited = new Set<number>();
    let current: number | undefined = node.orderIndex;
    while (current !== undefined) {
      if (visited.has(current)) {
        return true;
      }
      visited.add(current);
      current = parentByIndex.get(current);
    }
  }
  return false;
}
