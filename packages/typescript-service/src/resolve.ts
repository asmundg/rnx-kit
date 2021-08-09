import fs from "fs";
import module from "module";
import path from "path";
import findUp from "find-up";
import pkgUp from "pkg-up";
import ts from "typescript";
// import { getCanonicalFileName } from "./util";

export type Resolvers = {
  // TODO: move these methods into a separate resolver database class
  hasFile(fileName: string): boolean;
  addFile(
    fileName: string,
    dependencies: {
      [moduleName: string]: string; // moduleName -> absolute path
    }
  ): boolean;
  updateFile(
    fileName: string,
    dependencies: {
      [moduleName: string]: string; // moduleName -> absolute path
    }
  ): boolean;
  removeFile(fileName: string): boolean;
  removeAllFiles(): void;
  //----

  resolveModuleNames: (
    moduleNames: string[],
    containingFile: string,
    reusedNames: string[] | undefined,
    redirectedReference?: ts.ResolvedProjectReference
  ) => (ts.ResolvedModuleFull | undefined)[];

  getResolvedModuleWithFailedLookupLocationsFromCache: (
    modulename: string,
    containingFile: string
  ) => ts.ResolvedModuleWithFailedLookupLocations | undefined;

  resolveTypeReferenceDirectives: (
    typeDirectiveNames: string[],
    containingFile: string,
    redirectedReference?: ts.ResolvedProjectReference
  ) => (ts.ResolvedTypeReferenceDirective | undefined)[];
};

/**
 * Mapping from a module dependency to a file.
 *
 * {
 *   'react-native': '/repos/myproject/node_modules/react-native-windows/index.js',
 *   './App.tsx':    '/repos/myproject/packages/my-app/src/App.native.tsx'
 *   '../app.json':  '/repos/myproject/packages/my-app/app.json'
 * }
 */
type DependencyMap = Record<string, string>;

/**
 * Collection of dependency maps, per file.
 */
type FileDependencies = Record<string, DependencyMap>;

/**
 * Components of a module reference.
 */
type ModuleComponents = {
  scope?: string;
  moduleName?: string;
  modulePath?: string;
  mangledName?: string;
};

/**
 * Components of a named module reference.
 */
type NamedModuleComponents = ModuleComponents & {
  moduleName: string;
  mangledName: string;
};

/**
 * Parse a module reference into a scope, a module name, and a path.
 *
 * Module references come in many forms. Here's how each will be parsed:
 *
 *   - 'react-native'
 *     - { moduleName: 'react-native', mangledName: 'react-native' }
 *
 *   - 'react-native/Libraries/Promise'
 *     - { moduleName: 'react-native', modulePath: '/Libraries/Promise', mangledName: 'react-native' }
 *
 *   - '@babel/core'
 *     - { scope: '@babel', moduleName: 'core', mangledName: 'babel__core' }
 *
 *   - '@babel/core/parse'
 *     - { scope: '@babel', moduleName: 'core', modulePath: '/parse', mangledName: 'babel__core' }
 *
 *   - '@types/babel__core'
 *     - { scope: '@types', moduleName: 'babel__core', mangledName: 'types__babel__core' }
 *
 *   - './parser'
 *     - { modulePath: './parser' }
 *
 *   - '../../src/parser'
 *     - { modulePath: '../../src/parser' }
 *
 *   - '/absolute/path/src/parser'
 *     - { modulePath: '/absolute/path/src/parser' }
 *
 * @param moduleRef Module reference
 * @return Module components
 */
function parseModuleRef(moduleRef: string): ModuleComponents {
  if (moduleRef.startsWith(".")) {
    return {
      modulePath: moduleRef,
    };
  }

  const parts = moduleRef.split("/");

  let scope: string | undefined;
  if (parts[0].startsWith("@")) {
    scope = parts.shift();
  }

  const moduleName = parts.shift();

  let modulePath: string | undefined;
  if (parts.length > 0) {
    modulePath = "/" + parts.join("/");
  }

  let mangledName: string | undefined;
  if (moduleName !== undefined) {
    if (scope !== undefined) {
      mangledName = scope.slice(1) + "__" + moduleName;
    } else {
      mangledName = moduleName;
    }
  }

  return {
    scope,
    moduleName,
    modulePath,
    mangledName,
  };
}

