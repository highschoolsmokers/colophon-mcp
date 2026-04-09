import { describe, it, expect, vi } from "vitest";
import { get, set, cached } from "../cache.js";

describe("cache", () => {
  it("returns undefined for missing keys", () => {
    expect(get("nonexistent")).toBeUndefined();
  });

  it("stores and retrieves values", () => {
    set("test-key", { foo: "bar" });
    expect(get("test-key")).toEqual({ foo: "bar" });
  });

  it("expires entries after TTL", () => {
    vi.useFakeTimers();
    set("expiring", "value", 1000);
    expect(get("expiring")).toBe("value");

    vi.advanceTimersByTime(1001);
    expect(get("expiring")).toBeUndefined();
    vi.useRealTimers();
  });

  it("cached() returns cached value on second call", async () => {
    let callCount = 0;
    const fn = async () => {
      callCount++;
      return "result";
    };

    const r1 = await cached("cached-test", fn);
    const r2 = await cached("cached-test", fn);

    expect(r1).toBe("result");
    expect(r2).toBe("result");
    expect(callCount).toBe(1);
  });
});
