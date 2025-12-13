import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Automatically wraps React Native components with withProfiler HOC
 */
export class ComponentWrapper {
    /**
     * Wraps a component in its source file
     */
    async wrapComponent(componentPath: string, componentName: string, workspaceRoot: string): Promise<boolean> {
        try {
            // Handle component path format: "path/to/file.tsx::ComponentName" or just "path/to/file.tsx"
            const [filePath] = componentPath.split('::');
            const fullPath = path.join(workspaceRoot, filePath);

            if (!fs.existsSync(fullPath)) {
                console.error(`Component file not found: ${fullPath}`);
                return false;
            }

            let content = fs.readFileSync(fullPath, 'utf8');
            const originalContent = content;

            // Check if already wrapped
            if (content.includes(`withProfiler(${componentName})`) || 
                content.includes(`withProfiler(${componentName},`) ||
                content.includes(`withProfiler(`) && content.includes(componentName)) {
                console.log(`Component ${componentName} appears to already be wrapped`);
                return true;
            }

            // Try to wrap the component
            content = this.wrapComponentInCode(content, componentName, filePath);

            // Only write if content changed
            if (content !== originalContent) {
                fs.writeFileSync(fullPath, content, 'utf8');
                return true;
            }

            return false;
        } catch (error: any) {
            console.error(`Error wrapping component ${componentName}:`, error);
            return false;
        }
    }

    /**
     * Wraps a component in the code string
     */
    private wrapComponentInCode(code: string, componentName: string, filePath: string): string {
        // Check if already wrapped
        if (code.includes(`withProfiler(${componentName}`)) {
            return code; // Already wrapped
        }

        // Check if withProfiler is already imported
        const hasWithProfilerImport = code.includes('withProfiler') && 
                                     (code.includes('import') && code.includes('from'));

        let newCode = code;
        let modified = false;

        // Pattern 1: export default function ComponentName(...)
        if (newCode.includes(`export default function ${componentName}`)) {
            newCode = newCode.replace(
                `export default function ${componentName}`,
                `function ${componentName}`
            );
            // Add wrapped export at the end
            newCode = newCode.trimEnd() + `\n\nexport default withProfiler(${componentName}, '${componentName}');`;
            modified = true;
        }
        // Pattern 2: export default const ComponentName = ...
        else if (newCode.includes(`export default const ${componentName}`)) {
            newCode = newCode.replace(
                `export default const ${componentName}`,
                `const ${componentName}`
            );
            // Add wrapped export at the end
            newCode = newCode.trimEnd() + `\n\nexport default withProfiler(${componentName}, '${componentName}');`;
            modified = true;
        }
        // Pattern 3: function ComponentName(...) { ... } then export default ComponentName (separate)
        else if (newCode.includes(`function ${componentName}`) && newCode.includes(`export default ${componentName}`)) {
            newCode = newCode.replace(
                `export default ${componentName}`,
                `export default withProfiler(${componentName}, '${componentName}')`
            );
            modified = true;
        }
        // Pattern 4: const ComponentName = (...) => { ... } then export default ComponentName (separate)
        else if (newCode.includes(`const ${componentName}`) && newCode.includes(`export default ${componentName}`)) {
            newCode = newCode.replace(
                `export default ${componentName}`,
                `export default withProfiler(${componentName}, '${componentName}')`
            );
            modified = true;
        }
        // Pattern 5: Simple export default ComponentName
        else if (newCode.includes(`export default ${componentName}`)) {
            newCode = newCode.replace(
                `export default ${componentName}`,
                `export default withProfiler(${componentName}, '${componentName}')`
            );
            modified = true;
        }

        // Add import for withProfiler if needed
        if (modified && !hasWithProfilerImport) {
            // Find the last import statement
            const importLines = code.split('\n');
            let lastImportIndex = -1;
            for (let i = 0; i < importLines.length; i++) {
                if (importLines[i].trim().startsWith('import ')) {
                    lastImportIndex = i;
                }
            }
            
            // Calculate relative path to withProfiler
            const fileDir = path.dirname(filePath);
            const relativePath = this.calculateRelativePath(fileDir, 'src/utils/withProfiler');
            
            if (lastImportIndex >= 0) {
                // Add after last import
                importLines.splice(lastImportIndex + 1, 0, `import { withProfiler } from '${relativePath}';`);
                newCode = importLines.join('\n');
            } else {
                // Add at the top
                newCode = `import { withProfiler } from '${relativePath}';\n` + newCode;
            }
        }

        return modified ? newCode : code;
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
            const fromParts = fromNormalized.filter(p => p && p !== '.');
            const toParts = toNormalized.filter(p => p && p !== '.');
            
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
            const relativePath = '../'.repeat(upLevels) + relativeParts.join('/');
            
            // If same directory, use './'
            if (relativePath === '') {
                return './' + (relativeParts.length > 0 ? relativeParts.join('/') : 'withProfiler');
            }
            
            return relativePath || './' + (relativeParts.length > 0 ? relativeParts.join('/') : 'withProfiler');
        } catch (error) {
            // Fallback to simple relative path
            return '../utils/withProfiler';
        }
    }
}

