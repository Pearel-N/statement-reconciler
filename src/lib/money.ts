/**
 * Formatting money for display, without ever making it a number.
 *
 * `Intl.NumberFormat` would be shorter, but it takes a `number` — which means
 * parsing an exact decimal string into a float purely to draw it. In an app
 * whose entire claim is that money is never a float, doing it "just for
 * display" is the crack the discipline leaks out of. Grouping a string is
 * eight lines and has no such hole.
 */

/** Indian grouping (1,23,857.14) for INR, thousands elsewhere. */
export function formatMoney(value: string, currency: string | null): string {
  const negative = value.startsWith("-");
  const [whole = "0", fraction = "00"] = value.replace("-", "").split(".");

  const grouped =
    currency === "INR" ? groupIndian(whole) : groupThousands(whole);

  const symbol = currency === "INR" ? "₹" : currency ? `${currency} ` : "";

  return `${negative ? "-" : ""}${symbol}${grouped}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function groupIndian(whole: string): string {
  if (whole.length <= 3) return whole;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}`;
}
