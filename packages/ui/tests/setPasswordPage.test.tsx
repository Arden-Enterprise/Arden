// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetPasswordPage } from "../src/sign-in/SetPasswordPage";

afterEach(cleanup);

describe("Google account password setup", () => {
  it("shows the same live password check and visibility control before creating the password", () => {
    const onComplete = vi.fn();
    render(createElement(SetPasswordPage, { platform: "web", email: "new@example.test", onComplete }));

    const password = screen.getByLabelText("New password") as HTMLInputElement;
    expect(password.hasAttribute("maxlength")).toBe(false);
    expect((screen.getByLabelText("Confirm password") as HTMLInputElement).hasAttribute("maxlength")).toBe(false);
    fireEvent.change(password, { target: { value: "short" } });
    expect(screen.getByText("At least 8 characters").closest("li")?.textContent).toContain("Not met:");
    expect(screen.getByText("At least 1 uppercase letter").closest("li")?.textContent).toContain("Not met:");
    expect(screen.getByText("At least 1 special character").closest("li")?.textContent).toContain("Not met:");
    fireEvent.change(password, { target: { value: "abcdefgh!" } });
    fireEvent.submit(password.closest("form")!);
    expect(screen.getByRole("alert").textContent).toContain("one uppercase letter, and one special character");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password.type).toBe("text");
    expect(onComplete).not.toHaveBeenCalled();
  });
});
