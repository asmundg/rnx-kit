import type {
  AllPlatforms,
  BundleDefinitionWithRequiredParameters,
} from "@rnx-kit/config";
import {
  getBundleDefinition,
  getBundlePlatformDefinition,
  getKitConfig,
} from "@rnx-kit/config";
import type { BundleArgs } from "@rnx-kit/metro-service";
import chalk from "chalk";

/**
 * Get a bundle definition from the kit configuration.
 *
 * @param id Optional bundle definition id. Only needed when the kit config has more than one definition.
 * @returns Bundle definition matching the id (if given), or the first bundle definition found. `undefined` if bundling is disabled or not supported for the kit.
 */
export function getKitBundleDefinition(
  id?: string
): BundleDefinitionWithRequiredParameters | undefined {
  const kitConfig = getKitConfig();
  if (!kitConfig) {
    throw new Error(
      "No kit configuration found for this react-native experience"
    );
  }

  if (kitConfig.bundle === null || kitConfig.bundle === undefined) {
    console.warn(
      chalk.yellow(
        "No bundle configuration found for this react-native experience -- skipping bundling"
      )
    );
    return undefined;
  } else if (!kitConfig.bundle) {
    console.warn(
      chalk.yellow(
        "Bundling is disabled for this react-native experience -- skipping"
      )
    );
    return undefined;
  }

  // get the bundle definition
  return getBundleDefinition(kitConfig.bundle, id);
}

export type BundleDefinitionOverrides = {
  entryPath?: string;
  distPath?: string;
  assetsPath?: string;
  bundlePrefix?: string;
  bundleEncoding?: BundleArgs["bundleEncoding"];
  sourcemapOutput?: string;
  sourcemapSourcesRoot?: string;
  experimentalTreeShake?: boolean;
};

/**
 * Build a platform-specific bundle definition. Apply any overrides.
 *
 * @param bundleDefinition Bundle definition to use as a basis for creating the plaform-specific bundle definition
 * @param targetPlatform Target platform
 * @param overrides Overrides to apply to the output bundle definition. These take precedence.
 * @returns Platform-specific, overriden bundle definition
 */
export function getKitBundlePlatformDefinition(
  bundleDefinition: BundleDefinitionWithRequiredParameters,
  targetPlatform: AllPlatforms,
  overrides: BundleDefinitionOverrides
): BundleDefinitionWithRequiredParameters {
  return {
    ...getBundlePlatformDefinition(bundleDefinition, targetPlatform),
    ...(overrides.entryPath ? { entryPath: overrides.entryPath } : {}),
    ...(overrides.distPath ? { distPath: overrides.distPath } : {}),
    ...(overrides.assetsPath ? { assetsPath: overrides.assetsPath } : {}),
    ...(overrides.bundlePrefix ? { bundlePrefix: overrides.bundlePrefix } : {}),
    ...(overrides.bundleEncoding
      ? { bundleEncoding: overrides.bundleEncoding }
      : {}),
    ...(overrides.sourcemapOutput
      ? { sourceMapPath: overrides.sourcemapOutput }
      : {}),
    ...(overrides.sourcemapSourcesRoot
      ? { sourceMapSourceRootPath: overrides.sourcemapSourcesRoot }
      : {}),
    ...(overrides.experimentalTreeShake
      ? { experimentalTreeShake: overrides.experimentalTreeShake }
      : {}),
  };
}
