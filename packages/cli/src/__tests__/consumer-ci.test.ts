import { toConsumerCiWorkflow } from "../bootstrap/consumer-ci";
import { BootstrapAssetError } from "../bootstrap/errors";

describe("consumer CI workflow transform", () => {
  it("uses the pinned local CLI for Doctor", () => {
    const rendered = toConsumerCiWorkflow("run: pnpm atlas doctor\n", "1.2.4");
    expect(rendered).toBe("run: pnpm atlas doctor\n");
  });

  it("rejects a versioned pnpm dlx Doctor invocation or an empty version", () => {
    expect(() =>
      toConsumerCiWorkflow("run: pnpm dlx @blitzcraftlabs/atlas@1.2.3 doctor\n", "1.2.4")
    ).toThrow(BootstrapAssetError);
    expect(() => toConsumerCiWorkflow("run: pnpm atlas doctor\n", "")).toThrow(BootstrapAssetError);
  });
});
