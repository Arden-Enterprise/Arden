import { describe, expect, it } from "vitest";
import { decodeNotificationCursor, encodeNotificationCursor } from "./contracts.js";

describe("notification cursors", () => {
  it("round-trips a timestamp and notification ID", () => {
    const cursor = { createdAt: new Date("2026-11-19T12:30:00.000Z"), id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    expect(decodeNotificationCursor(encodeNotificationCursor(cursor))).toEqual(cursor);
  });

  it("rejects malformed or oversized cursors", () => {
    expect(() => decodeNotificationCursor("not a cursor")).toThrow("INVALID_CURSOR");
    expect(() => decodeNotificationCursor("A".repeat(181))).toThrow("INVALID_CURSOR");
    expect(() => decodeNotificationCursor(Buffer.from("not-a-date\naaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").toString("base64url")))
      .toThrow("INVALID_CURSOR");
  });
});
