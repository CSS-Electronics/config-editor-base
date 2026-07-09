import { computeConfigDelta } from "./configDelta";

const merge = require("deepmerge");
const overwriteMerge = (destinationArray, sourceArray) => sourceArray;

const applyOverlay = (past, partial) =>
  merge(past, partial, { arrayMerge: overwriteMerge });

describe("computeConfigDelta", () => {
  it("returns an empty partial for identical configs", () => {
    const config = { general: { device: { meta: "x" } }, can_1: { phy: { mode: 0 } } };
    const { partial, deletions } = computeConfigDelta(config, config);
    expect(partial).toEqual({});
    expect(deletions).toEqual([]);
  });

  it("emits only changed primitives, nested", () => {
    const past = { connect: { s3: { server: { port: 80, endpoint: "http://a" } } } };
    const current = { connect: { s3: { server: { port: 443, endpoint: "http://a" } } } };
    const { partial, deletions } = computeConfigDelta(past, current);
    expect(partial).toEqual({ connect: { s3: { server: { port: 443 } } } });
    expect(deletions).toEqual([]);
  });

  it("emits additions", () => {
    const past = { general: {} };
    const current = { general: { security: { kpub: "abc" } } };
    const { partial } = computeConfigDelta(past, current);
    expect(partial).toEqual({ general: { security: { kpub: "abc" } } });
  });

  it("emits changed arrays wholesale (edits, additions and removals)", () => {
    const past = { can_1: { transmit: [{ id: "1" }, { id: "2" }] } };
    const shorter = { can_1: { transmit: [{ id: "1" }] } };
    const edited = { can_1: { transmit: [{ id: "1" }, { id: "3" }] } };

    expect(computeConfigDelta(past, shorter).partial).toEqual({
      can_1: { transmit: [{ id: "1" }] },
    });
    expect(computeConfigDelta(past, shorter).deletions).toEqual([]);
    expect(computeConfigDelta(past, edited).partial).toEqual({
      can_1: { transmit: [{ id: "1" }, { id: "3" }] },
    });
  });

  it("reports deleted object keys as deletions and excludes them", () => {
    const past = {
      connect: { s3: { server: { endpoint: "http://a" } }, wifi: { keyformat: 0 } },
    };
    const current = { connect: { s3: { server: { endpoint: "http://a" } } } };
    const { partial, deletions } = computeConfigDelta(past, current);
    expect(partial).toEqual({});
    expect(deletions).toEqual(["connect.wifi"]);
  });

  it("collects nested deletion paths alongside sibling changes", () => {
    const past = { log: { file: { split_size: 10, split_time_period: 60 } } };
    const current = { log: { file: { split_size: 20 } } };
    const { partial, deletions } = computeConfigDelta(past, current);
    expect(partial).toEqual({ log: { file: { split_size: 20 } } });
    expect(deletions).toEqual(["log.file.split_time_period"]);
  });

  it("treats array-to-object type changes as unexpressable", () => {
    const past = { secondaryport: [1, 2] };
    const current = { secondaryport: { power_cycle: 1 } };
    const { partial, deletions } = computeConfigDelta(past, current);
    expect(partial).toEqual({});
    expect(deletions).toEqual(["secondaryport"]);
  });

  it("emits object-to-array and primitive type changes (safe overwrites)", () => {
    const past = { a: { x: 1 }, b: 5 };
    const current = { a: [1, 2], b: "5" };
    const { partial, deletions } = computeConfigDelta(past, current);
    expect(partial).toEqual({ a: [1, 2], b: "5" });
    expect(deletions).toEqual([]);
    expect(applyOverlay(past, partial)).toEqual(current);
  });

  it("invariant: no deletions => deepmerge(past, partial) deep-equals current", () => {
    const past = {
      general: { device: { meta: "old" }, security: { kpub: "" } },
      log: { file: { split_size: 10 }, encryption: { state: 0 } },
      can_1: {
        phy: { mode: 0, retransmission: 1 },
        filter: { id: [{ name: "f1", state: 1 }, { name: "f2", state: 0 }] },
      },
      connect: {
        s3: { server: { endpoint: "http://old", port: 80, keyformat: 0 } },
        wifi: { keyformat: 0, accesspoint: [{ ssid: "a", pwd: "1" }] },
      },
    };
    const current = {
      general: { device: { meta: "new" }, security: { kpub: "" } },
      log: { file: { split_size: 50 }, encryption: { state: 0 } },
      can_1: {
        phy: { mode: 0, retransmission: 1 },
        filter: { id: [{ name: "f1", state: 1 }] },
      },
      connect: {
        s3: { server: { endpoint: "https://new", port: 443, keyformat: 0 } },
        wifi: { keyformat: 0, accesspoint: [{ ssid: "a", pwd: "1" }, { ssid: "b", pwd: "2" }] },
      },
    };
    const { partial, deletions } = computeConfigDelta(past, current);
    expect(deletions).toEqual([]);
    expect(applyOverlay(past, partial)).toEqual(current);
    // and the partial is minimal: unchanged subtrees are absent
    expect(partial.log.encryption).toBeUndefined();
    expect(partial.can_1.phy).toBeUndefined();
  });

  it("handles non-object inputs defensively", () => {
    expect(computeConfigDelta(null, { a: 1 })).toEqual({
      partial: { a: 1 },
      deletions: [],
    });
    expect(computeConfigDelta({ a: 1 }, null)).toEqual({
      partial: {},
      deletions: [],
    });
  });

  it("does not mutate its inputs and deep-copies emitted values", () => {
    const past = { can_1: { transmit: [] } };
    const current = { can_1: { transmit: [{ id: "1" }] } };
    const pastSnapshot = JSON.parse(JSON.stringify(past));
    const currentSnapshot = JSON.parse(JSON.stringify(current));
    const { partial } = computeConfigDelta(past, current);
    expect(past).toEqual(pastSnapshot);
    expect(current).toEqual(currentSnapshot);
    partial.can_1.transmit[0].id = "mutated";
    expect(current.can_1.transmit[0].id).toBe("1");
  });
});
