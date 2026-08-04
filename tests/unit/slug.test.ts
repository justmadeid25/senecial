import { describe, expect, it } from "vitest";

import { generateOrganizationSlugBase } from "@/domain/organizations/slug";

describe("generateOrganizationSlugBase", () => {
  it("falls back to 'org' for a name with no ASCII alphanumerics", () => {
    expect(generateOrganizationSlugBase("주식회사 클로즈베이스")).toBe("org");
  });

  it("slugifies a latin company name", () => {
    expect(generateOrganizationSlugBase("Café Résumé Inc.")).toBe("cafe-resume-inc");
  });

  it("collapses whitespace and punctuation into single hyphens", () => {
    expect(generateOrganizationSlugBase("  ACME   Corp!!  ")).toBe("acme-corp");
  });
});
