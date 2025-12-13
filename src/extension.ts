import * as vscode from 'vscode';
import { ProfilerPanel } from './profilerPanel';
import { ProfilerServer } from './profilerServer';
import { ComponentTreeProvider } from './componentTreeProvider';
import { ProfileLog } from './types';

let profilerPanel: ProfilerPanel | undefined;
let profilerServer: ProfilerServer | undefined;
let componentTreeProvider: ComponentTreeProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('RN Profiler AI extension is now active!');

    // Check if this is a React Native project
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        const packageJsonPath = vscode.Uri.joinPath(workspaceFolders[0].uri, 'package.json');
        vscode.workspace.fs.readFile(packageJsonPath).then(
            (content) => {
                try {
                    const packageJson = JSON.parse(content.toString());
                    const hasReactNative = packageJson.dependencies?.['react-native'] || 
                                         packageJson.devDependencies?.['react-native'];
                    if (!hasReactNative) {
                        vscode.window.showInformationMessage(
                            'RN Profiler AI: This doesn\'t appear to be a React Native project. Some features may not work correctly.'
                        );
                    }
                } catch (error) {
                    // Ignore errors reading package.json
                }
            },
            () => {
                // Ignore errors if package.json doesn't exist
            }
        );
    }

    // Initialize component tree provider
    componentTreeProvider = new ComponentTreeProvider(context);

    // Register commands
    const showPanelCommand = vscode.commands.registerCommand(
        'rnProfilerAI.showProfilerPanel',
        () => {
            if (!profilerPanel) {
                profilerPanel = ProfilerPanel.createOrShow(context.extensionUri, componentTreeProvider!);
            } else {
                profilerPanel.reveal();
            }
        }
    );

    const startRecordingCommand = vscode.commands.registerCommand(
        'rnProfilerAI.startRecording',
        async () => {
            if (!profilerServer) {
                const config = vscode.workspace.getConfiguration('rnProfilerAI');
                const port = config.get<number>('serverPort', 1337);
                
                try {
                    profilerServer = new ProfilerServer(port);
                    await profilerServer.start();
                    
                if (profilerPanel) {
                    profilerPanel.setServer(profilerServer);
                    profilerPanel.sendMessage({ type: 'recordingStarted' });
                    
                    // Set up periodic log updates
                    const logUpdateInterval = setInterval(() => {
                        if (profilerServer && profilerPanel) {
                            const logs = profilerServer.getLogs();
                            profilerPanel.sendMessage({
                                type: 'logsUpdate',
                                logs: logs
                            });
                        } else {
                            clearInterval(logUpdateInterval);
                        }
                    }, 1000);
                    
                    // Store interval for cleanup
                    context.subscriptions.push({
                        dispose: () => clearInterval(logUpdateInterval)
                    });
                }

                    // Update RN config file
                    await updateRNConfig(true, []);
                    
                    vscode.window.showInformationMessage(`Profiling started on port ${port}`);
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to start profiling: ${error.message}`);
                    profilerServer = undefined;
                }
            } else {
                vscode.window.showWarningMessage('Recording is already in progress');
            }
        }
    );

    const stopRecordingCommand = vscode.commands.registerCommand(
        'rnProfilerAI.stopRecording',
        async () => {
            if (profilerServer) {
                const logs = profilerServer.getLogs();
                profilerServer.stop();
                profilerServer = undefined;

                if (profilerPanel) {
                    profilerPanel.setServer(undefined);
                    profilerPanel.storeLogs(logs);
                    profilerPanel.sendMessage({ 
                        type: 'recordingStopped',
                        logs: logs
                    });
                }

                // Update RN config file
                await updateRNConfig(false, []);

                vscode.window.showInformationMessage(`Recording stopped. Collected ${logs.length} log entries.`);

                // Auto-analyze if enabled
                const config = vscode.workspace.getConfiguration('rnProfilerAI');
                const autoAnalyze = config.get<boolean>('autoAnalyze', true);
                if (autoAnalyze && logs.length > 0) {
                    vscode.commands.executeCommand('rnProfilerAI.analyzeLogs');
                }
            } else {
                vscode.window.showWarningMessage('No recording in progress');
            }
        }
    );

    const analyzeLogsCommand = vscode.commands.registerCommand(
        'rnProfilerAI.analyzeLogs',
        async () => {
            // Get logs from server if running, or from panel's stored logs
            let logs: ProfileLog[] = [];
            if (profilerServer) {
                logs = profilerServer.getLogs();
            } else if (profilerPanel) {
                logs = profilerPanel.getStoredLogs();
            }

            if (logs.length === 0) {
                vscode.window.showErrorMessage('No profiling logs available. Please start and stop a recording first.');
                return;
            }

            if (profilerPanel) {
                await profilerPanel.analyzeLogs(logs);
            } else {
                vscode.window.showWarningMessage('Please open the Profiler Panel first.');
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
        }
    });
}

export function deactivate() {
    if (profilerServer) {
        profilerServer.stop();
    }
}

/**
 * Updates the React Native profiler configuration file
 */
async function updateRNConfig(enabled: boolean, components: string[]) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const configPath = vscode.Uri.joinPath(workspaceFolders[0].uri, 'src', 'rn-profiler-config.ts');
    
    const configContent = `// Auto-generated by RN Profiler AI extension
// Changes to this file may require a Metro Bundler restart

export const PROFILING_ENABLED: boolean = ${enabled};
export const COMPONENTS_TO_PROFILE: string[] = ${JSON.stringify(components, null, 2)};
`;

    try {
        await vscode.workspace.fs.writeFile(configPath, Buffer.from(configContent, 'utf8'));
    } catch (error) {
        console.error('Failed to update RN config:', error);
    }
}

