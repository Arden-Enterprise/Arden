import { describe, expect, it } from "vitest";
import { SignInThrottle, signInFailureLimit } from "./sign-in-throttle.js";

describe("SignInThrottle", () => {
  it("locks after five failed attempts with exponential backoff and clears on success", () => {
    let now = 1_000_000;
    const throttle = new SignInThrottle(() => now);

    for (let attempt = 1; attempt < signInFailureLimit; attempt++) {
      expect(throttle.recordFailure("user@example.test")).toBeNull();
      expect(throttle.state("user@example.test")).toBeNull();
    }

    expect(throttle.recordFailure("user@example.test")).toEqual({ retryAfterSeconds: 30 });
    expect(throttle.state("user@example.test")).toEqual({ retryAfterSeconds: 30 });

    now += 31_000;
    expect(throttle.state("user@example.test")).toBeNull();
    expect(throttle.recordFailure("user@example.test")).toEqual({ retryAfterSeconds: 60 });

    throttle.clear("user@example.test");
    expect(throttle.state("user@example.test")).toBeNull();
  });

  it("resets the failure count after the 15-minute window expires", () => {
    let now = 1_000_000;
    const throttle = new SignInThrottle(() => now);

    for (let attempt = 1; attempt < signInFailureLimit; attempt++) {
      expect(throttle.recordFailure("user@example.test")).toBeNull();
    }

    now += 15 * 60 * 1000 + 1;
    expect(throttle.recordFailure("user@example.test")).toBeNull();
    expect(throttle.state("user@example.test")).toBeNull();
  });
});

