export {
  AtlasBaselineCaptureError,
  BASELINE_CHECKSUM_PATTERN,
  BASELINE_CHECKSUM_PREFIX,
  type BaselineIntegrityIssue,
  buildPlatformBaseline,
  captureRepositorySyncedPathChecksums,
  captureRepositorySyncedPathChecksumsStrict,
  captureSyncedPathChecksums,
  type CaptureSyncedPathChecksumsResult,
  captureSyncedPathChecksumsStrict,
  computeBaselineChecksum,
  getSyncedPathBaselineStatus,
  isValidBaselineChecksum,
  normalizeBaselineChecksum,
  readFileBaselineChecksum,
  readPlatformBaseline,
  type SyncedPathBaselineStatus,
  validatePlatformBaselineIntegrity,
} from "./baseline";
export {
  ATLAS_CONTRACT_FILENAME,
  LATEST_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  type SupportedSchemaVersion,
} from "./constants";
export { DEFAULT_ATLAS_PROJECT_CONTRACT, resolveAtlasProjectContract } from "./defaults";
export {
  AtlasContractError,
  AtlasContractErrorCode,
  type AtlasContractErrorCode as AtlasContractErrorCodeType,
  formatUnsupportedSchemaVersion,
  formatValidationErrors,
} from "./errors";
export {
  findAtlasContractPath,
  loadAtlasProject,
  readAtlasProjectContractFile,
  resolveAtlasProject,
} from "./loader";
export { joinRepoPath, normalizeRepoRelativePath } from "./paths";
export {
  atlasProjectContractSchema,
  type CustomGeneratorDefinition,
  parseAtlasProjectContract,
  RESERVED_GENERATOR_IDS,
  type PlatformBaseline,
  type RawAtlasProjectContract,
  type ResolvedAtlasProject,
  resolvedAtlasProjectSchema,
} from "./schema";
export { serializeResolvedAtlasProject, toResolvedAtlasProjectJson } from "./serialize";