/**
 * Is the module named?
 *
 * @param components Module to evaluate
 * @returns True if the module is of type NamedModuleComponents
 */
export function isNamedModule(
  components: ModuleComponents
): components is NamedModuleComponents {
  // defined, non-empty module name means this is a "root" module
  return Boolean(components.moduleName);
}

export class ResolverImpl {
  private options: ts.CompilerOptions;
  // private moduleResolutionCache: ts.ModuleResolutionCache;
  private moduleResolutionHost: ts.ModuleResolutionHost;
  private fileDependencies: FileDependencies;

  constructor(options: ts.CompilerOptions) {
    this.options = options;

    // this.moduleResolutionCache = ts.createModuleResolutionCache(
    //   ts.sys.getCurrentDirectory(),
    //   getCanonicalFileName,
    //   options
    // );

    this.moduleResolutionHost = {
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
    };

    this.fileDependencies = {};
  }

  public hasFile(fileName: string): boolean {
    return Object.prototype.hasOwnProperty.call(
      this.fileDependencies,
      fileName
    );
  }

  public addFile(
    fileName: string,
    dependencies: {
      [moduleName: string]: string; // moduleName -> absolute path
    }
  ): boolean {
    if (this.hasFile(fileName)) {
      return false;
    }
    this.fileDependencies[fileName] = dependencies;
    return true;
  }

  public updateFile(
    fileName: string,
    dependencies: {
      [moduleName: string]: string; // moduleName -> absolute path
    }
  ): boolean {
    if (!this.hasFile(fileName)) {
      return false;
    }
    this.fileDependencies[fileName] = dependencies;
    return true;
  }

  public removeFile(fileName: string): boolean {
    if (!this.hasFile(fileName)) {
      return false;
    }
    delete this.fileDependencies[fileName];
    return true;
  }

  public removeAllFiles(): void {
    this.fileDependencies = {};
  }

  // private resolveModuleNamesUsingDependencyMap(
  //   moduleNames: string[],
  //   dependencies: DependencyMap
  // ): (ts.ResolvedModuleFull | undefined)[] {
  //   const resolvedModules: (ts.ResolvedModuleFull | undefined)[] = [];

  //   for (const moduleName of moduleNames) {
  //     if (moduleName in dependencies) {
  //       resolvedModules.push({
  //         resolvedFileName: dependencies[moduleName],
  //         extension: path.extname(dependencies[moduleName]) as ts.Extension,
  //       });
  //     } else {
  //       // The module is not in the resolver database. I've seen this happen with
  //       // "import type" modules in flow projects like react-native. These are ok
  //       // to ignore.
  //       //
  //       // If other imports come through here, then it might lead to problems.
  //       // There's no way to differentiate, though. TypeScript doesn't expose the
  //       // import AST node.
  //       //
  //       // If you are running into missing types or other unusual TypeScript errors,
  //       // uncomment the line below for additional tracing.
  //       //
  //       //console.log(`resolver: ${containingFile}: cannot find ${moduleName}`);
  //       resolvedModules.push(undefined);
  //     }
  //   }

  //   return resolvedModules;
  // }

  // private tryResolverDB(
  //   moduleName: string,
  //   containingFile: string
  // ): ts.ResolvedModuleFull | undefined {
  //   if (this.hasFile(containingFile)) {
  //     const dependencies = this.fileDependencies[containingFile];
  //     if (moduleName in dependencies) {
  //       const fileName = dependencies[moduleName];
  //       return {
  //         resolvedFileName: fileName,
  //         extension: path.extname(fileName) as ts.Extension,
  //       };
  //     }
  //   }
  //   return undefined;
  // }

