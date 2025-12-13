import * as vscode from 'vscode';
import * as path from 'path';
import { ProfilerServer } from './profilerServer';
import { ComponentTreeProvider } from './componentTreeProvider';
import { ProfileLog, WebViewMessage } from './types';
import { AIAnalyzer } from './aiAnalyzer';

/**
 * Manages the WebView panel that displays the profiler UI
 */
export class ProfilerPanel {
    public static readonly viewType = 'rnProfilerAI';

    private panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];
    private server: ProfilerServer | undefined;
    private componentTreeProvider: ComponentTreeProvider;
    private aiAnalyzer: AIAnalyzer;
    private storedLogs: ProfileLog[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        componentTreeProvider: ComponentTreeProvider
    ) {
        this.panel = panel;
        this.componentTreeProvider = componentTreeProvider;
        this.aiAnalyzer = new AIAnalyzer(componentTreeProvider);

        // Set the webview's initial html content
        this.update();

        // Listen for when the panel is disposed
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            async (message: WebViewMessage) => {
                // Handle command messages
                if (message.type === 'startRecording') {
                    await vscode.commands.executeCommand('rnProfilerAI.startRecording');
                } else if (message.type === 'stopRecording') {
                    await vscode.commands.executeCommand('rnProfilerAI.stopRecording');
                } else if (message.type === 'analyzeLogs') {
                    await vscode.commands.executeCommand('rnProfilerAI.analyzeLogs');
                } else {
                    // Handle other messages
                    await this.handleMessage(message);
                }
            },
            null,
            this.disposables
        );
    }

    public static createOrShow(
        extensionUri: vscode.Uri,
        componentTreeProvider: ComponentTreeProvider
    ) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        const existingPanel = vscode.window.activeTextEditor?.viewColumn
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            ProfilerPanel.viewType,
            'RN Profiler AI',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.joinPath(extensionUri, 'out')
                ],
                retainContextWhenHidden: true
            }
        );

        return new ProfilerPanel(panel, extensionUri, componentTreeProvider);
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

    public sendMessage(message: WebViewMessage) {
        this.panel.webview.postMessage(message);
    }

    public async analyzeLogs(logs: ProfileLog[]) {
        if (logs.length === 0) {
            this.sendMessage({
                type: 'analysisError',
                error: 'No logs to analyze'
            });
            return;
        }

        this.sendMessage({
            type: 'analysisStarted'
        });

        try {
            const analysis = await this.aiAnalyzer.analyze(logs);
            this.sendMessage({
                type: 'analysisComplete',
                analysis: analysis
            });
        } catch (error: any) {
            this.sendMessage({
                type: 'analysisError',
                error: error.message || 'Failed to analyze logs'
            });
        }
    }

    private async handleMessage(message: WebViewMessage) {
        switch (message.type) {
            case 'ready':
                // Send component tree when webview is ready
                const tree = await this.componentTreeProvider.getComponentTree();
                this.sendMessage({
                    type: 'componentTree',
                    tree: tree
                });
                break;

            case 'selectComponents':
                // Update RN config with selected components
                await this.updateSelectedComponents(message.components || []);
                break;

            case 'requestLogs':
                if (this.server) {
                    this.sendMessage({
                        type: 'logsUpdate',
                        logs: this.server.getLogs()
                    });
                }
                break;

            case 'openFile':
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
        }
    }

    private async updateSelectedComponents(components: string[]) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        // Extract component names from paths (format: "path/to/file.tsx::ComponentName")
        const componentNames = components
            .map(path => {
                const parts = path.split('::');
                return parts.length > 1 ? parts[1] : path.split('/').pop()?.replace(/\.(tsx|jsx|ts|js)$/, '') || '';
            })
            .filter(name => name.length > 0);

        const configPath = vscode.Uri.joinPath(
            workspaceFolders[0].uri,
            'src',
            'rn-profiler-config.ts'
        );

        const configContent = `// Auto-generated by RN Profiler AI extension
// Changes to this file may require a Metro Bundler restart

export const PROFILING_ENABLED: boolean = ${this.server?.isRunning() || false};
export const COMPONENTS_TO_PROFILE: string[] = ${JSON.stringify(componentNames, null, 2)};
`;

        try {
            await vscode.workspace.fs.writeFile(configPath, Buffer.from(configContent, 'utf8'));
            vscode.window.showInformationMessage(
                `Updated ${componentNames.length} components. Metro Bundler restart may be required.`
            );
        } catch (error) {
            console.error('Failed to update selected components:', error);
            vscode.window.showErrorMessage('Failed to update component selection');
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
            padding: 20px;
            overflow-x: hidden;
        }

        .container {
            display: flex;
            flex-direction: column;
            gap: 20px;
            max-width: 100%;
        }

        .section {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 15px;
        }

        .section-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 10px;
            color: var(--vscode-foreground);
        }

        .controls {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }

        button {
            padding: 8px 16px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
        }

        button:hover {
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
            max-height: 400px;
            overflow-y: auto;
            border: 1px solid var(--vscode-panel-border);
            padding: 10px;
            background-color: var(--vscode-editor-background);
        }

        .tree-node {
            padding: 4px 0;
            cursor: pointer;
            user-select: none;
        }

        .tree-node:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .tree-node.selected {
            background-color: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        .tree-children {
            margin-left: 20px;
        }

        .log-display {
            max-height: 300px;
            overflow-y: auto;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            background-color: var(--vscode-textCodeBlock-background);
            padding: 10px;
            border-radius: 4px;
        }

        .log-entry {
            padding: 4px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .log-entry:last-child {
            border-bottom: none;
        }

        .analysis-output {
            max-height: 500px;
            overflow-y: auto;
            padding: 15px;
            background-color: var(--vscode-textCodeBlock-background);
            border-radius: 4px;
        }

        .analysis-output h2 {
            margin-top: 20px;
            margin-bottom: 10px;
            font-size: 18px;
        }

        .analysis-output h3 {
            margin-top: 15px;
            margin-bottom: 8px;
            font-size: 16px;
        }

        .analysis-output p {
            margin-bottom: 10px;
            line-height: 1.6;
        }

        .analysis-output ul, .analysis-output ol {
            margin-left: 20px;
            margin-bottom: 10px;
        }

        .analysis-output li {
            margin-bottom: 5px;
        }

        .analysis-output code {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
        }

        .analysis-output pre {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
            margin-bottom: 10px;
        }

        .status-indicator {
            display: inline-block;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            margin-right: 8px;
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
            padding: 20px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="section">
            <div class="section-title">
                <span class="status-indicator" id="statusIndicator"></span>
                Profiling Controls
            </div>
            <div class="controls">
                <button id="startBtn" class="primary">Start Recording</button>
                <button id="stopBtn" disabled>Stop Recording</button>
                <button id="analyzeBtn" disabled>Analyze Logs</button>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Component Tree</div>
            <div class="treeview" id="treeview">
                <div class="loading">Loading component tree...</div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Live Logs</div>
            <div class="log-display" id="logDisplay">
                <div class="loading">No logs yet. Start recording to see profiling data.</div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">AI Analysis</div>
            <div class="analysis-output" id="analysisOutput">
                <div class="loading">Analysis will appear here after you analyze logs.</div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let selectedComponents = new Set();
        let isRecording = false;
        let logs = [];

        // Initialize
        window.addEventListener('load', () => {
            vscode.postMessage({ type: 'ready' });
            updateStatus(false);
        });

        // Button handlers
        document.getElementById('startBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'startRecording' });
        });

        document.getElementById('stopBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'stopRecording' });
        });

        document.getElementById('analyzeBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'analyzeLogs' });
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

        function updateStatus(recording) {
            const indicator = document.getElementById('statusIndicator');
            indicator.className = 'status-indicator ' + (recording ? 'recording' : 'idle');
        }

        function updateButtons() {
            document.getElementById('startBtn').disabled = isRecording;
            document.getElementById('stopBtn').disabled = !isRecording;
            document.getElementById('analyzeBtn').disabled = logs.length === 0;
        }

        function renderTree(tree) {
            const container = document.getElementById('treeview');
            if (!tree || tree.length === 0) {
                container.innerHTML = '<div class="loading">No components found. Make sure you have a React Native project with component files.</div>';
                return;
            }

            // Store tree data for re-rendering
            treeData = tree;

            container.innerHTML = '';
            tree.forEach(node => {
                container.appendChild(createTreeNode(node));
            });
        }

        function createTreeNode(node) {
            const div = document.createElement('div');
            div.className = 'tree-node';
            div.dataset.path = node.path;

            const isSelected = selectedComponents.has(node.path);
            if (isSelected) {
                div.classList.add('selected');
            }

            // Add checkbox or indicator for selected state
            const indicator = isSelected ? '✓ ' : '';
            div.innerHTML = '<span>' + indicator + node.name + '</span>';

            div.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSelection(node.path);
                updateSelectedComponents();
            });

            if (node.children && node.children.length > 0) {
                const childrenDiv = document.createElement('div');
                childrenDiv.className = 'tree-children';
                node.children.forEach(child => {
                    childrenDiv.appendChild(createTreeNode(child));
                });
                div.appendChild(childrenDiv);
            }

            return div;
        }

        let treeData = [];

        function toggleSelection(path) {
            if (selectedComponents.has(path)) {
                selectedComponents.delete(path);
            } else {
                selectedComponents.add(path);
            }
            // Re-render tree with updated selection state
            renderTree(treeData);
        }

        function updateSelectedComponents() {
            vscode.postMessage({
                type: 'selectComponents',
                components: Array.from(selectedComponents)
            });
        }

        function renderLogs(logs) {
            const container = document.getElementById('logDisplay');
            if (logs.length === 0) {
                container.innerHTML = '<div class="loading">No logs yet.</div>';
                return;
            }

            container.innerHTML = logs.map(log => {
                return \`<div class="log-entry">
                    <strong>\${log.id}</strong> - \${log.phase} - \${log.actualDuration.toFixed(2)}ms
                    <br><small>\${new Date(log.timestamp).toLocaleTimeString()}</small>
                </div>\`;
            }).join('');
            
            container.scrollTop = container.scrollHeight;
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
        this.panel.dispose();

        while (this.disposables.length) {
            const x = this.disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }
}

