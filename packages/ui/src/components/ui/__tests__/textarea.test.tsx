import { render } from "@testing-library/react";
import "@testing-library/jest-dom";

import { Textarea } from "../textarea";

describe("Textarea", () => {
  it("renders with data-slot attribute", () => {
    const { container } = render(<Textarea placeholder="Notes" />);
    expect(container.querySelector('[data-slot="textarea"]')).toBeInTheDocument();
  });

  it("keeps focus and invalid borders above hover", () => {
    const { container } = render(<Textarea placeholder="Notes" />);
    const textarea = container.querySelector('[data-slot="textarea"]');

    expect(textarea).toHaveClass("hover:border-control-border-hover");
    expect(textarea).toHaveClass("focus-visible:border-ring");
    expect(textarea).toHaveClass("focus-visible:hover:border-ring");
    expect(textarea).toHaveClass("aria-invalid:border-destructive");
    expect(textarea).toHaveClass("aria-invalid:hover:border-destructive");
    expect(textarea).toHaveClass("aria-invalid:focus-visible:border-destructive");
  });
});
