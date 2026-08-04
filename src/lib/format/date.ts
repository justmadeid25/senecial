// "en-CA" formats as YYYY-MM-DD, which is what we want for a KST calendar
// date display regardless of the app's locale.
const kstDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const kstDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** DB stores UTC; this always renders the KST calendar date for display. */
export function formatDateKst(date: Date | null | undefined): string {
  if (!date) {
    return "-";
  }
  return kstDateFormatter.format(date);
}

export function formatDateTimeKst(date: Date | null | undefined): string {
  if (!date) {
    return "-";
  }
  return kstDateTimeFormatter.format(date).replace(",", "");
}

/** For <input type="date"> defaultValue/value - KST calendar date, no time. */
export function toDateInputValue(date: Date | null | undefined): string {
  if (!date) {
    return "";
  }
  return kstDateFormatter.format(date);
}
