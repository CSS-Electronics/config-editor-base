import { describe, it, expect } from "vitest";
import { extractCanChannel } from "./dbcParser";
import { getMuxIdFromConfig, defaultRouterBaseChannel, extractFilters } from "./filterEvaluator";

// CANmod.router: tunnel ID (hex in the config) -> demuxed channels, DBC prefixes for the demuxed channels
const router = (id, extra = {}) => ({
  phy: {
    can: { route: { mode: 0, mux: { s2p: { message: { id_format: 0, id, frame_format: 1, brs: 1 } } } } },
    can_s1: { filter: [{ state: 1, id_format: 0, frame_format: 2, f1: "7FF", f2: "0", prescaler_type: 0 }] },
    ...extra
  }
});

describe("CANmod.router tunnel ID", () => {
  it("reads the ID as hex", () => {
    expect(getMuxIdFromConfig(router("10"))).toBe(0x10);
    expect(getMuxIdFromConfig(router("12"))).toBe(0x12);
    expect(getMuxIdFromConfig(router("1A"))).toBe(0x1a);
  });
  it("reads FW 01.01 mux.output.message", () => {
    expect(getMuxIdFromConfig({ phy: { can: { route: { mux: { output: { message: { id: "12" } } } } } } })).toBe(0x12);
  });
  it("is null without a tunnel ID", () => {
    expect(getMuxIdFromConfig({})).toBe(null);
  });
  it("maps 0x12 to CAN15-18, anything else to CAN11-14", () => {
    expect(defaultRouterBaseChannel(router("12"))).toBe(15);
    expect(defaultRouterBaseChannel(router("10"))).toBe(11);
    expect(defaultRouterBaseChannel(router("1A"))).toBe(11);
    expect(defaultRouterBaseChannel({})).toBe(11);
  });
  it("extractFilters uses the default channels", () => {
    expect(Object.keys(extractFilters(router("12"), "CANmod.router"))).toEqual(["15"]);
    expect(Object.keys(extractFilters(router("10"), "CANmod.router"))).toEqual(["11"]);
  });
  it("extractFilters uses the filter builder's S1-S4 mapping when given", () => {
    const f = extractFilters(router("10"), "CANmod.router", { can_s1: 3, can_s2: 4, can_s3: 5, can_s4: 6 });
    expect(Object.keys(f)).toEqual(["3"]);
    expect(f[3].idFilters[0].method).toBe(1);
  });
});

describe("DBC channel prefix", () => {
  it("accepts the CANedge channels", () => {
    expect(extractCanChannel("can1-engine.dbc")).toBe("1");
    expect(extractCanChannel("can9-gnss.dbc")).toBe("9");
  });
  it("accepts all demuxed CANmod.router channels (2nd router: CAN15-18)", () => {
    expect(extractCanChannel("can11-s1.dbc")).toBe("11");
    expect(extractCanChannel("can18-router2-s4.dbc")).toBe("18");
  });
  it("rejects no prefix and channel 0", () => {
    expect(extractCanChannel("engine.dbc")).toBe(null);
    expect(extractCanChannel("can0-x.dbc")).toBe(null);
  });
});
