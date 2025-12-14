import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { ProfilerServer } from "./profilerServer";
import { ComponentTreeProvider } from "./componentTreeProvider";
import { ProfileLog, WebViewMessage, ComponentTreeNode } from "./types";
import { AIAnalyzer } from "./aiAnalyzer";
import { ComponentWrapper } from "./componentWrapper";

/**
 * Manages the WebView panel that displays the profiler UI
 */
export class ProfilerPanel {
  public static readonly viewType = "rnProfilerAI";

  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private server: ProfilerServer | undefined;
  private componentTreeProvider: ComponentTreeProvider;
  private aiAnalyzer: AIAnalyzer;
  private componentWrapper: ComponentWrapper;
  private storedLogs: ProfileLog[] = [];
  private selectedComponents: string[] = [];
  private static outputChannel: vscode.OutputChannel | undefined;

  public static setOutputChannel(channel: vscode.OutputChannel) {
    ProfilerPanel.outputChannel = channel;
  }

  private log(message: string) {
    if (ProfilerPanel.outputChannel) {
      ProfilerPanel.outputChannel.appendLine(`[ProfilerPanel] ${message}`);
    }
    console.log(`[ProfilerPanel] ${message}`);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    componentTreeProvider: ComponentTreeProvider
  ) {
    this.panel = panel;
    this.componentTreeProvider = componentTreeProvider;
    this.aiAnalyzer = new AIAnalyzer(componentTreeProvider);
    this.componentWrapper = new ComponentWrapper();

    // Set the webview's initial html content
    this.update();

    // Listen for when the panel is disposed
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      async (message: WebViewMessage) => {
        this.log(`Received message from webview: ${message.type}`);
        try {
          // Handle command messages
          if (message.type === "startRecording") {
            await vscode.commands.executeCommand("rnProfilerAI.startRecording");
          } else if (message.type === "stopRecording") {
            await vscode.commands.executeCommand("rnProfilerAI.stopRecording");
          } else if (message.type === "analyzeLogs") {
            await vscode.commands.executeCommand("rnProfilerAI.analyzeLogs");
          } else {
            // Handle other messages
            await this.handleMessage(message);
          }
        } catch (error: any) {
          this.log(`ERROR handling message ${message.type}: ${error.message}`);
          if (error.stack) {
            this.log(`Stack: ${error.stack}`);
          }
          console.error(`Error handling message ${message.type}:`, error);
        }
      },
      null,
      this.disposables
    );
    
