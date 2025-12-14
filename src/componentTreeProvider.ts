import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { ComponentTreeNode } from "./types";

/**
 * Provides component tree structure by scanning React Native project files
 */
export class ComponentTreeProvider {
  private context: vscode.ExtensionContext;
  private workspaceRoot: string | undefined;
  private fileCount: number = 0;
  private maxFilesToScan: number = 1000; // Limit total files to prevent infinite scanning

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      this.workspaceRoot = workspaceFolders[0].uri.fsPath;
    }
  }

  /**
   * Finds the React Native project directory (supports monorepos)
   */
  private async findReactNativeProject(): Promise<string | null> {
    if (!this.workspaceRoot) {
      return null;
    }

    const commonPaths = [
      "", // Root
      "apps/mobile",
      "apps/react-native",
      "packages/mobile",
      "packages/app",
      "mobile",
      "app",
    ];

    for (const relPath of commonPaths) {
      const testPath = relPath
        ? path.join(this.workspaceRoot, relPath)
        : this.workspaceRoot;
      const packageJsonPath = path.join(testPath, "package.json");

      try {
        if (fs.existsSync(packageJsonPath)) {
          const content = fs.readFileSync(packageJsonPath, "utf8");
          const packageJson = JSON.parse(content);
          const hasReactNative =
            packageJson.dependencies?.["react-native"] ||
            packageJson.devDependencies?.["react-native"];

          if (hasReactNative) {
            return testPath;
          }
        }
      } catch (error) {
        // Continue searching
      }
    }

    return null;
  }

  /**
   * Scans the project for React Native components and builds a tree structure
   * Scans the ENTIRE React Native project, not just src folder
   */
  async getComponentTree(): Promise<ComponentTreeNode[]> {
    try {
      // Reset file counter for new scan
      this.fileCount = 0;
      
      if (!this.workspaceRoot) {
        console.warn("No workspace root found");
        return [];
      }

      console.log("Finding React Native project...");
      // Find React Native project (supports monorepos)
      const rnProjectPath = await this.findReactNativeProject();
      if (!rnProjectPath) {
        // Fallback to workspace root
        console.warn("No React Native project found, scanning workspace root");
        return this.scanDirectory(this.workspaceRoot);
      }

      console.log(`Scanning React Native project at: ${rnProjectPath}`);
      // Calculate relative path from workspace root for proper path display
      const relativeBase = path.relative(this.workspaceRoot, rnProjectPath);

      // Scan the ENTIRE React Native project directory, not just src
      const initialRelativePath = relativeBase ? relativeBase : "";

      // Scan with relative path prefix for monorepo support
      const tree = await this.scanDirectory(rnProjectPath, initialRelativePath);
      console.log(`Component tree loaded: ${tree.length} top-level items, ${this.fileCount} files scanned`);
      return tree;
    } catch (error: any) {
      console.error("Error in getComponentTree:", error);
      throw error; // Re-throw so caller can handle it
    }
  }

  private async scanDirectory(
    dirPath: string,
    relativePath: string = ""
  ): Promise<ComponentTreeNode[]> {
    const nodes: ComponentTreeNode[] = [];

    try {
      // Check if directory exists
      if (!fs.existsSync(dirPath)) {
        console.warn(`Directory does not exist: ${dirPath}`);
        return [];
      }

      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        try {
          // Skip node_modules, .git, and other common ignore patterns
          const dirName = entry.name.toLowerCase();
          if (
            entry.name.startsWith(".") ||
            entry.name === "node_modules" ||
            dirName === "dist" ||
            dirName === "build" ||
            dirName === ".expo" ||
            dirName === ".next" ||
            dirName === "coverage"
          ) {
            continue;
          }

          const fullPath = path.join(dirPath, entry.name);
          const relPath = relativePath
            ? `${relativePath}/${entry.name}`
            : entry.name;

          if (entry.isDirectory()) {
            try {
              const children = await this.scanDirectory(fullPath, relPath);
              if (children.length > 0) {
                nodes.push({
                  name: entry.name,
                  path: relPath,
                  type: "file",
                  children: children,
                });
              }
            } catch (error) {
              // Skip directories that can't be scanned (permissions, etc.)
              console.warn(`Error scanning directory ${fullPath}:`, error);
            }
          } else if (entry.isFile() && this.isComponentFile(entry.name)) {
            this.fileCount++; // Increment file counter
            if (this.fileCount > this.maxFilesToScan) {
              continue; // Skip remaining files
            }
            
            try {
              // Use AST parsing to extract ONLY actual React components
              const components = await this.extractComponentsWithAST(
                fullPath,
                entry.name
              );

              if (components.length > 0) {
                nodes.push({
                  name: entry.name,
                  path: relPath,
                  type: "component",
                  children: components.map((comp) => ({
                    name: comp,
                    path: `${relPath}::${comp}`,
                    type: "component",
                  })),
                });
              }
              // Don't include files with no components - they're not components!
            } catch (error) {
              // Skip files that can't be parsed (syntax errors, etc.)
              console.warn(`Error parsing component file ${fullPath}:`, error);
            }
          }
        } catch (error) {
          // Skip individual entries that cause errors
          console.warn(`Error processing entry ${entry.name}:`, error);
          continue;
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error);
    }

    return nodes.sort((a, b) => {
      // Directories first, then files
      if (a.children && !b.children) return -1;
      if (!a.children && b.children) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  private isComponentFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return ext === ".tsx" || ext === ".jsx" || ext === ".ts" || ext === ".js";
  }

  /**
   * Extracts component names from a file using AST parsing
   * Only returns actual React components (functions that return JSX or are React components)
   * @param filePath - Full path to the file
   * @param fileName - Name of the file (for generating names for anonymous exports)
   */
  private async extractComponentsWithAST(
    filePath: string,
    fileName: string
  ): Promise<string[]> {
    try {
      // Limit file size to prevent parsing huge files that could hang
      const stats = fs.statSync(filePath);
      const maxFileSize = 500 * 1024; // 500KB limit
      if (stats.size > maxFileSize) {
        console.warn(`Skipping large file ${filePath} (${stats.size} bytes)`);
        return [];
      }

      const content = fs.readFileSync(filePath, "utf8");
      const components: Set<string> = new Set();

      // Parse with TypeScript and JSX support
      // Add timeout protection by limiting parsing options
      const ast = parse(content, {
        sourceType: "module",
        plugins: ["jsx", "typescript", "decorators-legacy", "classProperties"],
        errorRecovery: true,
        // Limit tokens to prevent hanging on malformed files
        tokens: false, // Don't store tokens to save memory
      });

      const self = this; // Capture this for use in traverse callbacks

      traverse(ast, {
        // Handle: export default function ComponentName() {}
        ExportDefaultDeclaration(path) {
          const declaration = path.node.declaration;
          if (t.isFunctionDeclaration(declaration) && declaration.id) {
            const name = declaration.id.name;
            if (self.isReactComponent(name, declaration)) {
              components.add(name);
            }
          } else if (t.isClassDeclaration(declaration) && declaration.id) {
            // Class components
            const name = declaration.id.name;
            if (self.isReactClassComponent(declaration)) {
              components.add(name);
            }
          } else if (t.isIdentifier(declaration)) {
            // export default ComponentName
            components.add(declaration.name);
          } else if (
            t.isArrowFunctionExpression(declaration) ||
            t.isFunctionExpression(declaration)
          ) {
            // Anonymous default export - check if it's a component and use filename as name
            if (self.isComponentExpression(declaration)) {
              // Generate component name from filename
              // e.g., _layout.tsx -> Layout, index.tsx -> Index
              const pathModule = require("path");
              const baseName = pathModule.basename(
                fileName,
                pathModule.extname(fileName)
              );
              let componentName = baseName
                .replace(/^_+/, "") // Remove leading underscores
                .replace(/^[a-z]/, (char: string) => char.toUpperCase()); // Capitalize first letter

              // If name is empty or just underscores, use "Component"
              if (!componentName || componentName === "") {
                componentName = "Component";
              }

              components.add(componentName);
            }
          }
        },

        // Handle: export function ComponentName() {} or export const ComponentName = ...
        ExportNamedDeclaration(path) {
          if (path.node.exportKind === "type") {
            return; // Skip type exports
          }

          const declaration = path.node.declaration;

          // export function ComponentName() {}
          if (t.isFunctionDeclaration(declaration) && declaration.id) {
            const name = declaration.id.name;
            if (self.isReactComponent(name, declaration)) {
              components.add(name);
            }
          }
          // export class ComponentName {}
          else if (t.isClassDeclaration(declaration) && declaration.id) {
            const name = declaration.id.name;
            if (self.isReactClassComponent(declaration)) {
              components.add(name);
            }
          }
          // export const ComponentName = ...
          else if (t.isVariableDeclaration(declaration)) {
            for (const declarator of declaration.declarations) {
              if (t.isIdentifier(declarator.id)) {
                const name = declarator.id.name;
                // Check if it's a component (arrow function, function expression, or React.memo/forwardRef)
                if (self.isComponentVariable(declarator.init, name)) {
                  components.add(name);
                }
              }
            }
          }
        },
      });

      return Array.from(components);
    } catch (error) {
      // If AST parsing fails, fall back to regex (but be more strict)
      console.warn(
        `AST parsing failed for ${filePath}, using fallback:`,
        error
      );
      return this.extractComponentsFallback(filePath);
    }
  }

  /**
   * Checks if a function declaration is a React component
   */
  private isReactComponent(name: string, func: t.FunctionDeclaration): boolean {
    // Must start with uppercase (React component convention)
    if (!name || name[0] !== name[0].toUpperCase()) {
      return false;
    }

    // If it's an exported function with uppercase name, it's very likely a component
    // Check if function body contains JSX or returns JSX, but be lenient
    if (func.body && t.isBlockStatement(func.body)) {
      // Look for JSX in return statements
      let hasJSX = false;
      let hasReturn = false;
      const self = this;

      try {
        traverse(
          func.body,
          {
            ReturnStatement(path) {
              hasReturn = true;
              if (self.hasJSXElement(path.node.argument)) {
                hasJSX = true;
                path.stop();
              }
            },
            JSXElement() {
              hasJSX = true;
            },
            JSXFragment() {
              hasJSX = true;
            },
            // Also check for JSX in variable assignments (e.g., const element = <div />)
            VariableDeclarator(path) {
              if (self.hasJSXElement(path.node.init)) {
                hasJSX = true;
              }
            },
          },
          undefined,
          func.body
        );
      } catch (error) {
        // If traversal fails, assume it's a component if name starts with uppercase
        console.warn(`Error traversing function body for ${name}:`, error);
        return true; // Be lenient - if it starts with uppercase, assume component
      }

      // If we found JSX, definitely a component
      if (hasJSX) {
        return true;
      }

      // If there's a return statement but we couldn't detect JSX,
      // still consider it a component (might be returning a component reference)
      // This handles cases like: return <Component /> or return Component
      if (hasReturn) {
        return true;
      }

      // If no return but has body, might still be a component (early returns, etc.)
      // Be lenient for uppercase names
      return true;
    }

    // No body or empty body - not a component
    return false;
  }

  /**
   * Checks if a class declaration is a React component
   */
  private isReactClassComponent(classDecl: t.ClassDeclaration): boolean {
    if (
      !classDecl.id ||
      classDecl.id.name[0] !== classDecl.id.name[0].toUpperCase()
    ) {
      return false;
    }

    // Check if it extends React.Component or Component
    if (classDecl.superClass) {
      if (t.isIdentifier(classDecl.superClass)) {
        const superName = classDecl.superClass.name;
        if (superName === "Component" || superName === "PureComponent") {
          return true;
        }
      } else if (t.isMemberExpression(classDecl.superClass)) {
        if (
          t.isIdentifier(classDecl.superClass.object) &&
          classDecl.superClass.object.name === "React" &&
          t.isIdentifier(classDecl.superClass.property)
        ) {
          const propName = classDecl.superClass.property.name;
          if (propName === "Component" || propName === "PureComponent") {
            return true;
          }
        }
      }
    }

    // Check for render method that returns JSX
    if (classDecl.body && t.isClassBody(classDecl.body)) {
      for (const method of classDecl.body.body) {
        if (
          t.isClassMethod(method) &&
          t.isIdentifier(method.key) &&
          method.key.name === "render"
        ) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Checks if a variable initializer is a React component
   */
  private isComponentVariable(
    init: t.Node | null | undefined,
    name: string
  ): boolean {
    if (!init || !name || name[0] !== name[0].toUpperCase()) {
      return false;
    }

    // Arrow function or function expression
    if (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)) {
      // Check if it returns JSX
      if (t.isArrowFunctionExpression(init)) {
        if (t.isJSXElement(init.body) || t.isJSXFragment(init.body)) {
          return true;
        }
        if (t.isBlockStatement(init.body)) {
          let hasJSX = false;
          const self = this;
          traverse(
            init.body,
            {
              ReturnStatement(path) {
                if (self.hasJSXElement(path.node.argument)) {
                  hasJSX = true;
                  path.stop();
                }
              },
            },
            undefined,
            init.body
          );
          return hasJSX;
        }
      }
      return true; // Assume function expressions are components if name starts with uppercase
    }

    // React.memo, React.forwardRef, etc.
    if (t.isCallExpression(init)) {
      if (t.isIdentifier(init.callee)) {
        const calleeName = init.callee.name;
        if (["memo", "forwardRef", "lazy"].includes(calleeName)) {
          return true;
        }
      } else if (t.isMemberExpression(init.callee)) {
        if (
          t.isIdentifier(init.callee.property) &&
          ["memo", "forwardRef", "lazy"].includes(init.callee.property.name)
        ) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Checks if a function/arrow function expression is a React component
   */
  private isComponentExpression(
    node: t.ArrowFunctionExpression | t.FunctionExpression
  ): boolean {
    // Arrow function with direct JSX return
    if (t.isArrowFunctionExpression(node)) {
      if (t.isJSXElement(node.body) || t.isJSXFragment(node.body)) {
        return true;
      }
      // Arrow function with block that returns JSX
      if (t.isBlockStatement(node.body)) {
        let hasJSX = false;
        const self = this;
        traverse(
          node.body,
          {
            ReturnStatement(path) {
              if (self.hasJSXElement(path.node.argument)) {
                hasJSX = true;
                path.stop();
              }
            },
            JSXElement() {
              hasJSX = true;
            },
            JSXFragment() {
              hasJSX = true;
            },
          },
          undefined,
          node.body
        );
        return hasJSX;
      }
    }

    // Function expression with block that returns JSX
    if (t.isFunctionExpression(node) && t.isBlockStatement(node.body)) {
      let hasJSX = false;
      const self = this;
      traverse(
        node.body,
        {
          ReturnStatement(path) {
            if (self.hasJSXElement(path.node.argument)) {
              hasJSX = true;
              path.stop();
            }
          },
          JSXElement() {
            hasJSX = true;
          },
          JSXFragment() {
            hasJSX = true;
          },
        },
        undefined,
        node.body
      );
      return hasJSX;
    }

    return false;
  }

  /**
   * Checks if a node contains JSX
   */
  private hasJSXElement(node: t.Node | null | undefined): boolean {
    if (!node) return false;

    // Direct JSX elements
    if (t.isJSXElement(node) || t.isJSXFragment(node)) return true;

    // JSX in nested structures
    if (t.isParenthesizedExpression(node)) {
      return this.hasJSXElement(node.expression);
    }

    // Call expressions could be React.createElement (JSX transform)
    if (t.isCallExpression(node)) {
      // Check if it's React.createElement or similar
      if (t.isMemberExpression(node.callee)) {
        if (
          t.isIdentifier(node.callee.object) &&
          node.callee.object.name === "React" &&
          t.isIdentifier(node.callee.property) &&
          node.callee.property.name === "createElement"
        ) {
          return true;
        }
      }
      // Could be JSX transform - be lenient
      return true;
    }

    // Identifier could be a component reference (e.g., return <Component />)
    // We'll let the caller decide based on context

    return false;
  }

  /**
   * Fallback regex-based extraction (more strict than before)
   */
  private extractComponentsFallback(filePath: string): Promise<string[]> {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const components: string[] = [];

      // Only match exports that start with uppercase (React component convention)
      // export function ComponentName or export const ComponentName
      const functionComponentRegex =
        /export\s+(?:function|const)\s+([A-Z][a-zA-Z0-9]*)\s*[=:]/g;
      let match;
      while ((match = functionComponentRegex.exec(content)) !== null) {
        components.push(match[1]);
      }

      // Match class components: export class ComponentName
      const classComponentRegex = /export\s+class\s+([A-Z][a-zA-Z0-9]*)/g;
      while ((match = classComponentRegex.exec(content)) !== null) {
        components.push(match[1]);
      }

      return Promise.resolve(components);
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return Promise.resolve([]);
    }
  }

  /**
   * Gets the source code content for a component file
   */
  async getComponentSource(componentPath: string): Promise<string | null> {
    if (!this.workspaceRoot) {
      return null;
    }

    // Handle component path format: "path/to/file.tsx::ComponentName"
    const [filePath] = componentPath.split("::");
    const fullPath = path.join(this.workspaceRoot, filePath);

    try {
      return fs.readFileSync(fullPath, "utf8");
    } catch (error) {
      console.error(`Error reading component source ${fullPath}:`, error);
      return null;
    }
  }
}
