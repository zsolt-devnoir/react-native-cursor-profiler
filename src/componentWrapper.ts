import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { parse } from "@babel/parser";
import traverse, { NodePath } from "@babel/traverse";
import generate from "@babel/generator";
import * as t from "@babel/types";

/**
 * Automatically wraps React Native components with withProfiler HOC using AST transformation.
 * This is more reliable than regex-based approaches as it understands code structure.
 */
export class ComponentWrapper {
  private withProfilerImportPath: string = "";

  /**
   * Recursively searches for withProfiler file anywhere in the directory
   */
  private findWithProfilerFileRecursive(
    dir: string,
    visited: Set<string> = new Set()
  ): string | null {
    // Avoid infinite loops and skip common directories that shouldn't be searched
    const normalizedDir = path.normalize(dir);
    if (visited.has(normalizedDir)) {
      return null;
    }
    visited.add(normalizedDir);

    // Skip node_modules, .git, and other common ignore patterns
    const dirName = path.basename(dir);
    if (
      dirName === "node_modules" ||
      dirName === ".git" ||
      dirName === ".next" ||
      dirName === "dist" ||
      dirName === "build" ||
      dirName === ".expo" ||
      dirName.startsWith(".")
    ) {
      return null;
    }

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      // First, check for withProfiler files in current directory
      for (const entry of entries) {
        if (entry.isFile()) {
          const fileName = entry.name.toLowerCase();
          if (
            fileName === "withprofiler.tsx" ||
            fileName === "withprofiler.ts" ||
            fileName === "withprofiler.jsx" ||
            fileName === "withprofiler.js"
          ) {
            const fullPath = path.join(dir, entry.name);
            // Verify it exports withProfiler
            try {
              const content = fs.readFileSync(fullPath, "utf8");
              if (
                content.includes("withProfiler") ||
                (content.includes("export") && content.includes("withProfiler"))
              ) {
                return fullPath;
              }
            } catch (error) {
              // Continue searching
            }
          }
        }
      }

      // Then recursively search subdirectories
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subDir = path.join(dir, entry.name);
          const found = this.findWithProfilerFileRecursive(subDir, visited);
          if (found) {
            return found;
          }
        }
      }
    } catch (error) {
      // Ignore permission errors and continue
    }

    return null;
  }

  /**
   * Finds the withProfiler file anywhere in the React Native project
   */
  private findWithProfilerFile(
    workspaceRoot: string,
    componentFilePath: string
  ): string | null {
    // Find React Native project root by looking for package.json with react-native
    let rnProjectRoot = workspaceRoot;

    // Try to find React Native project directory
    const componentDir = path.dirname(
      path.join(workspaceRoot, componentFilePath)
    );
    let currentDir = componentDir;

    // Search upward for package.json with react-native
    for (let i = 0; i < 10; i++) {
      const packageJsonPath = path.join(currentDir, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(
            fs.readFileSync(packageJsonPath, "utf8")
          );
          const hasReactNative =
            packageJson.dependencies?.["react-native"] ||
            packageJson.devDependencies?.["react-native"];
          if (hasReactNative) {
            rnProjectRoot = currentDir;
            break;
          }
        } catch (error) {
          // Continue searching
        }
      }

      const parent = path.dirname(currentDir);
      if (parent === currentDir) break; // Reached root
      currentDir = parent;
    }

    // Search recursively from React Native project root
    const found = this.findWithProfilerFileRecursive(rnProjectRoot);
    if (found) {
      return found;
    }

    // If not found in RN project, search from workspace root
    if (rnProjectRoot !== workspaceRoot) {
      const foundInWorkspace =
        this.findWithProfilerFileRecursive(workspaceRoot);
      if (foundInWorkspace) {
        return foundInWorkspace;
      }
    }

    return null;
  }

  /**
   * Wraps a component in its source file using AST transformation
   */
  async wrapComponent(
    componentPath: string,
    componentName: string,
    workspaceRoot: string
  ): Promise<boolean> {
    try {
      // Handle component path format: "path/to/file.tsx::ComponentName" or just "path/to/file.tsx"
      const [filePath] = componentPath.split("::");
      const fullPath = path.join(workspaceRoot, filePath);

      if (!fs.existsSync(fullPath)) {
        console.error(`Component file not found: ${fullPath}`);
        return false;
      }

      // Find the withProfiler file dynamically
      const withProfilerPath = this.findWithProfilerFile(
        workspaceRoot,
        filePath
      );
      if (!withProfilerPath) {
        console.error(
          `Could not find withProfiler file. Please ensure withProfiler.tsx exists in your project.`
        );
        return false;
      }

      // Calculate relative path from component file to withProfiler file
      const componentFileDir = path.dirname(fullPath);
      const relativePath = path.relative(componentFileDir, withProfilerPath);
      // Remove file extension and normalize path separators
      this.withProfilerImportPath = relativePath
        .replace(/\.(tsx|ts|jsx|js)$/, "")
        .replace(/\\/g, "/");

      // Ensure path starts with ./ or ../
      if (!this.withProfilerImportPath.startsWith(".")) {
        this.withProfilerImportPath = "./" + this.withProfilerImportPath;
      }

      const originalContent = fs.readFileSync(fullPath, "utf8");

      // Try to wrap using AST transformation
      const transformedContent = await this.wrapComponentWithAST(
        originalContent,
        componentName,
        fullPath
      );

      // Only write if content changed
      if (transformedContent && transformedContent !== originalContent) {
        fs.writeFileSync(fullPath, transformedContent, "utf8");
        return true;
      }

      return false;
    } catch (error: any) {
      console.error(`Error wrapping component ${componentName}:`, error);
      // If AST transformation fails, log the error but don't crash
      return false;
    }
  }

  /**
   * Wraps a component using AST transformation
   */
  private async wrapComponentWithAST(
    code: string,
    componentName: string,
    filePath: string
  ): Promise<string | null> {
    try {
      // Determine if file is TypeScript/TSX or JavaScript/JSX
      const isTypeScript =
        filePath.endsWith(".ts") || filePath.endsWith(".tsx");
      const isJSX = filePath.endsWith(".tsx") || filePath.endsWith(".jsx");

      // Parse code into AST
      const ast = parse(code, {
        sourceType: "module",
        plugins: [
          "jsx",
          "typescript",
          "decorators-legacy",
          "classProperties",
          "objectRestSpread",
          "asyncGenerators",
          "functionBind",
          "exportDefaultFrom",
          "exportNamespaceFrom",
          "dynamicImport",
          "nullishCoalescingOperator",
          "optionalChaining",
        ],
        allowImportExportEverywhere: true,
        allowReturnOutsideFunction: true,
      });

      let wrappedCount = 0;
      let hasWithProfilerImport = false;
      let importInsertionIndex = 0;
      const self = this; // Store reference to this for use in callbacks

      // First pass: Check if withProfiler is already imported
      traverse(ast, {
        ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
          if (path.node.source.value.includes("withProfiler")) {
            hasWithProfilerImport = true;
          }
          // Track the last import to know where to insert new imports
          const bodyIndex = ast.program.body.indexOf(path.node);
          if (bodyIndex > importInsertionIndex) {
            importInsertionIndex = bodyIndex;
          }
        },
      });

      // Second pass: Transform components
      traverse(ast, {
        // Handle export default function ComponentName() {}
        ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
          const declaration = path.node.declaration;

          // Skip if already wrapped
          if (self.isAlreadyWrapped(declaration)) {
            return;
          }

          let targetComponent: t.Identifier | null = null;
          let componentIdentifier: string = componentName;

          // Case 1: export default function ComponentName() {}
          if (t.isFunctionDeclaration(declaration) && declaration.id) {
            if (declaration.id.name === componentName) {
              targetComponent = declaration.id;
              componentIdentifier = declaration.id.name;
            }
          }
          // Case 2: export default const ComponentName = ...
          else if (t.isVariableDeclaration(declaration)) {
            const varDecl = declaration as t.VariableDeclaration;
            if (varDecl.declarations.length > 0) {
              const firstDeclarator = varDecl.declarations[0];
              if (
                t.isIdentifier(firstDeclarator.id) &&
                firstDeclarator.id.name === componentName
              ) {
                targetComponent = firstDeclarator.id;
                componentIdentifier = firstDeclarator.id.name;
              }
            }
          }
          // Case 3: export default ComponentName (identifier reference)
          else if (t.isIdentifier(declaration)) {
            if (declaration.name === componentName) {
              targetComponent = declaration;
              componentIdentifier = declaration.name;
            }
          }
          // Case 4: export default class ComponentName extends ...
          else if (t.isClassDeclaration(declaration) && declaration.id) {
            if (declaration.id.name === componentName) {
              targetComponent = declaration.id;
              componentIdentifier = declaration.id.name;
            }
          }

          if (targetComponent) {
            // Wrap the declaration with withProfiler
            const wrappedCall = t.callExpression(t.identifier("withProfiler"), [
              targetComponent,
              t.stringLiteral(componentIdentifier),
            ]);

            // Replace the export with wrapped version
            path.node.declaration = wrappedCall;
            wrappedCount++;
          }
        },

        // Handle named exports: export const ComponentName = () => {}
        ExportNamedDeclaration(path: NodePath<t.ExportNamedDeclaration>) {
          if (path.node.exportKind === "type") {
            return; // Skip type exports
          }

          const declaration = path.node.declaration;

          // Handle: export const ComponentName = ...
          if (t.isVariableDeclaration(declaration)) {
            for (const declarator of declaration.declarations) {
              if (
                t.isIdentifier(declarator.id) &&
                declarator.id.name === componentName &&
                self.isLikelyComponent(declarator.init)
              ) {
                // Skip if already wrapped
                if (self.isAlreadyWrapped(declarator.init)) {
                  continue;
                }

                // Wrap the initializer
                if (declarator.init) {
                  declarator.init = t.callExpression(
                    t.identifier("withProfiler"),
                    [declarator.init, t.stringLiteral(componentName)]
                  );
                  wrappedCount++;
                }
              }
            }
          }
          // Handle: export function ComponentName() {}
          else if (t.isFunctionDeclaration(declaration) && declaration.id) {
            if (declaration.id.name === componentName) {
              // Skip if already wrapped
              if (self.isAlreadyWrapped(declaration)) {
                return;
              }

              // For named function exports, we need to:
              // 1. Remove the export from the function declaration (make it a regular function)
              // 2. Add a new export statement after it that wraps the function

              // Get the program body to insert nodes
              const programPath = path.findParent((p) => t.isProgram(p.node));
              if (!programPath || !t.isProgram(programPath.node)) {
                return;
              }

              // Create a function declaration without export
              const functionDecl = t.functionDeclaration(
                declaration.id,
                declaration.params,
                declaration.body,
                declaration.generator,
                declaration.async
              );

              // Create the wrapped export: export const ComponentName = withProfiler(ComponentName, 'ComponentName');
              const wrappedCall = t.callExpression(
                t.identifier("withProfiler"),
                [t.identifier(componentName), t.stringLiteral(componentName)]
              );

              const wrappedExport = t.exportNamedDeclaration(
                t.variableDeclaration("const", [
                  t.variableDeclarator(
                    t.identifier(componentName),
                    wrappedCall
                  ),
                ])
              );

              // Replace the export with the function declaration, then insert wrapped export after it
              const currentIndex = programPath.node.body.indexOf(path.node);
              path.replaceWith(functionDecl);
              // Insert wrapped export after the function
              programPath.node.body.splice(currentIndex + 1, 0, wrappedExport);

              wrappedCount++;
            }
          }
        },
      });

      // Add import if needed
      if (wrappedCount > 0 && !hasWithProfilerImport) {
        const importDeclaration = t.importDeclaration(
          [
            t.importSpecifier(
              t.identifier("withProfiler"),
              t.identifier("withProfiler")
            ),
          ],
          t.stringLiteral(this.withProfilerImportPath)
        );

        // Insert after the last import, or at the beginning if no imports
        if (importInsertionIndex >= 0 && ast.program.body.length > 0) {
          ast.program.body.splice(
            importInsertionIndex + 1,
            0,
            importDeclaration
          );
        } else {
          ast.program.body.unshift(importDeclaration);
        }
      }

      // Generate code from AST
      if (wrappedCount > 0) {
        // Use options that preserve formatting as much as possible
        const result = generate(
          ast,
          {
            retainLines: true, // Preserve original line numbers
            compact: false,
            comments: true, // Preserve comments
            concise: false,
            minified: false,
            jsescOption: {
              quotes: "single",
              wrap: true,
            },
          },
          code
        );

        return result.code;
      }

      return null; // No changes made
    } catch (error: any) {
      console.error("AST transformation error:", error);
      // Return null to indicate failure - caller will handle gracefully
      return null;
    }
  }

  /**
   * Checks if a node is already wrapped with withProfiler
   */
  private isAlreadyWrapped(node: t.Node | null | undefined): boolean {
    if (!node) return false;

    // Check if it's a call expression to withProfiler
    if (t.isCallExpression(node)) {
      if (t.isIdentifier(node.callee) && node.callee.name === "withProfiler") {
        return true;
      }
    }

    // Check if it's an identifier that references a wrapped component
    // (This is harder to detect without full scope analysis, so we'll be conservative)
    return false;
  }

  /**
   * Heuristic to determine if a value is likely a React component
   */
  private isLikelyComponent(node: t.Node | null | undefined): boolean {
    if (!node) return false;

    // Arrow functions
    if (t.isArrowFunctionExpression(node)) return true;

    // Function expressions
    if (t.isFunctionExpression(node)) return true;

    // Call expressions that might return components (React.memo, forwardRef, etc.)
    if (t.isCallExpression(node)) {
      if (t.isIdentifier(node.callee)) {
        const calleeName = node.callee.name;
        if (["memo", "forwardRef", "lazy"].includes(calleeName)) {
          return true;
        }
      }
      // Could be React.memo(...) or React.forwardRef(...)
      if (t.isMemberExpression(node.callee)) {
        if (
          t.isIdentifier(node.callee.property) &&
          ["memo", "forwardRef", "lazy"].includes(node.callee.property.name)
        ) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Calculates relative path between two paths
   */
  private calculateRelativePath(from: string, to: string): string {
    try {
      // Normalize paths
      const fromNormalized = path.normalize(from).split(path.sep);
      const toNormalized = path.normalize(to).split(path.sep);

      // Remove empty parts
      const fromParts = fromNormalized.filter((p) => p && p !== ".");
      const toParts = toNormalized.filter((p) => p && p !== ".");

      // Find common prefix
      let commonLength = 0;
      const minLength = Math.min(fromParts.length, toParts.length);
      for (let i = 0; i < minLength; i++) {
        if (fromParts[i] === toParts[i]) {
          commonLength++;
        } else {
          break;
        }
      }

      // Calculate relative path
      const upLevels = fromParts.length - commonLength;
      const relativeParts = toParts.slice(commonLength);
      const relativePath = "../".repeat(upLevels) + relativeParts.join("/");

      // If same directory, use './'
      if (relativePath === "") {
        return (
          "./" +
          (relativeParts.length > 0 ? relativeParts.join("/") : "withProfiler")
        );
      }

      return (
        relativePath ||
        "./" +
          (relativeParts.length > 0 ? relativeParts.join("/") : "withProfiler")
      );
    } catch (error) {
      // Fallback to simple relative path
      return "../utils/withProfiler";
    }
  }
}