    this.log("ProfilerPanel initialized and webview message handler registered");
  }

  private static currentPanel: ProfilerPanel | undefined;

  public static createOrShow(
    extensionUri: vscode.Uri,
    componentTreeProvider: ComponentTreeProvider
  ): ProfilerPanel {
    if (ProfilerPanel.outputChannel) {
      ProfilerPanel.outputChannel.appendLine("ProfilerPanel.createOrShow called");
    }
    
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel that's still alive, show it
    if (ProfilerPanel.currentPanel) {
      if (ProfilerPanel.outputChannel) {
        ProfilerPanel.outputChannel.appendLine("Reusing existing panel");
      }
      ProfilerPanel.currentPanel.panel.reveal(column);
      return ProfilerPanel.currentPanel;
    }

    // Otherwise, create a new panel
    if (ProfilerPanel.outputChannel) {
      ProfilerPanel.outputChannel.appendLine("Creating new webview panel");
    }
    
    const panel = vscode.window.createWebviewPanel(
      ProfilerPanel.viewType,
      "RN Profiler AI",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "media"),
          vscode.Uri.joinPath(extensionUri, "out"),
        ],
        retainContextWhenHidden: true,
      }
    );

    ProfilerPanel.currentPanel = new ProfilerPanel(panel, extensionUri, componentTreeProvider);
    if (ProfilerPanel.outputChannel) {
      ProfilerPanel.outputChannel.appendLine("New ProfilerPanel instance created");
    }
    return ProfilerPanel.currentPanel;
  }

  public reveal() {
    this.panel.reveal();
  }

  public setServer(server: ProfilerServer | undefined) {
    this.server = server;
    // Clear stored logs when starting a new recording
    if (server) {
      this.storedLogs = [];
    }
  }

  public storeLogs(logs: ProfileLog[]) {
    this.storedLogs = logs;
  }

  public getStoredLogs(): ProfileLog[] {
    return this.storedLogs;
  }

  public getSelectedComponents(): string[] {
    return [...this.selectedComponents];
  }

  public sendMessage(message: WebViewMessage) {
    // Check if panel is still alive before sending
    try {
      this.panel.webview.postMessage(message);
    } catch (error: any) {
      // Panel might be disposed, ignore the error
      console.warn("Failed to send message to webview (panel may be disposed):", error);
    }
  }

  public async analyzeLogs(logs: ProfileLog[]) {
    if (logs.length === 0) {
      this.sendMessage({
        type: "analysisError",
        error: "No logs to analyze",
      });
      return;
    }

    this.sendMessage({
      type: "analysisStarted",
    });

    try {
      const analysis = await this.aiAnalyzer.analyze(logs);
      this.sendMessage({
        type: "analysisComplete",
        analysis: analysis,
      });
    } catch (error: any) {
      this.sendMessage({
        type: "analysisError",
        error: error.message || "Failed to analyze logs",
      });
    }
  }

  private async handleMessage(message: WebViewMessage) {
    switch (message.type) {
      case "ready":
        // Send component tree when webview is ready
        this.log("Webview ready message received, starting component tree load...");
        
        // Load component tree asynchronously (don't block the message handler)
        // Use a timeout to prevent infinite loading
        const timeoutPromise = new Promise<ComponentTreeNode[]>((_, reject) => {
          setTimeout(() => {
            this.log("ERROR: Component tree loading timeout after 30 seconds");
            reject(new Error("Component tree loading timeout after 30 seconds"));
          }, 30000);
        });
        
        Promise.race([
          this.componentTreeProvider.getComponentTree(),
          timeoutPromise
        ]).then((tree) => {
          this.log(`Component tree loaded successfully: ${tree.length} items`);
          this.sendMessage({
            type: "componentTree",
            tree: tree,
          });
        }).catch((error: any) => {
          this.log(`ERROR loading component tree: ${error.message}`);
          if (error.stack) {
            this.log(`Stack: ${error.stack}`);
          }
          console.error("Error loading component tree:", error);
          // Always send a response, even if empty, so UI doesn't hang
          this.sendMessage({
            type: "componentTree",
            tree: [],
          });
          
          const errorMessage = error.message || String(error);
          vscode.window.showErrorMessage(
            `Failed to load component tree: ${errorMessage}. Check Output panel (RN Profiler AI) for details.`
          );
        });
        break;

      case "selectComponents":
        // Update RN config with selected components
        await this.updateSelectedComponents(message.components || []);
        break;

      case "wrapComponents":
        // Automatically wrap selected components with withProfiler
        await this.wrapComponents(message.components || []);
        break;

      case "wrapComponents":
        // Automatically wrap selected components with withProfiler
        await this.wrapComponents(message.components || []);
        break;

      case "requestLogs":
        if (this.server) {
          this.sendMessage({
            type: "logsUpdate",
            logs: this.server.getLogs(),
          });
        }
        break;

      case "openFile":
        // Open file in VS Code editor
        if (message.path) {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (workspaceFolders && workspaceFolders.length > 0) {
            const filePath = vscode.Uri.joinPath(
              workspaceFolders[0].uri,
              message.path
            );
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
          }
        }
        break;

      case "copyToClipboard":
        // Copy text to clipboard
        if (message.text) {
          await vscode.env.clipboard.writeText(message.text);
          vscode.window.showInformationMessage("Logs copied to clipboard!");
        }
        break;

      case "saveLogsToFile":
        // Save logs to file
        if (message.content) {
          const defaultFilename = message.defaultFilename || "profiler-logs.txt";
          
          // Get workspace folder for default save location
          const workspaceFolders = vscode.workspace.workspaceFolders;
          let defaultUri: vscode.Uri | undefined;
          
          if (workspaceFolders && workspaceFolders.length > 0) {
            defaultUri = vscode.Uri.joinPath(
              workspaceFolders[0].uri,
              defaultFilename
            );
          } else {
            defaultUri = vscode.Uri.file(defaultFilename);
          }
          
          const uri = await vscode.window.showSaveDialog({
            defaultUri: defaultUri,
            filters: {
              "Text Files": ["txt"],
              "JSON Files": ["json"],
              "All Files": ["*"],
            },
          });

          if (uri) {
            try {
              await vscode.workspace.fs.writeFile(
                uri,
                Buffer.from(message.content, "utf8")
              );
              vscode.window.showInformationMessage(
                `Logs saved to ${path.basename(uri.fsPath)}`
              );
            } catch (error: any) {
              vscode.window.showErrorMessage(
                `Failed to save logs: ${error.message}`
              );
            }
          }
        }
        break;
    }
  }

  private async updateSelectedComponents(components: string[]) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return;
    }

    // Store selected components
    this.selectedComponents = components;

    // Extract component names from paths (format: "path/to/file.tsx::ComponentName")
    const componentNames = components
      .map((path) => {
        const parts = path.split("::");
        return parts.length > 1
          ? parts[1]
          : path
              .split("/")
              .pop()
              ?.replace(/\.(tsx|jsx|ts|js)$/, "") || "";
      })
      .filter((name) => name.length > 0);

    // Find React Native project directory (supports monorepos)
    const rnPath = await this.findReactNativeProject(workspaceFolders[0].uri);
    if (!rnPath) {
      vscode.window.showErrorMessage(
        "Could not find React Native project directory"
      );
      return;
    }

    const configPath = vscode.Uri.joinPath(
      vscode.Uri.file(rnPath),
      "src",
      "rn-profiler-config.ts"
    );

    // Only update component list, don't change PROFILING_ENABLED here
    // (It will be set when Start Recording is clicked)
    const configContent = `// Auto-generated by RN Profiler AI extension
// Changes to this file may require a Metro Bundler restart

export const PROFILING_ENABLED: boolean = ${this.server?.isRunning() || false};
export const COMPONENTS_TO_PROFILE: string[] = ${JSON.stringify(
      componentNames,
      null,
      2
    )};
`;

    try {
      await vscode.workspace.fs.writeFile(
        configPath,
        Buffer.from(configContent, "utf8")
      );
      vscode.window.showInformationMessage(
        `Updated ${componentNames.length} components. Metro Bundler restart may be required.`
      );
    } catch (error) {
      console.error("Failed to update selected components:", error);
      vscode.window.showErrorMessage("Failed to update component selection");
    }
  }

  /**
   * Finds the React Native project directory (supports monorepos)
   */
  private async findReactNativeProject(
    workspaceUri: vscode.Uri
  ): Promise<string | null> {
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
      const testUri = relPath
        ? vscode.Uri.joinPath(workspaceUri, relPath)
        : workspaceUri;
      const packageJsonPath = vscode.Uri.joinPath(testUri, "package.json");

      try {
        const content = await vscode.workspace.fs.readFile(packageJsonPath);
        const packageJson = JSON.parse(content.toString());
        const hasReactNative =
          packageJson.dependencies?.["react-native"] ||
          packageJson.devDependencies?.["react-native"];

        if (hasReactNative) {
          return testUri.fsPath;
        }
      } catch (error) {
        // Continue searching
      }
    }

    return null;
  }

  /**
   * Searches for a file containing a component with the given name
   */
  private async findFileByComponentName(
    componentName: string,
    searchRoot: string
  ): Promise<string | null> {
    try {
      const searchPaths = [path.join(searchRoot, "src"), path.join(searchRoot)];

      for (const searchPath of searchPaths) {
        if (!fs.existsSync(searchPath)) continue;

        const files = this.getAllComponentFiles(searchPath);

        for (const file of files) {
          try {
            const content = fs.readFileSync(file, "utf8");
            // Check if file contains the component name as an export
            const componentPatterns = [
              new RegExp(
                `export\\s+(?:default\\s+)?(?:function|const|class)\\s+${componentName}\\b`
              ),
              new RegExp(`export\\s+default\\s+${componentName}\\b`),
              new RegExp(`export\\s+{\\s*${componentName}\\s*}`),
            ];

            for (const pattern of componentPatterns) {
              if (pattern.test(content)) {
                return file;
              }
            }
          } catch (error) {
            // Continue searching
          }
        }
      }
    } catch (error) {
      console.error("Error searching for component:", error);
    }

    return null;
  }

  /**
   * Recursively gets all component files from a directory
   */
  private getAllComponentFiles(dir: string): string[] {
    const files: string[] = [];

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") {
          continue;
        }

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          files.push(...this.getAllComponentFiles(fullPath));
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if ([".tsx", ".jsx", ".ts", ".js"].includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Ignore errors
    }

    return files;
  }

  /**
   * Automatically wraps components with withProfiler HOC
   */
  private async wrapComponents(components: string[]) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage("No workspace folder found");
      return;
    }

    // Find React Native project directory (supports monorepos)
    const rnPath = await this.findReactNativeProject(workspaceFolders[0].uri);
    if (!rnPath) {
      vscode.window.showErrorMessage(
        "Could not find React Native project directory"
      );
      return;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    let successCount = 0;
    let failCount = 0;

    vscode.window.showInformationMessage(
      `Wrapping ${components.length} components...`
    );

    for (const componentPath of components) {
      // Handle component path format: "path/to/file.tsx::ComponentName" or just "path/to/file.tsx"
      // If componentPath doesn't contain '::' and doesn't look like a file path, it might be just a component name
      if (
        !componentPath.includes("::") &&
        !componentPath.includes("/") &&
        !componentPath.includes("\\")
      ) {
        console.warn(
          `Component path appears to be just a name without file path: ${componentPath}`
        );
        vscode.window.showWarningMessage(
          `Component "${componentPath}" doesn't have a file path. Please select the component from the tree, not just the name.`
        );
        failCount++;
        continue;
      }

      const [filePath] = componentPath.split("::");
      const componentName = componentPath.includes("::")
        ? componentPath.split("::")[1]
        : path.basename(filePath, path.extname(filePath));

      // Validate that we have a file path
      if (!filePath || filePath.trim() === "") {
        console.error(
          `Invalid component path: ${componentPath} - missing file path`
        );
        failCount++;
        continue;
      }

      // Skip directories - only process actual component files
      const fileExt = path.extname(filePath).toLowerCase();
      if (![".tsx", ".jsx", ".ts", ".js"].includes(fileExt)) {
        console.warn(
          `Skipping ${componentPath} - not a component file (missing extension)`
        );
        continue;
      }

      // Resolve the full file path
      // Component paths from the tree are already relative to workspace root
      // They include the full path from workspace root (e.g., "apps/mobile/casino/src/components/...")
      // So we should just join with workspaceRoot directly
      let fullFilePath = path.join(workspaceRoot, filePath);

      // Normalize the path to handle any path separator issues
      fullFilePath = path.normalize(fullFilePath);

      // If file doesn't exist, the path might be incorrect
      // Component tree paths should already be correct, but let's verify
      if (!fs.existsSync(fullFilePath)) {
        console.warn(`File not found at expected path: ${fullFilePath}`);
        console.warn(`  Workspace root: ${workspaceRoot}`);
        console.warn(`  Component path: ${filePath}`);
        console.warn(`  RN project path: ${rnPath}`);

        // The path should already be correct, but if it's not, we'll search by component name
        // Don't try alternative path resolutions as they cause duplication issues
      }

      // Verify file exists
      if (!fs.existsSync(fullFilePath)) {
        // Try to find the file by searching for the component name in the codebase
        console.warn(
          `File not found at ${fullFilePath}, searching for component "${componentName}"...`
        );
        console.warn(`  Attempted path: ${fullFilePath}`);
        console.warn(`  Workspace root: ${workspaceRoot}`);
        console.warn(`  RN project: ${rnPath}`);

        const foundFile = await this.findFileByComponentName(
          componentName,
          rnPath
        );
        if (foundFile) {
          fullFilePath = foundFile;
          console.log(
            `Found component "${componentName}" in file: ${foundFile}`
          );
        } else {
          // Show detailed error
          const errorDetails = [
            `Could not find file for component "${componentName}"`,
            `Expected path from tree: ${filePath}`,
            `Resolved to: ${fullFilePath}`,
            `Workspace: ${workspaceRoot}`,
            `RN Project: ${rnPath}`,
          ].join("\n");
          console.error(errorDetails);
          vscode.window.showWarningMessage(
            `Could not find file for component "${componentName}". Check Output panel for details.`
          );
          failCount++;
          continue;
        }
      }

      // Calculate relative path from file to workspace root for componentWrapper
      const relativePathFromWorkspace = path.relative(
        workspaceRoot,
        fullFilePath
      );
      const componentPathForWrapper = componentPath.includes("::")
        ? `${relativePathFromWorkspace}::${componentName}`
        : relativePathFromWorkspace;

      try {
        const success = await this.componentWrapper.wrapComponent(
          componentPathForWrapper,
          componentName,
          workspaceRoot
        );

        if (success) {
          successCount++;
        } else {
          console.error(`Failed to wrap ${componentName} in ${filePath}`);
          failCount++;
        }
      } catch (error: any) {
        console.error(`Failed to wrap ${componentName}:`, error);
        failCount++;
      }
    }

    if (successCount > 0) {
      vscode.window.showInformationMessage(
        `Successfully wrapped ${successCount} component(s). ` +
          `${failCount > 0 ? `${failCount} failed. ` : ""}` +
          `Please restart Metro Bundler and ensure components are wrapped with withProfiler.`
      );
    } else if (failCount > 0) {
      vscode.window.showWarningMessage(
        `Could not automatically wrap components. Please wrap them manually.`
      );
    }
  }

  private update() {
    const webview = this.panel.webview;
    this.panel.webview.html = this.getHtmlForWebview(webview);
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    // Get the local path to the HTML file and convert it to a webview URI
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RN Profiler AI</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 16px;
            overflow-x: hidden;
        }

        .container {
            display: flex;
            flex-direction: column;
            gap: 12px;
            max-width: 100%;
        }

        .section {
            background-color: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            overflow: hidden;
        }

        .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 16px;
            background-color: var(--vscode-sideBarSectionHeader-background);
            border-bottom: 1px solid var(--vscode-panel-border);
            cursor: pointer;
            user-select: none;
        }

        .section-header:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .section-header-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        .section-toggle {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            transition: transform 0.2s;
        }

        .section-toggle.collapsed {
            transform: rotate(-90deg);
        }

        .section-content {
            padding: 16px;
            display: block;
        }

        .section-content.collapsed {
            display: none;
        }

        .controls {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }

        button {
            padding: 6px 14px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            transition: opacity 0.2s;
        }

        button:hover:not(:disabled) {
            background-color: var(--vscode-button-hoverBackground);
        }

        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        button.primary {
            background-color: var(--vscode-button-background);
        }

        button.danger {
            background-color: var(--vscode-errorForeground);
        }

        .treeview {
            max-height: 500px;
            overflow-y: auto;
            font-size: 13px;
        }

        .tree-node {
            display: flex;
            align-items: center;
            padding: 4px 8px;
            cursor: pointer;
            user-select: none;
            border-radius: 3px;
            margin: 2px 0;
        }

        .tree-node:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .tree-node.selected {
            background-color: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        .tree-node-content {
            display: flex;
            align-items: center;
            gap: 6px;
            flex: 1;
            min-width: 0;
        }

        .tree-expand-icon {
            width: 16px;
            height: 16px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            transition: transform 0.2s;
            flex-shrink: 0;
        }

        .tree-expand-icon.collapsed {
            transform: rotate(-90deg);
        }

        .tree-expand-icon.no-children {
            width: 16px;
            opacity: 0;
        }

        .tree-checkbox {
            width: 16px;
            height: 16px;
            border: 1px solid var(--vscode-checkbox-border);
            border-radius: 3px;
            background-color: var(--vscode-checkbox-background);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            margin-right: 4px;
        }

        .tree-checkbox.checked {
            background-color: var(--vscode-checkbox-selectBackground);
            border-color: var(--vscode-checkbox-selectBorder);
        }

        .tree-checkbox.checked::after {
            content: '✓';
            color: var(--vscode-checkbox-foreground);
            font-size: 12px;
            font-weight: bold;
        }

        .tree-node-label {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .tree-children {
            margin-left: 20px;
            display: block;
        }

        .tree-children.collapsed {
            display: none;
        }

        .tree-subtree-btn {
            margin-left: auto;
            padding: 2px 8px;
            font-size: 11px;
            opacity: 0;
            transition: opacity 0.2s;
            margin-right: 4px;
        }

        .tree-node:hover .tree-subtree-btn {
            opacity: 1;
        }

        .tree-selection-count {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 6px;
            border-radius: 10px;
            margin-left: 6px;
            font-weight: normal;
        }

        .log-display {
            max-height: 400px;
            overflow-y: auto;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            background-color: var(--vscode-textCodeBlock-background);
            padding: 12px;
            border-radius: 4px;
            border: 1px solid var(--vscode-panel-border);
        }

        .log-entry {
            padding: 6px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
        }

        .log-entry:last-child {
            border-bottom: none;
        }

        .log-entry-info {
            flex: 1;
        }

        .log-entry-component {
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
        }

        .log-entry-details {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }

        .log-entry-duration {
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
            margin-left: 8px;
        }

        .analysis-output {
            max-height: 600px;
            overflow-y: auto;
            padding: 16px;
            background-color: var(--vscode-textCodeBlock-background);
            border-radius: 4px;
            border: 1px solid var(--vscode-panel-border);
            font-size: 13px;
            line-height: 1.6;
        }

        .analysis-output h1 {
            margin-top: 0;
            margin-bottom: 16px;
            font-size: 20px;
            border-bottom: 2px solid var(--vscode-panel-border);
            padding-bottom: 8px;
        }

        .analysis-output h2 {
            margin-top: 24px;
            margin-bottom: 12px;
            font-size: 18px;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 6px;
        }

        .analysis-output h3 {
            margin-top: 16px;
            margin-bottom: 8px;
            font-size: 16px;
        }

        .analysis-output p {
            margin-bottom: 12px;
        }

        .analysis-output ul, .analysis-output ol {
            margin-left: 24px;
            margin-bottom: 12px;
        }

        .analysis-output li {
            margin-bottom: 6px;
        }

        .analysis-output code {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
        }

        .analysis-output pre {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 12px;
            border-radius: 4px;
            overflow-x: auto;
            margin-bottom: 12px;
            border: 1px solid var(--vscode-panel-border);
        }

        .analysis-output pre code {
            background: none;
            padding: 0;
        }

        .status-indicator {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-right: 6px;
        }

        .status-indicator.recording {
            background-color: #f44336;
            animation: pulse 1.5s infinite;
        }

        .status-indicator.idle {
            background-color: #9e9e9e;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        .loading {
            text-align: center;
            padding: 24px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state {
            text-align: center;
            padding: 24px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Profiling Controls -->
        <div class="section">
            <div class="section-header" onclick="toggleSection('controls')">
                <div class="section-header-title">
                    <span class="status-indicator" id="statusIndicator"></span>
                    <span>Profiling Controls</span>
                </div>
                <span class="section-toggle" id="controlsToggle">▼</span>
            </div>
            <div class="section-content" id="controlsContent">
                <div class="controls">
                    <button id="wrapBtn">Wrap Components</button>
                    <button id="startBtn" class="primary">Start Recording</button>
                    <button id="stopBtn" disabled>Stop Recording</button>
                    <button id="analyzeBtn" disabled>Analyze Logs</button>
                </div>
            </div>
        </div>

        <!-- Component Selection -->
        <div class="section">
            <div class="section-header" onclick="toggleSection('components')">
                <div class="section-header-title">
                    <span>Component Selection</span>
                    <span id="selectedCount" style="font-size: 11px; color: var(--vscode-descriptionForeground); font-weight: normal;">(0 selected)</span>
                </div>
                <span class="section-toggle" id="componentsToggle">▼</span>
            </div>
            <div class="section-content" id="componentsContent">
                <div style="margin-bottom: 8px; display: flex; gap: 8px;">
                    <button id="clearAllBtn" style="font-size: 12px; padding: 4px 10px;">Clear All</button>
                    <span style="flex: 1; font-size: 11px; color: var(--vscode-descriptionForeground); align-self: center;">
                        Click checkbox to select/deselect • Hover over nodes to see subtree actions
                    </span>
                </div>
                <div class="treeview" id="treeview">
                    <div class="loading">Loading component tree...</div>
                </div>
            </div>
        </div>

        <!-- Live Logs -->
        <div class="section">
            <div class="section-header" onclick="toggleSection('logs')">
                <div class="section-header-title">
                    <span>Live Logs</span>
                    <span id="logsCount" style="font-size: 11px; color: var(--vscode-descriptionForeground); font-weight: normal;">(0 logs)</span>
                </div>
                <span class="section-toggle" id="logsToggle">▼</span>
            </div>
            <div class="section-content" id="logsContent">
                <div style="margin-bottom: 8px; display: flex; gap: 8px;">
                    <button id="copyLogsBtn" style="font-size: 12px; padding: 4px 10px;" disabled>Copy Logs</button>
                    <button id="saveLogsBtn" style="font-size: 12px; padding: 4px 10px;" disabled>Save to File</button>
                </div>
                <div class="log-display" id="logDisplay">
                    <div class="empty-state">No logs yet. Start recording to see profiling data.</div>
                </div>
            </div>
        </div>

        <!-- AI Analysis -->
        <div class="section">
            <div class="section-header" onclick="toggleSection('analysis')">
                <div class="section-header-title">
                    <span>AI Analysis</span>
                </div>
                <span class="section-toggle" id="analysisToggle">▼</span>
            </div>
            <div class="section-content" id="analysisContent">
                <div class="analysis-output" id="analysisOutput">
                    <div class="empty-state">Analysis will appear here after you analyze logs.</div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let selectedComponents = new Set();
        let isRecording = false;
        let logs = [];
        let treeData = [];
        let expandedNodes = new Set();
        let collapsedSections = new Set(['logs', 'analysis']); // Start with logs and analysis collapsed

        // Initialize
        window.addEventListener('load', () => {
            console.log('[Webview] Window loaded, sending ready message');
            vscode.postMessage({ type: 'ready' });
            updateStatus(false);
            updateSectionStates();
        });
        
        // Also try sending ready immediately if DOM is already loaded
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            console.log('[Webview] DOM already loaded, sending ready message immediately');
            setTimeout(() => {
                vscode.postMessage({ type: 'ready' });
                updateStatus(false);
                updateSectionStates();
            }, 100);
        }

        // Section collapse/expand
        function toggleSection(sectionId) {
            if (collapsedSections.has(sectionId)) {
                collapsedSections.delete(sectionId);
            } else {
                collapsedSections.add(sectionId);
            }
            updateSectionStates();
        }

        function updateSectionStates() {
            ['controls', 'components', 'logs', 'analysis'].forEach(id => {
                const content = document.getElementById(id + 'Content');
                const toggle = document.getElementById(id + 'Toggle');
                if (content && toggle) {
                    if (collapsedSections.has(id)) {
                        content.classList.add('collapsed');
                        toggle.classList.add('collapsed');
                    } else {
                        content.classList.remove('collapsed');
                        toggle.classList.remove('collapsed');
                    }
                }
            });
        }

        // Button handlers
        document.getElementById('wrapBtn').addEventListener('click', () => {
            const selected = Array.from(selectedComponents);
            if (selected.length === 0) {
                alert('Please select components from the tree first');
                return;
            }
            vscode.postMessage({ type: 'wrapComponents', components: selected });
        });

        document.getElementById('clearAllBtn').addEventListener('click', () => {
            if (selectedComponents.size === 0) {
                return;
            }
            if (confirm('Clear all ' + selectedComponents.size + ' selected component(s)?')) {
                clearAllSelections();
            }
        });

        document.getElementById('startBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'startRecording' });
        });

        document.getElementById('stopBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'stopRecording' });
        });

        document.getElementById('analyzeBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'analyzeLogs' });
        });

        document.getElementById('copyLogsBtn').addEventListener('click', () => {
            copyLogsToClipboard();
        });

        document.getElementById('saveLogsBtn').addEventListener('click', () => {
            saveLogsToFile();
        });

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'componentTree':
                    renderTree(message.tree);
                    break;
                case 'recordingStarted':
                    isRecording = true;
                    updateStatus(true);
                    updateButtons();
                    break;
                case 'recordingStopped':
                    isRecording = false;
                    updateStatus(false);
                    updateButtons();
                    if (message.logs) {
                        logs = message.logs;
                        renderLogs(logs);
                    }
                    break;
                case 'logsUpdate':
                    logs = message.logs || [];
                    renderLogs(logs);
                    break;
                case 'analysisStarted':
                    document.getElementById('analysisOutput').innerHTML = '<div class="loading">Analyzing logs...</div>';
                    break;
                case 'analysisComplete':
                    renderAnalysis(message.analysis);
                    break;
                case 'analysisError':
                    document.getElementById('analysisOutput').innerHTML = 
                        '<div style="color: var(--vscode-errorForeground);">Error: ' + message.error + '</div>';
                    break;
            }
        });

        // Initialize button states
        updateLogsCount();

        function updateStatus(recording) {
            const indicator = document.getElementById('statusIndicator');
            indicator.className = 'status-indicator ' + (recording ? 'recording' : 'idle');
        }

        function updateButtons() {
            document.getElementById('startBtn').disabled = isRecording;
            document.getElementById('stopBtn').disabled = !isRecording;
            document.getElementById('analyzeBtn').disabled = logs.length === 0;
        }

        function updateSelectedCount() {
            const countEl = document.getElementById('selectedCount');
            if (countEl) {
                countEl.textContent = '(' + selectedComponents.size + ' selected)';
            }
        }

        function updateLogsCount() {
            const countEl = document.getElementById('logsCount');
            if (countEl) {
                countEl.textContent = '(' + logs.length + ' logs)';
            }
            // Update button states
            const copyBtn = document.getElementById('copyLogsBtn');
            const saveBtn = document.getElementById('saveLogsBtn');
            const hasLogs = logs.length > 0;
            if (copyBtn) copyBtn.disabled = !hasLogs;
            if (saveBtn) saveBtn.disabled = !hasLogs;
        }

        function renderTree(tree) {
            const container = document.getElementById('treeview');
            if (!tree || tree.length === 0) {
                container.innerHTML = '<div class="loading">No components found. Make sure you have a React Native project with component files.</div>';
                return;
            }

            treeData = tree;
            container.innerHTML = '';
            tree.forEach(node => {
                container.appendChild(createTreeNode(node, 0));
            });
            updateSelectedCount();
        }

        function createTreeNode(node, depth) {
            const hasChildren = node.children && node.children.length > 0;
            const isExpanded = expandedNodes.has(node.path);
            const isSelected = selectedComponents.has(node.path);
            
            // Count selected items in subtree
            const subtreeSelectionCount = countSubtreeSelections(node);

            const div = document.createElement('div');
            div.className = 'tree-node' + (isSelected ? ' selected' : '');
            div.dataset.path = node.path;

            const content = document.createElement('div');
            content.className = 'tree-node-content';

            // Expand/collapse icon
            const expandIcon = document.createElement('span');
            expandIcon.className = 'tree-expand-icon' + (hasChildren ? '' : ' no-children') + (isExpanded ? '' : ' collapsed');
            expandIcon.textContent = hasChildren ? '▼' : '';
            expandIcon.onclick = (e) => {
                e.stopPropagation();
                toggleNodeExpansion(node.path);
            };

            // Checkbox
            const checkbox = document.createElement('span');
            checkbox.className = 'tree-checkbox' + (isSelected ? ' checked' : '');
            checkbox.onclick = (e) => {
                e.stopPropagation();
                toggleSelection(node.path);
            };

            // Label
            const label = document.createElement('span');
            label.className = 'tree-node-label';
            label.textContent = node.name;
            label.onclick = (e) => {
                e.stopPropagation();
                toggleSelection(node.path);
            };

            // Selection count badge (if subtree has selections)
            if (hasChildren && subtreeSelectionCount > 0) {
                const countBadge = document.createElement('span');
                countBadge.className = 'tree-selection-count';
                countBadge.textContent = subtreeSelectionCount;
                countBadge.title = subtreeSelectionCount + ' item(s) selected in subtree';
                label.appendChild(countBadge);
            }

            // Subtree action buttons
            const buttonContainer = document.createElement('span');
            buttonContainer.style.display = 'flex';
            buttonContainer.style.gap = '4px';
            buttonContainer.style.marginLeft = 'auto';
            
            if (hasChildren) {
                const selectSubtreeBtn = document.createElement('button');
                selectSubtreeBtn.className = 'tree-subtree-btn';
                selectSubtreeBtn.textContent = 'Select';
                selectSubtreeBtn.onclick = (e) => {
                    e.stopPropagation();
                    selectSubtree(node);
                };
                buttonContainer.appendChild(selectSubtreeBtn);

                if (subtreeSelectionCount > 0) {
                    const deselectSubtreeBtn = document.createElement('button');
                    deselectSubtreeBtn.className = 'tree-subtree-btn';
                    deselectSubtreeBtn.textContent = 'Deselect';
                    deselectSubtreeBtn.onclick = (e) => {
                        e.stopPropagation();
                        deselectSubtree(node);
                    };
                    buttonContainer.appendChild(deselectSubtreeBtn);
                }
            }

            content.appendChild(expandIcon);
            content.appendChild(checkbox);
            content.appendChild(label);
            if (hasChildren) {
                content.appendChild(buttonContainer);
            }
            div.appendChild(content);

            // Children
            if (hasChildren) {
                const childrenDiv = document.createElement('div');
                childrenDiv.className = 'tree-children' + (isExpanded ? '' : ' collapsed');
                node.children.forEach(child => {
                    childrenDiv.appendChild(createTreeNode(child, depth + 1));
                });
                div.appendChild(childrenDiv);
            }

            return div;
        }

        function countSubtreeSelections(node) {
            let count = 0;
            if (selectedComponents.has(node.path)) {
                count++;
            }
            if (node.children) {
                node.children.forEach(child => {
                    count += countSubtreeSelections(child);
                });
            }
            return count;
        }

        function toggleNodeExpansion(path) {
            if (expandedNodes.has(path)) {
                expandedNodes.delete(path);
            } else {
                expandedNodes.add(path);
            }
            renderTree(treeData);
        }

        function toggleSelection(path) {
            if (selectedComponents.has(path)) {
                selectedComponents.delete(path);
            } else {
                selectedComponents.add(path);
            }
            renderTree(treeData);
            updateSelectedComponents();
        }

        function selectSubtree(node) {
            // Add this node and all its children recursively
            function addNodeAndChildren(n) {
                selectedComponents.add(n.path);
                if (n.children) {
                    n.children.forEach(child => addNodeAndChildren(child));
                }
            }
            addNodeAndChildren(node);
            renderTree(treeData);
            updateSelectedComponents();
        }

        function deselectSubtree(node) {
            // Remove this node and all its children recursively
            function removeNodeAndChildren(n) {
                selectedComponents.delete(n.path);
                if (n.children) {
                    n.children.forEach(child => removeNodeAndChildren(child));
                }
            }
            removeNodeAndChildren(node);
            renderTree(treeData);
            updateSelectedComponents();
        }

        function clearAllSelections() {
            selectedComponents.clear();
            renderTree(treeData);
            updateSelectedComponents();
        }

        function updateSelectedComponents() {
            updateSelectedCount();
            vscode.postMessage({
                type: 'selectComponents',
                components: Array.from(selectedComponents)
            });
        }

        function renderLogs(logs) {
            const container = document.getElementById('logDisplay');
            updateLogsCount();
            
            if (logs.length === 0) {
                container.innerHTML = '<div class="empty-state">No logs yet.</div>';
                return;
            }

            container.innerHTML = logs.slice().reverse().map(log => {
                const time = new Date(log.timestamp).toLocaleTimeString();
                return \`<div class="log-entry">
                    <div class="log-entry-info">
                        <span class="log-entry-component">\${log.id}</span>
                        <div class="log-entry-details">
                            \${log.phase} • \${time}
                        </div>
                    </div>
                    <span class="log-entry-duration">\${log.actualDuration.toFixed(2)}ms</span>
                </div>\`;
            }).join('');
            
            container.scrollTop = 0;
        }

        function formatLogsForExport(logs) {
            if (logs.length === 0) {
                return 'No profiling logs available.';
            }

            const header = 'React Native Profiler Logs\n' +
                'Generated: ' + new Date().toISOString() + '\n' +
                'Total Logs: ' + logs.length + '\n' +
                '='.repeat(80) + '\n\n';

            const logEntries = logs.map((log, index) => {
                const timestamp = new Date(log.timestamp).toISOString();
                return \`Log #\${index + 1}
Component: \${log.id}
Phase: \${log.phase}
Actual Duration: \${log.actualDuration.toFixed(2)}ms
Base Duration: \${log.baseDuration.toFixed(2)}ms
Start Time: \${log.startTime.toFixed(2)}ms
Commit Time: \${log.commitTime.toFixed(2)}ms
Timestamp: \${timestamp}
Device OS: \${log.deviceInfo?.os || 'unknown'}
Device Version: \${log.deviceInfo?.version || 'unknown'}
\${log.deviceInfo?.model ? 'Device Model: ' + log.deviceInfo.model + '\\n' : ''}\${log.interactions && log.interactions.length > 0 ? 'Interactions: ' + log.interactions.join(', ') + '\\n' : ''}\${'-'.repeat(80)}\`;
            }).join('\n\n');

            return header + logEntries;
        }

        function copyLogsToClipboard() {
            if (logs.length === 0) {
                alert('No logs to copy');
                return;
            }

            const formatted = formatLogsForExport(logs);
            
            // Use VS Code's clipboard API
            vscode.postMessage({
                type: 'copyToClipboard',
                text: formatted
            });
        }

        function saveLogsToFile() {
            if (logs.length === 0) {
                alert('No logs to save');
                return;
            }

            const formatted = formatLogsForExport(logs);
            
            // Send message to extension to save file
            vscode.postMessage({
                type: 'saveLogsToFile',
                content: formatted,
                defaultFilename: 'profiler-logs-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5) + '.txt'
            });
        }

        function renderAnalysis(analysis) {
            const container = document.getElementById('analysisOutput');
            // Simple markdown-like rendering
            let html = analysis.replace(/\\n/g, '<br>');
            // Convert markdown headers
            html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
            html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
            html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
            // Convert code blocks (using String.fromCharCode for backticks)
            const backtick = String.fromCharCode(96);
            html = html.replace(new RegExp(backtick + backtick + backtick + '([\\\\s\\\\S]*?)' + backtick + backtick + backtick, 'g'), '<pre><code>$1</code></pre>');
            // Convert inline code
            html = html.replace(new RegExp(backtick + '([^' + backtick + ']+)' + backtick, 'g'), '<code>$1</code>');
            // Convert links (basic)
            html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, (match, text, url) => {
                if (url.startsWith('file://')) {
                    return '<a href="#" onclick="openFile(\\'' + url + '\\')">' + text + '</a>';
                }
                return '<a href="' + url + '">' + text + '</a>';
            });

            container.innerHTML = html;
        }

        function openFile(path) {
            vscode.postMessage({ type: 'openFile', path: path });
        }

        // Poll for logs while recording
        setInterval(() => {
            if (isRecording) {
                vscode.postMessage({ type: 'requestLogs' });
            }
        }, 1000);
    </script>
</body>
</html>`;
  }

  private dispose() {
    // Clean up our resources
    while (this.disposables.length) {
      const x = this.disposables.pop();
      if (x) {
        x.dispose();
      }
    }
    
    // Clear the static reference
    if (ProfilerPanel.currentPanel === this) {
      ProfilerPanel.currentPanel = undefined;
    }
  }
}