  // private tryTSResolver(
  //   moduleName: string,
  //   containingFile: string,
  //   redirectedReference?: ts.ResolvedProjectReference
  // ): ts.ResolvedModuleFull | undefined {
  //   const result = ts.resolveModuleName(
  //     moduleName,
  //     containingFile,
  //     this.options,
  //     this.moduleResolutionHost,
  //     this.moduleResolutionCache,
  //     redirectedReference
  //   );
  // get parent dir (strip off .js filename)
  // for each parent dir [loadModuleFromNearestNodeModulesDirectory]
  //   if current parent dir != node_modules,
  //      [loadModuleFromImmediateNodeModulesDirectory]
  //      append node_modules
  //      [loadModuleFromSpecificNodeModulesDirectory]
  //      get package.json
  // ***> try reading from typings, types, main
  //      if none of these props are set, try loading from <current parent dir>/node_modules/index
  //         and use the normal variety of extensions: .ts, .tsx, .d.ts
  //      if that doesn't work,
  //         get mangled package name via ts.mangleScopedPackageName() (@babel/core --> babel__core)
  //         try loading from <current parent dir>/node_modules/@types/<mangled name>
  //         << logic starts at ***> marker above, but only uses the .d.ts extension >>
  /*
  failed lookup locations before finding @types/react-native/package.json, and finding a prop that referred to the root types

  "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/react-native/package.json",
  "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/react-native.ts",
  "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/react-native.tsx",
  "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/react-native.d.ts",
  "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/react-native/index.ts",
  "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/react-native/index.tsx",
  "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/react-native/index.d.ts",
  "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/@types/react-native/package.json",
  "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/@types/react-native.d.ts",
  "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/@types/react-native/index.d.ts",

  "/Users/afoxman/repos/rnx-kit/packages/test-app/node_modules/react-native/package.json",
  "/Users/afoxman/repos/rnx-kit/packages/test-app/node_modules/react-native.ts",
  "/Users/afoxman/repos/rnx-kit/packages/test-app/node_modules/react-native.tsx",
  "/Users/afoxman/repos/rnx-kit/packages/test-app/node_modules/react-native.d.ts",
  "/Users/afoxman/repos/rnx-kit/packages/test-app/node_modules/react-native/index.ts",
  "/Users/afoxman/repos/rnx-kit/packages/test-app/node_modules/react-native/index.tsx",
  "/Users/afoxman/repos/rnx-kit/packages/test-app/node_modules/react-native/index.d.ts",
  "/Users/afoxman/repos/rnx-kit/packages/test-app/node_modules/@types/react-native/package.json",
  "/Users/afoxman/repos/rnx-kit/packages/test-app/node_modules/@types/react-native.d.ts",
  "/Users/afoxman/repos/rnx-kit/packages/test-app/node_modules/@types/react-native/index.d.ts",
  "/Users/afoxman/repos/rnx-kit/packages/node_modules/react-native/package.json",
  "/Users/afoxman/repos/rnx-kit/packages/node_modules/react-native.ts",
  "/Users/afoxman/repos/rnx-kit/packages/node_modules/react-native.tsx",
  "/Users/afoxman/repos/rnx-kit/packages/node_modules/react-native.d.ts",
  "/Users/afoxman/repos/rnx-kit/packages/node_modules/react-native/index.ts",
  "/Users/afoxman/repos/rnx-kit/packages/node_modules/react-native/index.tsx",
  "/Users/afoxman/repos/rnx-kit/packages/node_modules/react-native/index.d.ts",
  "/Users/afoxman/repos/rnx-kit/packages/node_modules/@types/react-native/package.json",
  "/Users/afoxman/repos/rnx-kit/packages/node_modules/@types/react-native.d.ts",
  "/Users/afoxman/repos/rnx-kit/packages/node_modules/@types/react-native/index.d.ts",
  "/Users/afoxman/repos/rnx-kit/node_modules/react-native.ts",
  "/Users/afoxman/repos/rnx-kit/node_modules/react-native.tsx",
  "/Users/afoxman/repos/rnx-kit/node_modules/react-native.d.ts",
  "/Users/afoxman/repos/rnx-kit/node_modules/react-native/index.ts",
  "/Users/afoxman/repos/rnx-kit/node_modules/react-native/index.tsx",
  "/Users/afoxman/repos/rnx-kit/node_modules/react-native/index.d.ts",
  "/Users/afoxman/repos/rnx-kit/node_modules/@types/react-native.d.ts",
]
    */

