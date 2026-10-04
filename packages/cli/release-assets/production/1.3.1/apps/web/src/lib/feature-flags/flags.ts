/**
 * Feature Flags Contract
 *
 * Defines all known feature flags as strongly-typed constants.
 *
 * @module feature-flags/flags
 */

export const FeatureFlags = {
  /**
   * Example feature flag for reference implementations.
   * Replace with your product flags when building on Atlas.
   */
  EXAMPLE_FEATURE: "example_feature",

  /**
   * Kill switch for the example feature.
   * When true, the feature is forcibly disabled regardless of other sources.
   */
  KILL_EXAMPLE_FEATURE: "kill_example_feature",
} as const;

export type FeatureFlagKey = (typeof FeatureFlags)[keyof typeof FeatureFlags];

export const ALL_FEATURE_FLAGS = Object.values(FeatureFlags);

export function isValidFeatureFlag(key: string): key is FeatureFlagKey {
  return ALL_FEATURE_FLAGS.includes(key as FeatureFlagKey);
}

export function isKillSwitchFlag(key: string): boolean {
  return key.startsWith("kill_");
}

export function getKillSwitchForFlag(key: FeatureFlagKey): FeatureFlagKey | undefined {
  const killSwitchKey = `kill_${key}` as FeatureFlagKey;
  return isValidFeatureFlag(killSwitchKey) ? killSwitchKey : undefined;
}
