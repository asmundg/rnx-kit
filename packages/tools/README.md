# @rnx-kit/typescript-service

[![Build](https://github.com/microsoft/rnx-kit/actions/workflows/build.yml/badge.svg)](https://github.com/microsoft/rnx-kit/actions/workflows/build.yml)
[![npm version](https://img.shields.io/npm/v/@rnx-kit/typescript-service)](https://www.npmjs.com/package/@rnx-kit/tools)

`@rnx-kit/tools` is a collection of functions and types which supplement
JavaScript development.

The library is organized into categories:

- [Language](#language)
- [Node](#node)
- [React Native](#react-native)

## Language

| Category | Function                                  | Description                                                                                                                                    |
| -------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Function | `tryInvoke(fn)`                           | Invoke the given function, returning its result or a thrown error.                                                                             |
| Math     | `isApproximatelyEqual(f1, f2, tolerance)` | Decide if two numbers, integer or decimal, are "approximately" equal. They're equal if they are close enough to be within the given tolerance. |

## Node

| Category                     | Type Name                      | Description                                                                                                                                                                        |
| ---------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package                      | `PackageRef`                   | Components of a package reference                                                                                                                                                  |
| Package                      | `PackagePerson`                | Schema for a reference to a person in `package.json`.                                                                                                                              |
| Package                      | `PackageManifest`              | Schema for the contents of a `package.json` manifest file.                                                                                                                         |
| Package                      | `FindPackageDependencyOptions` | Options which control how package dependecies are located.                                                                                                                         |
| Module                       | `PackageModuleRef`             | Module reference relative to a package, such as `react-native` or                                                                                                                  |
| `@rnx-kit/tools/node/index`. |
| Module                       | `FileModuleRef`                | \* Module reference rooted to a file system location, either relative to a directory, or as an absolute path. For example, `./index` or `/repos/rnx-kit/packages/tools/src/index`. |

| Category    | Function                                      | Description                                                                                                                                                                                        |
| ----------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Path        | `escapePath(p)`                               | Escape a path by replacing each backslash ('\\') with a double-backslash ("\\\\").                                                                                                                 |
| Path        | `normalizePath(p)`                            | Normalize the separators in a path, converting each backslash ('\\') to a foreward slash ('/').                                                                                                    |
| File system | `findFirstFileExists(root, ...relativeFiles)` | Combine the root directory with each relative file, testing whether or not the file exists. Stop and return as soon as a file is found.                                                            |
| Package     | `parsePackageRef(r)`                          | Parse a package reference string. One exaple is `name` property found in `package.json`.                                                                                                           |
| Package     | `getMangledPackageName(r)`                    | Get the mangled name for a package reference.                                                                                                                                                      |
| Package     | `isPackageManifest(r)`                        | Determine if the given object is a `package.json` manifest.                                                                                                                                        |
| Package     | `readPackage(p)`                              | Read a `package.json` manifest from a file.                                                                                                                                                        |
| Package     | `writePackage(p, m)`                          | Write a `package.json` manifest to a file.                                                                                                                                                         |
| Package     | `findPackage(start)`                          | Find the nearest `package.json` manifest file.                                                                                                                                                     |
| Package     | `findPackageDir(start)`                       | Find the parent directory of the nearest `package.json` manifest file.                                                                                                                             |
| Package     | `findPackageDependencyDir(r, options)`        | Find the package dependency's directory, starting from the given directory and moving outward, through all parent directories. Package dependencies exist under 'node_modules/[`scope`]/[`name`]'. |
| Module      | `parseModuleRef(r)`                           | Parse a module reference into either a package module reference or a file module reference.                                                                                                        |
| Module      | `isPackageModuleRef(r)`                       | Is the module reference a package module reference?                                                                                                                                                |
| Module      | `isFileModuleRef(r)`                          | Is the module reference relative to a file location?                                                                                                                                               |
| Module      | `getPackageModuleRefFromModulePath(p)`        | Convert a module path to a package module reference.                                                                                                                                               |

## React Native

| Category | Type Name      | Description                               |
| -------- | -------------- | ----------------------------------------- |
| Platform | `AllPlatforms` | List of supported react-native platforms. |

| Category | Function           | Description                                                        |
| -------- | ------------------ | ------------------------------------------------------------------ |
| Platform | `parsePlatform(p)` | Parse a string to ensure it maps to a valid react-native platform. |