  //   return result.resolvedModule;
  // }

  private findDtsInNamedModule(
    namedModule: NamedModuleComponents,
    searchRoot: string
  ): string | undefined {
    // Start searching from the root of the JS file's package.
    const pkgFile = pkgUp.sync({ cwd: searchRoot });
    if (pkgFile) {
      const dtsFile = findUp.sync(
        (directory) => {
          // If we're in a node_modules directory already, skip to the parent
          if (path.basename(directory) === "node_modules") {
            return undefined;
          }

          // Build the path to the module package and see if it exists
          const typesPkgFile = path.join(
            directory,
            "node_modules",
            namedModule.scope ?? "",
            namedModule.moduleName,
            "package.json"
          );
          if (!fs.existsSync(typesPkgFile)) {
            return undefined;
          }
          const typesPkgDir = path.dirname(typesPkgFile);

          // Look for a .d.ts file
          if (namedModule.modulePath) {
            // This module has a path, such as 'scheduler/tracing'. Look for
            // a .d.ts file matching the path. E.g. '<root>/tracing.d.ts'.
            const dtsFile =
              path.join(typesPkgDir, ...namedModule.modulePath.split("/")) +
              ".d.ts";
            if (fs.existsSync(dtsFile)) {
              return dtsFile;
            }
          } else {
            // This module does not have a path. Look in package.json for
            // the root type file, falling back on 'index.d.ts'.
            const typesPkg = JSON.parse(fs.readFileSync(typesPkgFile, "utf-8"));
            if (typesPkg.typings) {
              const typingsFile = path.resolve(typesPkgDir, typesPkg.typings);
              if (fs.existsSync(typingsFile)) {
                return typingsFile;
              }
            }
            if (typesPkg.types) {
              const typesFile = path.resolve(typesPkgDir, typesPkg.types);
              if (fs.existsSync(typesFile)) {
                return typesFile;
              }
            }
            const indexFile = path.join(typesPkgDir, "index.d.ts");
            if (fs.existsSync(indexFile)) {
              return indexFile;
            }
          }

          // At this point, we've found the @types package, but we couldn't
          // find a matching .d.ts file for the input JS file. Stop the search.
          return findUp.stop;
        },
        {
          cwd: path.dirname(pkgFile),
        }
      );

      return dtsFile;
    }

    return undefined;
  }

