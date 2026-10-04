/**
 * Maintainer entry point for npm publication catalog checks.
 *
 * Release scripts bundle this module with esbuild. It is not a public CLI runtime
 * file and is not emitted as `dist/upgrade/*`.
 */
export { listProductionSnapshotVersions, sourceProductionReleasesRoot } from "./release-assets";
export {
  assertUpgradeCatalogMatchesPublishedIdentity,
  buildProductionReleaseCatalog,
  selectSupportedReleaseWindow,
} from "./release-catalog";
