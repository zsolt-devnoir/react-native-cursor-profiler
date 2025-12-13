import * as vscode from 'vscode';
import axios from 'axios';
import { ProfileLog } from './types';
import { ComponentTreeProvider } from './componentTreeProvider';

/**
 * Handles AI analysis of profiling logs using OpenAI or Anthropic APIs
 */
export class AIAnalyzer {
    private componentTreeProvider: ComponentTreeProvider;

    constructor(componentTreeProvider: ComponentTreeProvider) {
        this.componentTreeProvider = componentTreeProvider;
    }

    /**
     * Analyzes profiling logs using AI
     */
    async analyze(logs: ProfileLog[]): Promise<string> {
        const config = vscode.workspace.getConfiguration('rnProfilerAI');
        const apiKey = config.get<string>('apiKey', '');
        const provider = config.get<string>('apiProvider', 'openai');

        // For Cursor, API key is optional if using built-in AI
        if (!apiKey && provider !== 'cursor') {
            throw new Error('API key not configured. Please set rnProfilerAI.apiKey in VS Code settings.');
        }

        // Identify bottleneck components
        const bottlenecks = this.identifyBottlenecks(logs);
        
        // Get source code for bottleneck components
        const codeContext = await this.getCodeContext(bottlenecks);

        // Build the prompt
        const prompt = this.buildPrompt(logs, bottlenecks, codeContext);

        // Call AI API
        if (provider === 'openai') {
            return await this.callOpenAI(apiKey, prompt);
        } else if (provider === 'anthropic') {
            return await this.callAnthropic(apiKey, prompt);
        } else if (provider === 'cursor') {
            return await this.callCursor(apiKey, prompt);
        } else {
            throw new Error(`Unsupported API provider: ${provider}`);
        }
    }