  private findAtTypesModuleForNamedModule(
    namedModule: NamedModuleComponents,
    searchRoot: string
  ): string | undefined {
    // Start searching from the root of the JS file's package.
    const pkgFile = pkgUp.sync({ cwd: searchRoot });
    if (pkgFile) {
      const dtsFile = findUp.sync(
        (directory) => {
          // If we're in a node_modules directory already, skip to the parent
          if (path.basename(directory) === "node_modules") {
            return undefined;
          }

          // Build the path to the @types package and see if it exists
          const typesPkgFile = path.join(
            directory,
            "node_modules",
            "@types",
            namedModule.mangledName,
            "package.json"
          );
          if (!fs.existsSync(typesPkgFile)) {
            return undefined;
          }
          const typesPkgDir = path.dirname(typesPkgFile);

          // Look for a .d.ts file
          if (namedModule.modulePath) {
            // This module has a path, such as 'scheduler/tracing'. Look for
            // a .d.ts file matching the path. E.g. '<root>/tracing.d.ts'.
            const dtsFile =
              path.join(typesPkgDir, ...namedModule.modulePath.split("/")) +
              ".d.ts";
            if (fs.existsSync(dtsFile)) {
              return dtsFile;
            }
          } else {
            // This module does not have a path. Look in package.json for
            // the root type file, falling back on 'index.d.ts'.
            const typesPkg = JSON.parse(fs.readFileSync(typesPkgFile, "utf-8"));
            if (typesPkg.typings) {
              const typingsFile = path.resolve(typesPkgDir, typesPkg.typings);
              if (fs.existsSync(typingsFile)) {
                return typingsFile;
              }
            }
            if (typesPkg.types) {
              const typesFile = path.resolve(typesPkgDir, typesPkg.types);
              if (fs.existsSync(typesFile)) {
                return typesFile;
              }
            }
            const indexFile = path.join(typesPkgDir, "index.d.ts");
            if (fs.existsSync(indexFile)) {
              return indexFile;
            }
          }

          // At this point, we've found the @types package, but we couldn't
          // find a matching .d.ts file for the input JS file. Stop the search.
          return findUp.stop;
        },
        {
          cwd: path.dirname(pkgFile),
        }
      );

      return dtsFile;
    }

    return undefined;
  }

