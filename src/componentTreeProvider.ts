import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ComponentTreeNode } from './types';

/**
 * Provides component tree structure by scanning React Native project files
 */
export class ComponentTreeProvider {
    private context: vscode.ExtensionContext;
    private workspaceRoot: string | undefined;

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
            '', // Root
            'apps/mobile',
            'apps/react-native',
            'packages/mobile',
            'packages/app',
            'mobile',
            'app'
        ];

        for (const relPath of commonPaths) {
            const testPath = relPath ? path.join(this.workspaceRoot, relPath) : this.workspaceRoot;
            const packageJsonPath = path.join(testPath, 'package.json');
            
            try {
                if (fs.existsSync(packageJsonPath)) {
                    const content = fs.readFileSync(packageJsonPath, 'utf8');
                    const packageJson = JSON.parse(content);
                    const hasReactNative = packageJson.dependencies?.['react-native'] || 
                                         packageJson.devDependencies?.['react-native'];
                    
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
     */
    async getComponentTree(): Promise<ComponentTreeNode[]> {
        if (!this.workspaceRoot) {
            return [];
        }

        // Find React Native project (supports monorepos)
        const rnProjectPath = await this.findReactNativeProject();
        if (!rnProjectPath) {
            // Fallback to workspace root
            const srcPath = path.join(this.workspaceRoot, 'src');
            const scanPath = fs.existsSync(srcPath) ? srcPath : this.workspaceRoot;
            return this.scanDirectory(scanPath);
        }

        // Calculate relative path from workspace root for proper path display
        const relativeBase = path.relative(this.workspaceRoot, rnProjectPath);
        const srcPath = path.join(rnProjectPath, 'src');
        
        // Check if src directory exists, otherwise scan the RN project root
        const scanPath = fs.existsSync(srcPath) ? srcPath : rnProjectPath;
        
        // If scanning from src, include it in the relative path
        // Otherwise use just the relativeBase
        const initialRelativePath = fs.existsSync(srcPath) 
            ? (relativeBase ? `${relativeBase}/src` : 'src')
            : (relativeBase ? relativeBase : '');
        
        // Scan with relative path prefix for monorepo support
        return this.scanDirectory(scanPath, initialRelativePath);
    }

    private async scanDirectory(dirPath: string, relativePath: string = ''): Promise<ComponentTreeNode[]> {
        const nodes: ComponentTreeNode[] = [];

        try {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                // Skip node_modules, .git, and other common ignore patterns
                if (entry.name.startsWith('.') || entry.name === 'node_modules') {
                    continue;
                }

                const fullPath = path.join(dirPath, entry.name);
                const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

                if (entry.isDirectory()) {
                    const children = await this.scanDirectory(fullPath, relPath);
                    if (children.length > 0) {
                        nodes.push({
                            name: entry.name,
                            path: relPath,
                            type: 'file',
                            children: children
                        });
                    }
                } else if (entry.isFile() && this.isComponentFile(entry.name)) {
                    // Try to extract component names from the file
                    const components = await this.extractComponents(fullPath);
                    
                    if (components.length > 0) {
                        nodes.push({
                            name: entry.name,
                            path: relPath,
                            type: 'component',
                            children: components.map(comp => ({
                                name: comp,
                                path: `${relPath}::${comp}`,
                                type: 'component'
                            }))
                        });
                    } else {
                        // File exists but no components found, still include it
                        nodes.push({
                            name: entry.name,
                            path: relPath,
                            type: 'component'
                        });
                    }
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
        return ext === '.tsx' || ext === '.jsx' || ext === '.ts' || ext === '.js';
    }

    /**
     * Extracts component names from a file by reading its content
     */
    private async extractComponents(filePath: string): Promise<string[]> {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const components: string[] = [];

            // Match function components: export function ComponentName or export const ComponentName
            const functionComponentRegex = /export\s+(?:function|const)\s+([A-Z][a-zA-Z0-9]*)/g;
            let match;
            while ((match = functionComponentRegex.exec(content)) !== null) {
                components.push(match[1]);
            }

            // Match class components: export class ComponentName
            const classComponentRegex = /export\s+class\s+([A-Z][a-zA-Z0-9]*)/g;
            while ((match = classComponentRegex.exec(content)) !== null) {
                components.push(match[1]);
            }

            return components;
        } catch (error) {
            console.error(`Error reading file ${filePath}:`, error);
            return [];
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
        const [filePath] = componentPath.split('::');
        const fullPath = path.join(this.workspaceRoot, filePath);

        try {
            return fs.readFileSync(fullPath, 'utf8');
        } catch (error) {
            console.error(`Error reading component source ${fullPath}:`, error);
            return null;
        }
    }
}

