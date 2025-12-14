import * as vscode from "vscode";
import { ProfilerPanel } from "./profilerPanel";
import { ProfilerServer } from "./profilerServer";
import { ComponentTreeProvider } from "./componentTreeProvider";
import { ProfileLog } from "./types";

let profilerPanel: ProfilerPanel | undefined;
let profilerServer: ProfilerServer | undefined;
let componentTreeProvider: ComponentTreeProvider | undefined;

export async function activate(context: vscode.ExtensionContext) {
  try {
    console.log("RN Profiler AI extension is now active!");
    vscode.window.showInformationMessage("RN Profiler AI extension activated!");

    // Check if this is a React Native project (supports monorepos)
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      findReactNativeProject(workspaceFolders[0].uri).then((rnPath) => {
        if (!rnPath) {
          vscode.window.showInformationMessage(
            "RN Profiler AI: Could not find a React Native project. Make sure you have a package.json with react-native dependency."
          );
        } else if (rnPath !== workspaceFolders[0].uri.fsPath) {
          console.log(
            `RN Profiler AI: Found React Native project at: ${rnPath}`
          );
        }
      });
    }

    // Initialize component tree provider
    componentTreeProvider = new ComponentTreeProvider(context);

    // Register commands
    const showPanelCommand = vscode.commands.registerCommand(
      "rnProfilerAI.showProfilerPanel",
      () => {
        if (!profilerPanel) {
          profilerPanel = ProfilerPanel.createOrShow(
            context.extensionUri,
            componentTreeProvider!
          );
        } else {
          profilerPanel.reveal();
        }
      }
    );

    const startRecordingCommand = vscode.commands.registerCommand(
      "rnProfilerAI.startRecording",
      async () => {
        if (!profilerServer) {
          const config = vscode.workspace.getConfiguration("rnProfilerAI");
          const port = config.get<number>("serverPort", 1337);

          try {
            profilerServer = new ProfilerServer(port);
            await profilerServer.start();

            if (profilerPanel) {
              profilerPanel.setServer(profilerServer);
              profilerPanel.sendMessage({ type: "recordingStarted" });

              // Set up periodic log updates
              const logUpdateInterval = setInterval(() => {
                if (profilerServer && profilerPanel) {
                  const logs = profilerServer.getLogs();
                  profilerPanel.sendMessage({
                    type: "logsUpdate",
                    logs: logs,
                  });
                } else {
                  clearInterval(logUpdateInterval);
                }
              }, 1000);

              // Store interval for cleanup
              context.subscriptions.push({
                dispose: () => clearInterval(logUpdateInterval),
              });
            }

            // Update RN config file with selected components
            const selectedComponents =
              profilerPanel?.getSelectedComponents() || [];
            // Extract component names from paths (format: "path/to/file.tsx::ComponentName")
            const componentNames = selectedComponents
              .map((compPath) => {
                const parts = compPath.split("::");
                return parts.length > 1
                  ? parts[1]
                  : compPath
                      .split("/")
                      .pop()
                      ?.replace(/\.(tsx|jsx|ts|js)$/, "") || "";
              })
              .filter((name) => name.length > 0);

            console.log(
              `[Profiler] Starting recording with components: ${componentNames.join(
                ", "
              )}`
            );
            await updateRNConfig(true, componentNames);

            vscode.window.showInformationMessage(
              `Profiling started on port ${port}. ` +
                `${
                  componentNames.length > 0
                    ? `Profiling ${componentNames.length} component(s). `
                    : "No components selected. "
                }` +
                `Please restart Metro Bundler if config changes don't take effect.`
            );
          } catch (error: any) {
            vscode.window.showErrorMessage(
              `Failed to start profiling: ${error.message}`
            );
            profilerServer = undefined;
          }
        } else {
          vscode.window.showWarningMessage("Recording is already in progress");
        }
      }
    );

    const stopRecordingCommand = vscode.commands.registerCommand(
      "rnProfilerAI.stopRecording",
      async () => {
        if (profilerServer) {
          const logs = profilerServer.getLogs();
          profilerServer.stop();
          profilerServer = undefined;

          if (profilerPanel) {
            profilerPanel.setServer(undefined);
            profilerPanel.storeLogs(logs);
            profilerPanel.sendMessage({
              type: "recordingStopped",
              logs: logs,
            });
          }

          // Update RN config file - extract component names from paths
          const selectedComponents =
            profilerPanel?.getSelectedComponents() || [];
          const componentNames = selectedComponents
            .map((compPath) => {
              const parts = compPath.split("::");
              return parts.length > 1
                ? parts[1]
                : compPath
                    .split("/")
                    .pop()
                    ?.replace(/\.(tsx|jsx|ts|js)$/, "") || "";
            })
            .filter((name) => name.length > 0);
          await updateRNConfig(false, componentNames);

          if (logs.length === 0) {
            vscode.window.showWarningMessage(
              `Recording stopped but collected 0 logs. ` +
                `Check: 1) Component name in COMPONENTS_TO_PROFILE matches withProfiler name, ` +
                `2) Metro Bundler was restarted, 3) Component rendered during profiling, ` +
                `4) Server URL is correct (use 10.0.2.2 for Android emulator). ` +
                `See Output panel for details.`
            );
          } else {
            vscode.window.showInformationMessage(
              `Recording stopped. Collected ${logs.length} log entries.`
            );
          }

          // Auto-analyze if enabled
          const config = vscode.workspace.getConfiguration("rnProfilerAI");
          const autoAnalyze = config.get<boolean>("autoAnalyze", true);
          if (autoAnalyze && logs.length > 0) {
            vscode.commands.executeCommand("rnProfilerAI.analyzeLogs");
          }
        } else {
          vscode.window.showWarningMessage("No recording in progress");
        }
      }
    );

    const analyzeLogsCommand = vscode.commands.registerCommand(
      "rnProfilerAI.analyzeLogs",
      async () => {
        // Get logs from server if running, or from panel's stored logs
        let logs: ProfileLog[] = [];
        if (profilerServer) {
          logs = profilerServer.getLogs();
        } else if (profilerPanel) {
          logs = profilerPanel.getStoredLogs();
        }

        if (logs.length === 0) {
          vscode.window.showErrorMessage(
            "No profiling logs available. Please start and stop a recording first."
          );
          return;
        }

        if (profilerPanel) {
          await profilerPanel.analyzeLogs(logs);
        } else {
          vscode.window.showWarningMessage(
            "Please open the Profiler Panel first."
          );
        }
      }
    );

    context.subscriptions.push(
      showPanelCommand,
      startRecordingCommand,
      stopRecordingCommand,
      analyzeLogsCommand
    );

    // Cleanup on deactivation
    context.subscriptions.push({
      dispose: () => {
        if (profilerServer) {
          profilerServer.stop();
        }
      },
    });

    // Verify commands are registered
    const registeredCommands = await vscode.commands.getCommands();
    const ourCommands = registeredCommands.filter((cmd) =>
      cmd.startsWith("rnProfilerAI.")
    );
    console.log("RN Profiler AI: All commands registered successfully");
    console.log("RN Profiler AI: Registered commands:", ourCommands);

    if (ourCommands.length === 0) {
      vscode.window.showErrorMessage(
        "RN Profiler AI: No commands were registered! Check the Debug Console for errors."
      );
    } else {
      vscode.window.showInformationMessage(
        `RN Profiler AI: ${
          ourCommands.length
        } commands registered: ${ourCommands.join(", ")}`
      );
    }
  } catch (error: any) {
    const errorMessage = `RN Profiler AI activation failed: ${error.message}`;
    console.error(errorMessage, error);
    vscode.window.showErrorMessage(errorMessage);
    throw error;
  }
}

export function deactivate() {
  if (profilerServer) {
    profilerServer.stop();
  }
}

/**
 * Finds the React Native project directory (supports monorepos)
 */
async function findReactNativeProject(
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
 * Updates the React Native profiler configuration file
 */
async function updateRNConfig(enabled: boolean, components: string[]) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  // Find the React Native project directory
  const rnPath = await findReactNativeProject(workspaceFolders[0].uri);
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

  const configContent = `// Auto-generated by RN Profiler AI extension
// Changes to this file may require a Metro Bundler restart

export const PROFILING_ENABLED: boolean = ${enabled};
export const COMPONENTS_TO_PROFILE: string[] = ${JSON.stringify(
    components,
    null,
    2
  )};
`;

  try {
    await vscode.workspace.fs.writeFile(
      configPath,
      Buffer.from(configContent, "utf8")
    );
    console.log(
      `[Profiler] Updated config: PROFILING_ENABLED=${enabled}, COMPONENTS_TO_PROFILE=[${components.join(
        ", "
      )}]`
    );
  } catch (error) {
    console.error("Failed to update RN config:", error);
    vscode.window.showErrorMessage(
      `Failed to update profiler config: ${error}`
    );
  }
}
