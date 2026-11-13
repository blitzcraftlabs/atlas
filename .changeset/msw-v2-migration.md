---
"@blitzcraftlabs/atlas": patch
---

Migrate application test mocking from MSW v1 to MSW v2 (`http` handlers returning `HttpResponse`).
Application Jest projects now run in `jest-fixed-jsdom` and compile MSW's ESM-only dependencies with
`babel-jest`. A new test proves the shared MSW server intercepts requests. Consumers with custom MSW
handlers should replace `rest.*((req, res, ctx) => …)` with `http.*(({ request, params }) => …)`.
