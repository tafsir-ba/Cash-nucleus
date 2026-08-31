import { isRequestCanceled, resolveApiBase } from "./api";

describe("resolveApiBase", () => {
  it("uses a relative /api path when the configured backend matches the page origin", () => {
    expect(resolveApiBase("https://cash.evonucleus.ch", "https://cash.evonucleus.ch")).toBe("/api");
    expect(resolveApiBase("https://cash.evonucleus.ch/", "https://cash.evonucleus.ch")).toBe("/api");
  });

  it("keeps a cross-origin backend URL for local frontend-to-API splits", () => {
    expect(resolveApiBase("http://localhost:8001", "http://localhost:3000")).toBe(
      "http://localhost:8001/api",
    );
  });

  it("falls back to /api when no backend URL is configured", () => {
    expect(resolveApiBase("", "https://cash.evonucleus.ch")).toBe("/api");
    expect(resolveApiBase(undefined, "")).toBe("/api");
  });
});

describe("isRequestCanceled", () => {
  it("detects axios and fetch abort shapes", () => {
    expect(isRequestCanceled({ code: "ERR_CANCELED" })).toBe(true);
    expect(isRequestCanceled({ name: "AbortError" })).toBe(true);
    expect(isRequestCanceled({ message: "Network Error" })).toBe(false);
    expect(isRequestCanceled(null)).toBe(false);
  });
});
