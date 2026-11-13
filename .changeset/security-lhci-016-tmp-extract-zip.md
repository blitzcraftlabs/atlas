---
"@blitzcraftlabs/atlas": patch
---

Security: upgrade the starter's `@lhci/cli` from `^0.14.0` to `^0.16.0` (Lighthouse 13,
`@puppeteer/browsers` 3), which removes `extract-zip@2.0.1` (GHSA-jmr9-qjv8-65gv,
GHSA-7pqw-9j4j-h8q3) and `tmp@0.1.0` (GHSA-ph9p-34f9-6g65, GHSA-52f5-9888-hmc6) from the dependency
tree. The consumer `security-audit` capability template no longer ships exceptions for those
advisories. Existing consumers that enable the security audit while still on `@lhci/cli` 0.14 should
bump `@lhci/cli` to `^0.16.0` in `apps/web/package.json`; `@lhci/cli` 0.16 requires Node.js

> = 22.19.