    /**
     * Identifies potential bottleneck components from logs
     */
    private identifyBottlenecks(logs: ProfileLog[]): string[] {
        // Group logs by component ID
        const componentStats = new Map<string, {
            totalDuration: number;
            maxDuration: number;
            count: number;
            avgDuration: number;
            highDurationCount: number;
        }>();

        logs.forEach(log => {
            const stats = componentStats.get(log.id) || {
                totalDuration: 0,
                maxDuration: 0,
                count: 0,
                avgDuration: 0,
                highDurationCount: 0
            };

            stats.totalDuration += log.actualDuration;
            stats.maxDuration = Math.max(stats.maxDuration, log.actualDuration);
            stats.count += 1;
            stats.avgDuration = stats.totalDuration / stats.count;

            // Count renders with duration significantly higher than base
            if (log.actualDuration > log.baseDuration * 1.5) {
                stats.highDurationCount += 1;
            }

            componentStats.set(log.id, stats);
        });

        // Sort by various criteria and pick top bottlenecks
        const sorted = Array.from(componentStats.entries())
            .map(([id, stats]) => ({
                id,
                ...stats,
                score: stats.maxDuration * 0.4 + stats.avgDuration * 0.3 + stats.highDurationCount * 0.3
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 10) // Top 10
            .map(item => item.id);

        return sorted;
    }

    /**
     * Gets source code context for bottleneck components
     */
    private async getCodeContext(componentIds: string[]): Promise<Map<string, string>> {
        const context = new Map<string, string>();

        for (const componentId of componentIds) {
            // Extract file path from component ID (format: "path/to/file.tsx::ComponentName")
            const [filePath] = componentId.split('::');
            
            try {
                const source = await this.componentTreeProvider.getComponentSource(componentId);
                if (source) {
                    // Limit source code length to avoid token limits
                    const maxLength = 2000;
                    const truncated = source.length > maxLength 
                        ? source.substring(0, maxLength) + '\n... (truncated)'
                        : source;
                    context.set(componentId, truncated);
                }
            } catch (error) {
                console.error(`Failed to get source for ${componentId}:`, error);
            }
        }

        return context;
    }

    /**
     * Builds the AI prompt with logs, bottlenecks, and code context
     */
    private buildPrompt(
        logs: ProfileLog[],
        bottlenecks: string[],
        codeContext: Map<string, string>
    ): string {
        const logsSummary = this.summarizeLogs(logs);
        const codeSnippets = Array.from(codeContext.entries())
            .map(([id, code]) => `\n## Component: ${id}\n\`\`\`typescript\n${code}\n\`\`\``)
            .join('\n');

        return `You are a React Native performance expert. Analyze the following React Native component render profiles and identify performance bottlenecks, potential root causes, and suggest concrete optimizations.

## Instructions
- Focus on renders with \`actualDuration\` significantly higher than \`baseDuration\`
- Identify frequent re-renders that may be unnecessary
- Look for unusually high \`mount\` times
- Consider React Native-specific performance concerns (e.g., expensive operations on JS thread, large lists, heavy computations)
- Provide detailed, actionable advice with specific code suggestions

## Profiling Data Summary
${logsSummary}

## Identified Bottleneck Components
${bottlenecks.map(id => `- ${id}`).join('\n')}

## Source Code Context
${codeSnippets || 'No source code available for bottleneck components.'}

## Output Format
Provide your analysis in structured Markdown format with:
1. **Summary**: A brief overview of the performance issues found
2. **Bottlenecks**: A list of identified bottlenecks with:
   - Component Name
   - Issue Description
   - Severity (High/Medium/Low)
   - Impact (e.g., "Causes 200ms render delay")
3. **Detailed Recommendations**: For each bottleneck, provide:
   - Root cause analysis
   - Specific optimization suggestions
   - Code examples where applicable
   - References to specific lines/files if mentioned in code snippets

## Raw Logs (for reference)
\`\`\`json
${JSON.stringify(logs.slice(0, 50), null, 2)}
\`\`\`

Please provide a comprehensive analysis now.`;
    }

    /**
     * Summarizes logs for the prompt
     */
    private summarizeLogs(logs: ProfileLog[]): string {
        const totalLogs = logs.length;
        const byPhase = logs.reduce((acc, log) => {
            acc[log.phase] = (acc[log.phase] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const avgDuration = logs.reduce((sum, log) => sum + log.actualDuration, 0) / totalLogs;
        const maxDuration = Math.max(...logs.map(log => log.actualDuration));
        const components = new Set(logs.map(log => log.id)).size;

        return `
- Total render events: ${totalLogs}
- Unique components: ${components}
- Average render duration: ${avgDuration.toFixed(2)}ms
- Maximum render duration: ${maxDuration.toFixed(2)}ms
- Phase distribution: ${JSON.stringify(byPhase)}
`;
    }

    /**
     * Calls OpenAI API
     */
    private async callOpenAI(apiKey: string, prompt: string): Promise<string> {
        try {
            const response = await axios.post(
                'https://api.openai.com/v1/chat/completions',
                {
                    model: 'gpt-4-turbo-preview',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a React Native performance optimization expert. Provide detailed, actionable analysis of performance profiling data.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 4000
                },
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            return response.data.choices[0].message.content;
        } catch (error: any) {
            if (error.response) {
                const errorMsg = error.response.data?.error?.message || error.message;
                vscode.window.showErrorMessage(`OpenAI API error: ${errorMsg}`);
                throw new Error(`OpenAI API error: ${errorMsg}`);
            }
            const errorMsg = error.message || 'Unknown error';
            vscode.window.showErrorMessage(`Failed to call OpenAI API: ${errorMsg}`);
            throw new Error(`Failed to call OpenAI API: ${errorMsg}`);
        }
    }

    /**
     * Calls Anthropic API
     */
    private async callAnthropic(apiKey: string, prompt: string): Promise<string> {
        try {
            const response = await axios.post(
                'https://api.anthropic.com/v1/messages',
                {
                    model: 'claude-3-opus-20240229',
                    max_tokens: 4096,
                    messages: [
                        {
                            role: 'user',
                            content: prompt
                        }
                    ]
                },
                {
                    headers: {
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01',
                        'Content-Type': 'application/json'
                    }
                }
            );

            // Anthropic returns content as an array
            const content = response.data.content;
            if (Array.isArray(content) && content.length > 0) {
                return content[0].text;
            }
            return JSON.stringify(content);
        } catch (error: any) {
            if (error.response) {
                const errorMsg = error.response.data?.error?.message || error.message;
                vscode.window.showErrorMessage(`Anthropic API error: ${errorMsg}`);
                throw new Error(`Anthropic API error: ${errorMsg}`);
            }
            const errorMsg = error.message || 'Unknown error';
            vscode.window.showErrorMessage(`Failed to call Anthropic API: ${errorMsg}`);
            throw new Error(`Failed to call Anthropic API: ${errorMsg}`);
        }
    }

    /**
     * Calls Cursor AI API
     * Cursor uses Anthropic's Claude models under the hood.
     * 
     * Options:
     * 1. If API key is provided, use it with Anthropic API (since Cursor uses Claude)
     * 2. If no API key, show helpful message about using Anthropic key or Cursor's built-in AI
     */
    private async callCursor(apiKey: string | undefined, prompt: string): Promise<string> {
        if (!apiKey || apiKey.trim() === '') {
            // No API key provided - provide helpful guidance
            const choice = await vscode.window.showInformationMessage(
                'No API key configured for Cursor AI. Cursor uses Anthropic\'s Claude models. ' +
                'You can either:\n' +
                '1. Set rnProfilerAI.apiKey to your Anthropic API key\n' +
                '2. Set rnProfilerAI.apiProvider to "anthropic" and use your Anthropic key\n' +
                '3. Use OpenAI by setting rnProfilerAI.apiProvider to "openai"',
                'Use Anthropic API',
                'Cancel'
            );

            if (choice === 'Use Anthropic API') {
                // Switch provider to anthropic
                await vscode.workspace.getConfiguration('rnProfilerAI').update(
                    'apiProvider',
                    'anthropic',
                    vscode.ConfigurationTarget.Global
                );
                throw new Error(
                    'Please set rnProfilerAI.apiKey to your Anthropic API key. ' +
                    'The provider has been switched to "anthropic" for you.'
                );
            }
            throw new Error(
                'API key required for Cursor AI. ' +
                'Since Cursor uses Anthropic\'s Claude, you can use your Anthropic API key. ' +
                'Set rnProfilerAI.apiKey in settings.'
            );
        }

        // Cursor uses Anthropic's Claude models, so we use Anthropic API
        // This is the most reliable approach since Cursor's internal API may not be publicly accessible
        try {
            vscode.window.showInformationMessage(
                'Using Anthropic API (Cursor uses Claude models). Analyzing performance logs...'
            );
            return await this.callAnthropic(apiKey, prompt);
        } catch (error: any) {
            // If Anthropic API fails, provide helpful error
            const errorMsg = error.message || 'Unknown error';
            throw new Error(
                `Failed to call Anthropic API (used by Cursor): ${errorMsg}. ` +
                'Please verify your API key is correct.'
            );
        }
    }
}

