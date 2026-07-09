// detect-browser is resolved by the consuming app (undeclared external of the
// dist build) - mock it so actions.js can be imported in the test env
jest.mock(
  "detect-browser",
  () => ({ detect: () => ({ name: "chrome" }) }),
  { virtual: true }
);

import { collectConfigurationWarnings } from "./actions";

describe("collectConfigurationWarnings", () => {
  it("collects warnings from a CANedge config without dispatching alerts", () => {
    // https endpoint on port 80 -> checkConfigTls; period <= delay -> transmit check
    const content = {
      can_1: {
        transmit: [{ name: "t1", state: 1, period: 10, delay: 10 }],
        phy: { mode: 0 },
        filter: { id: [{ name: "f1", state: 1 }] },
      },
      can_2: {
        transmit: [],
        phy: { mode: 0 },
        filter: { id: [{ name: "f1", state: 1 }] },
      },
      connect: {
        s3: { server: { endpoint: "https://s3.example.com", port: 80 } },
      },
    };

    const warnings = collectConfigurationWarnings(content);

    expect(warnings.length).toBeGreaterThanOrEqual(2);
    expect(warnings.some((w) => w.includes("TLS"))).toBe(true);
    expect(warnings.some((w) => w.includes("period <= delay"))).toBe(true);
    warnings.forEach((w) => expect(typeof w).toBe("string"));
  });

  it("returns an empty list for an unremarkable config", () => {
    const content = {
      can_1: { transmit: [], phy: { mode: 0 }, filter: { id: [{ name: "f1", state: 1 }] } },
      can_2: { transmit: [], phy: { mode: 0 }, filter: { id: [{ name: "f1", state: 1 }] } },
    };
    expect(collectConfigurationWarnings(content)).toEqual([]);
  });
});
