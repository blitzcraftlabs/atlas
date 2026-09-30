import { describe, expect, it } from "@jest/globals";

import {
  controlClasses,
  controlFocusClasses,
  controlInvalidClasses,
  controlSurfaceClasses,
  interactiveFocusClasses,
  interactiveInvalidClasses,
} from "../control-styles";

function classTokens(className: string) {
  return new Set(className.split(/\s+/).filter(Boolean));
}

function expectTokens(className: string, tokens: string[]) {
  const actual = classTokens(className);
  for (const token of tokens) {
    expect(actual).toContain(token);
  }
}

describe("control style state precedence", () => {
  it("keeps hover, focus, and idle surface classes together", () => {
    expectTokens(controlSurfaceClasses, [
      "border-control-border",
      "hover:border-control-border-hover",
      "hover:bg-control-background-hover",
    ]);
  });

  it("uses compound focus+hover so focus border outranks hover", () => {
    expectTokens(controlFocusClasses, [
      "focus-visible:border-ring",
      "focus-visible:hover:border-ring",
    ]);
    expectTokens(interactiveFocusClasses, [
      "focus-visible:border-ring",
      "focus-visible:hover:border-ring",
    ]);
  });

  it("uses compound invalid selectors so destructive border outranks hover and focus", () => {
    const invalidTokens = [
      "aria-invalid:border-destructive",
      "aria-invalid:hover:border-destructive",
      "aria-invalid:focus-visible:border-destructive",
      "aria-invalid:focus-visible:hover:border-destructive",
      "aria-invalid:ring-destructive/20",
      "aria-invalid:focus-visible:ring-destructive/20",
    ];

    expectTokens(controlInvalidClasses, invalidTokens);
    expectTokens(interactiveInvalidClasses, invalidTokens);
  });

  it("composes text-entry controls with hover, focus, and invalid combinations", () => {
    const composed = controlClasses();

    expectTokens(composed, [
      "hover:border-control-border-hover",
      "focus-visible:border-ring",
      "focus-visible:hover:border-ring",
      "aria-invalid:border-destructive",
      "aria-invalid:hover:border-destructive",
      "aria-invalid:focus-visible:border-destructive",
    ]);
  });
});
