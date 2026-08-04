/** True when there is only one (or zero, defensively) OWNER left in the organization. */
export function isLastOwner(ownerCount: number): boolean {
  return ownerCount <= 1;
}
