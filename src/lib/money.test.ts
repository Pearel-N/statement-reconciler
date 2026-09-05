import { describe, expect, it } from "vitest";

import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("uses Indian grouping for rupees", () => {
    expect(formatMoney("123857.14", "INR")).toBe("₹1,23,857.14");
    expect(formatMoney("999.00", "INR")).toBe("₹999.00");
    expect(formatMoney("10000000.00", "INR")).toBe("₹1,00,00,000.00");
  });

  it("uses thousands grouping elsewhere", () => {
    expect(formatMoney("123857.14", "USD")).toBe("USD 123,857.14");
  });

  it("keeps a negative sign outside the symbol", () => {
    expect(formatMoney("-1499.00", "INR")).toBe("-₹1,499.00");
  });

  it("does not lose precision on values a float would round", () => {
    // 0.1 + 0.2 territory. Formatting must be string work, not arithmetic.
    expect(formatMoney("0.30", "INR")).toBe("₹0.30");
    expect(formatMoney("9007199254740993.99", "USD")).toBe(
      "USD 9,007,199,254,740,993.99",
    );
  });

  it("copes with a missing currency", () => {
    expect(formatMoney("50.00", null)).toBe("50.00");
  });
});
