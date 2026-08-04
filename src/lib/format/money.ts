function groupIntegerDigits(integerPart: string): string {
  return integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Formats a Decimal-as-string amount without ever converting through a JS
 * float - grouping is done with string manipulation only, so precision is
 * never at risk regardless of magnitude.
 */
export function formatAmount(amount: string | null, currency: string | null): string {
  if (!amount) {
    return "-";
  }

  const isNegative = amount.startsWith("-");
  const unsigned = isNegative ? amount.slice(1) : amount;
  const [integerPart, fractionPart] = unsigned.split(".");
  const grouped = groupIntegerDigits(integerPart ?? "0");
  const withFraction = fractionPart ? `${grouped}.${fractionPart}` : grouped;
  const signed = isNegative ? `-${withFraction}` : withFraction;

  const currencyCode = currency ?? "KRW";
  if (currencyCode === "KRW") {
    return `₩${signed}`;
  }
  return `${signed} ${currencyCode}`;
}