  /**
   * Using a given JavaScript file, find the corresponding TypeScript source
   * or declaration file.
   *
   * @param moduleRef Module reference to the JavaScript file, such as 'mod', '@scope/mod', 'mod/path/to/file', or '@scope/mod/path/to/file'
   * @param jsFileName JavsScript file
   * @returns TypeScript source or declaration file, or undefined if none were found
   */
  private findMatchingTypeScriptFile(
    moduleRef: string,
    jsFileName: string
  ): string | undefined {
    // get parent dir (strip off .js filename)
    // for each parent dir [loadModuleFromNearestNodeModulesDirectory]
    //   if current parent dir != node_modules,
    //      [loadModuleFromImmediateNodeModulesDirectory]
    //      append node_modules
    //      [loadModuleFromSpecificNodeModulesDirectory]
    //      get package.json
    // ***> try reading from typings, types, main
    //      if none of these props are set, try loading from <current parent dir>/node_modules/index
    //         and use the normal variety of extensions: .ts, .tsx, .d.ts
    //      if that doesn't work,
    //         get mangled package name via ts.mangleScopedPackageName() (@babel/core --> babel__core)
    //         try loading from <current parent dir>/node_modules/@types/<mangled name>
    //         << logic starts at ***> marker above, but only uses the .d.ts extension >>
    /*
    Node file search pattern

      "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/react-native/package.json",
      "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/react-native.ts",
      "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/react-native.tsx",
      "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/react-native.d.ts",
      "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/react-native/index.ts",
      "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/react-native/index.tsx",
      "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/react-native/index.d.ts",
      "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/@types/react-native/package.json",
      "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/@types/react-native.d.ts",
      "/Users/afoxman/repos/rnx-kit/packages/test-app/src/node_modules/@types/react-native/index.d.ts",

    When package.json exists, look for 'typings', 'types', and 'main' for a file name -- in that order

    */

    // NodeJS modules: modules.buildinModules: string[]

    // moduleName and jsFileName forms:
    // 'xxx'          /stuff/xxx/index.js
    // '@scope/xxx'   /stuff/xxx/index.js
    //
    //   try for adjacent .ts, .tsx, .d.ts
    //   try for @types package
    //
    // 'xxx/a/b/c'    /stuff/xxx/a/b/c.js
    //
    //   try for adjacent .ts, .tsx, .d.ts
    //   try for @types package for xxx
    //
    // './foo'        /stuff/xxx/foo.js
    //                /stuff/xxx/a/b/foo.js
    //
    //   try for adjacent .ts, .tsx, .d.ts
    //

    const ext = path.extname(jsFileName);
    const baseFileName = jsFileName.slice(0, -ext.length);

    // Look for source files or a declaration file right next to the input file
    if (fs.existsSync(baseFileName + ".ts")) {
      return baseFileName + ".ts";
    } else if (fs.existsSync(baseFileName + ".tsx")) {
      return baseFileName + ".tsx";
    } else if (fs.existsSync(baseFileName + ".d.ts")) {
      return baseFileName + ".d.ts";
    }

    const components = parseModuleRef(moduleRef);
    if (isNamedModule(components)) {
      // This is a named module. Look for a corresponding @types module.
      // Return the matching .d.ts file for this module reference.

      return this.findAtTypesModuleForNamedModule(
        components,
        path.dirname(jsFileName)
      );
    }

    // We didn't find a correspoding TypeScript source or declaration file.
    return undefined;

    // find dir of package.json for jsFileName
    // for each dir walking up the tree,
    //    if (basename(dir) === node_modules) continue;
    //    x = dir + "/node_modules/@types/" + mangledName + "/package.json"  (need to handle windows slashes too -- use path.join)
    //    if exists(x),
    //       if modulePath,
    //          f = dirname(x) + modulePath + ".d.ts"
    //          if exists(f) return f
    //       else
    //          try typings, then types, returning either if exists
    //          f = dirname(x) + '/index.d.ts'
    //          if exists(f) return f

    //   const moduleRootPathSegment =
    //     "/node_modules/" +
    //     (components.scope
    //       ? components.scope + "/" + components.moduleName
    //       : components.moduleName);
    //   const idxModuleRootPathSegment = jsFileName.lastIndexOf(
    //     moduleRootPathSegment
    //   );
    //   if (idxModuleRootPathSegment !== -1) {
    //     const jsFileModuleRoot = jsFileName.slice(
    //       0,
    //       idxModuleRootPathSegment + moduleRootPathSegment.length
    //     );

    //     const typeFile = findUp.sync(
    //       (directory: string): string | undefined => {
    //         if (path.basename(directory).toLowerCase() !== "node_modules") {
    //           const rootPath = path.join(
    //             directory,
    //             "node_modules",
    //             "@types",
    //             components.mangledName!
    //           );

    //           // Make sure this is a valid package
    //           const pkgFile = path.join(rootPath, "package.json");
    //           if (fs.existsSync(pkgFile)) {
    //             // Search for type info in the package metadata.
    //             const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf-8"));
    //             if (pkg.typings) {
    //               const typingsFile = path.resolve(rootPath, pkg.typings);
    //               if (fs.existsSync(typingsFile)) {
    //                 return typingsFile;
    //               }
    //             }
    //             if (pkg.types) {
    //               const typesFile = path.resolve(rootPath, pkg.types);
    //               if (fs.existsSync(typesFile)) {
    //                 return typesFile;
    //               }
    //             }

    //             // See if there is a .d.ts file named after the type module.
    //             // I don't know where this convention comes from, but it's
    //             // part of the TypeScript search algorithm.
    //             const dtsModuleFile = rootPath + ".d.ts";
    //             if (fs.existsSync(dtsModuleFile)) {
    //               return dtsModuleFile;
    //             }

    //             // See if the type module has an index file.
    //             const indexFile = path.join(rootPath, "index.d.ts");
    //             if (fs.existsSync(indexFile)) {
    //               return indexFile;
    //             }
    //           }
    //         }
    //         return undefined;
    //       },
    //       { cwd: jsFileModuleRoot }
    //     );
    //     if (typeFile) {
    //       return typeFile;
    //     }
    //   }
    // }
  }

