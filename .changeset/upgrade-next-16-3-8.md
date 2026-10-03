---
"@atlas/ui": patch
"@atlas/config": patch
"@atlas/consent": patch
"@atlas/web": patch
"@atlas/reference": patch
"@atlas/project": patch
"@blitzcraftlabs/atlas": patch
---

Upgrade Next.js from 16.3.3 to 16.3.8 so generated consumers can keep `output: "standalone"` when a
deployment build adapter is active (fixes missing `.next/next-server.js.nft.json` on Vercel).
