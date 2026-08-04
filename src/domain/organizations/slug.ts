/**
 * Best-effort slugification. Most Korean company names contain no ASCII
 * alphanumerics, so this frequently collapses to an empty string - callers
 * must handle that (see generateOrganizationSlugBase) rather than assume a
 * meaningful slug comes out the other end.
 */
function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip latin diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function generateOrganizationSlugBase(organizationName: string): string {
  const slug = slugify(organizationName);
  return slug.length > 0 ? slug : "org";
}