  public resolveModuleUsingDependencyMap(
    dependencies: DependencyMap,
    moduleName: string
  ): ts.ResolvedModuleFull | undefined {
    if (moduleName in dependencies) {
      let fileName = dependencies[moduleName];

      // 1. cache of module-name to type file
      // 2. when looking up modules in a .d.ts file (which won't be in the resolver db), allow use of the cache
      // 3. when looking up

      const ext = path.extname(fileName).toLowerCase();
      if (ext === ".js" || ext === ".jsx") {
        // The file is JavaScript, so it might have a matching TypeScript
        // source or declaration file.
        const tsFileName = this.findMatchingTypeScriptFile(
          moduleName,
          fileName
        );
        if (tsFileName) {
          fileName = tsFileName;
        }
      }

      console.log(`   ${moduleName} -> ${fileName}`);
      return {
        resolvedFileName: fileName,
        extension: path.extname(fileName) as ts.Extension,
      };
    }

    if (module.builtinModules.indexOf(moduleName) !== -1) {
      console.log(`   ${moduleName} -> IGNORED: built-in module`);
      return undefined;
    }

    console.log(`   ${moduleName} -> NO RESOLUTION: module not in list`);
    return undefined;
  }

  public resolveDtsModule(
    containingFile: string,
    moduleName: string
  ): ts.ResolvedModuleFull | undefined {
    if (module.builtinModules.indexOf(moduleName) !== -1) {
      console.log(`   ${moduleName} -> IGNORED: built-in module`);
      return undefined;
    }

    let dtsFile: string | undefined = undefined;
    const components = parseModuleRef(moduleName);
    if (isNamedModule(components)) {
      dtsFile = this.findDtsInNamedModule(
        components,
        path.dirname(containingFile)
      );
      if (!dtsFile) {
        dtsFile = this.findAtTypesModuleForNamedModule(
          components,
          path.dirname(containingFile)
        );
      }
    } else if (components.modulePath) {
      // resolve the relative module path using the containing file.
      // look for the .d.ts file named by the module.
      const target =
        path.join(path.dirname(containingFile), components.modulePath) +
        ".d.ts";
      if (fs.existsSync(target)) {
        dtsFile = target;
      }
    }

    if (dtsFile) {
      console.log(`   ${moduleName} -> ${dtsFile}`);
      return {
        resolvedFileName: dtsFile,
        extension: path.extname(dtsFile) as ts.Extension,
      };
    }

    console.log(`   ${moduleName} -> NO RESOLUTION: cannot find .d.ts file`);
    return undefined;
  }

  /**
   * Resolve the given modules to their TypeScript source files or declaration files.
   *
   * @param moduleNames List of module names to resolve
   * @param containingFile File which is importing/requiring each module
   * @returns Array of resolved modules or undefined if there is no resolution. Contains one entry per module name.
   */
  public resolveModuleNames(
    moduleNames: string[],
    containingFile: string,
    _reusedNames: string[] | undefined,
    _redirectedReference?: ts.ResolvedProjectReference
  ): (ts.ResolvedModuleFull | undefined)[] {
    console.log(`${containingFile}`);

    if (this.hasFile(containingFile)) {
      const dependencies = this.fileDependencies[containingFile];
      return moduleNames.map((m) =>
        this.resolveModuleUsingDependencyMap(dependencies, m)
      );
    }

    // .d.ts files aren't going to be in the resolver database because
    // they aren't source files -- they're declaration files. allow module
    // lookups from them so that dependendent .d.ts files can be loaded.
    if (containingFile.toLowerCase().endsWith(".d.ts")) {
      return moduleNames.map((m) => this.resolveDtsModule(containingFile, m));
    }

    console.log(`   * -> NO RESOLUTION: containing file not in list`);
    return moduleNames.map((_) => undefined);
  }

  // public XresolveModuleNames(
  //   moduleNames: string[],
  //   containingFile: string,
  //   _reusedNames: string[] | undefined,
  //   redirectedReference?: ts.ResolvedProjectReference
  // ): (ts.ResolvedModuleFull | undefined)[] {
  //   if (this.hasFile(containingFile)) {
  //     return this.resolveModuleNamesUsingDependencyMap(
  //       moduleNames,
  //       this.fileDependencies[containingFile]
  //     );
  //   }

