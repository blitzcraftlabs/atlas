import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { Select, SelectTrigger, SelectValue } from "../select";

describe("SelectTrigger", () => {
  it("keeps focus and invalid borders above hover", () => {
    render(
      <Select>
        <SelectTrigger aria-label="Choose">
          <SelectValue placeholder="Choose" />
        </SelectTrigger>
      </Select>
    );

    const trigger = screen.getByRole("combobox");

    expect(trigger).toHaveClass("hover:border-control-border-hover");
    expect(trigger).toHaveClass("focus-visible:border-ring");
    expect(trigger).toHaveClass("focus-visible:hover:border-ring");
    expect(trigger).toHaveClass("aria-invalid:border-destructive");
    expect(trigger).toHaveClass("aria-invalid:hover:border-destructive");
    expect(trigger).toHaveClass("aria-invalid:focus-visible:border-destructive");
  });
});