  //   // parent file is not in the database.

  //   // if it's a .d.ts file, then that's expected.
  //   // we should look on disk, outside of the resolver's file database.
  //   // we'll use the normal "node" method of resolving the file, but at each
  //   // directory, we'll look for a matching file using a set of patterns which include platform overrides.

  //   const isDts = containingFile.toLowerCase().endsWith(".d.ts");
  //   if (isDts) {
  //     console.log(`D.TS MODULES ${containingFile}`);

  //     const resolvedModules: (ts.ResolvedModuleFull | undefined)[] = [];
  //     for (const moduleName of moduleNames) {
  //       // try to use standard resolution
  //       const result = ts.resolveModuleName(
  //         moduleName,
  //         containingFile,
  //         this.options,
  //         this.moduleResolutionHost,
  //         this.moduleResolutionCache,
  //         redirectedReference
  //       );
  //       console.log(
  //         `   ${moduleName} -> ${result.resolvedModule?.resolvedFileName}`
  //       );
  //       resolvedModules.push(result.resolvedModule);
  //     }
  //     return resolvedModules;
  //     // The context is a .d.ts file, which is a TypeScript symbol file. Symbol files
  //     // don't show up in the resolver database because they aren't use for bundling,
  //     // so Metro won't see or report them to us.
  //     //
  //     // To make typechecking work, we need to resolve each module. Since we're doing
  //     // this on our own (without Metro), we need our search to include platform
  //     // overrides. For example, module './Foo' could resolve to './Foo.ios.ts' or
  //     // './Foo.native.ts'.
  //     //
  //     //
  //     //   const resolvedModules: (ts.ResolvedModuleFull | undefined)[] = [];
  //     //   console.log(
  //     //     "nodejs-search: " +
  //     //       `: ${containingFile}: ${moduleNames.length} module(s) to resolve`
  //     //   );
  //     //   for (const moduleName of moduleNames) {
  //     //     try {
  //     //       const p = require.resolve(moduleName, {
  //     //         paths: [path.dirname(containingFile)],
  //     //       });
  //     //       console.log(`   ${moduleName} -> ${p}`);
  //     //     } catch (e) {
  //     //       console.warn(`   ${moduleName}: ${e.message ?? e}`);
  //     //     }
  //     //     resolvedModules.push(undefined);
  //     //   }
  //     //   return resolvedModules;
  //   }

  //   console.error(`MISSING ${containingFile}`);
  //   moduleNames.map((m) => console.error(`   ${m}`));

  //   return moduleNames.map(() => undefined);
  // }

  // TODO: implement this
  public getResolvedModuleWithFailedLookupLocationsFromCache(
    _modulename: string,
    _containingFile: string
  ): ts.ResolvedModuleWithFailedLookupLocations | undefined {
    throw new Error("Not implemented");
  }

  public resolveTypeReferenceDirectives(
    typeDirectiveNames: string[],
    containingFile: string,
    redirectedReference?: ts.ResolvedProjectReference
  ): (ts.ResolvedTypeReferenceDirective | undefined)[] {
    console.log(`resolveType: ${containingFile}`);
    const resolved: (ts.ResolvedTypeReferenceDirective | undefined)[] = [];
    for (const name of typeDirectiveNames) {
      const result = ts.resolveTypeReferenceDirective(
        name,
        containingFile,
        this.options,
        this.moduleResolutionHost,
        redirectedReference
      );
      resolved.push(result.resolvedTypeReferenceDirective);
      if (result.resolvedTypeReferenceDirective) {
        console.log(
          `   ${name} -> ${
            result.resolvedTypeReferenceDirective.primary ? "P" : "!P"
          } ${result.resolvedTypeReferenceDirective?.resolvedFileName}`
        );
      } else {
        console.log(
          `   ${name} -> FAILED: ${result.failedLookupLocations.join(
            "\n           "
          )}`
        );
      }
    }
    return resolved;
  }
}
