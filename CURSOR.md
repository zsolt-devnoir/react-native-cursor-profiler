# Using RN Profiler AI with Cursor

This extension is fully compatible with **Cursor**, the AI-powered code editor built on VS Code.

## Compatibility

✅ **Fully Supported**: Since Cursor is built on VS Code, all VS Code extensions work seamlessly, including this one.

## Installation in Cursor

1. **Install the Extension**:
   - Open Cursor
   - Press `Ctrl+Shift+X` (or `Cmd+Shift+X` on Mac) to open Extensions
   - Search for "RN Profiler AI" (if published) or install from local folder
   - Or install from the command line: `code --install-extension <path-to-extension>`

2. **For Development**:
   - Open this extension project in Cursor
   - Run `npm install` to install dependencies
   - Press `F5` to launch Extension Development Host
   - In the new window, open your React Native project

## Using Cursor's AI for Analysis

**NEW**: You can now use Cursor's AI directly for performance analysis!

### Setting Up Cursor AI

1. **Open Settings**: `Ctrl+,` (or `Cmd+,` on Mac)
2. **Search for "RN Profiler AI"**
3. **Set Provider**: Change `rnProfilerAI.apiProvider` to `"cursor"`
4. **Set API Key**: 
   - Since Cursor uses Anthropic's Claude models, use your **Anthropic API key**
   - Set `rnProfilerAI.apiKey` to your Anthropic API key
   - Or if you have a Cursor API key, use that instead

### How It Works

When you select "cursor" as the provider:
- The extension uses Anthropic's API (since Cursor uses Claude models)
- You get the same high-quality analysis as Cursor's built-in AI
- No need to switch between different AI providers

### Alternative: Using Cursor's Built-in AI Chat

You can also use Cursor's AI chat alongside the extension:

1. **Profile Your Components**: Use this extension to identify performance bottlenecks
2. **Get AI Analysis**: The extension provides AI-powered performance analysis
3. **Use Cursor AI for Fixes**: Copy the AI analysis recommendations and use Cursor's AI chat to:
   - Generate optimized code
   - Refactor components based on recommendations
   - Ask follow-up questions about the performance issues

### Example Workflow

```
1. Set rnProfilerAI.apiProvider to "cursor"
2. Set rnProfilerAI.apiKey to your Anthropic API key
3. Profile your React Native app with this extension
4. Get AI analysis using Cursor's AI (Claude)
5. Optionally, use Cursor AI chat for additional help with fixes
```

## Cursor-Specific Benefits

- **Dual AI Analysis**: Get performance analysis from this extension, then use Cursor's AI for code generation
- **Seamless Integration**: All VS Code features work identically in Cursor
- **Better Context**: Cursor's AI understands your codebase, making it easier to apply performance fixes

## Settings

All settings work the same way in Cursor:

1. Open Settings: `Ctrl+,` (or `Cmd+,` on Mac)
2. Search for "RN Profiler AI"
3. Configure your API keys and preferences

## Commands

All commands are accessible via:
- Command Palette: `Ctrl+Shift+P` (or `Cmd+Shift+P`)
- Or use Cursor's command search

## Troubleshooting

If you encounter any issues:

1. **Extension Not Loading**: Make sure Cursor is up to date (Cursor is based on VS Code, so extensions should work)
2. **Commands Not Appearing**: Try reloading the window (`Ctrl+R` or `Cmd+R`)
3. **API Issues**: Check that your API keys are set correctly in Cursor settings

## Development

To develop or modify this extension in Cursor:

1. Open the extension project in Cursor
2. Use Cursor's AI to help with:
   - Understanding the codebase
   - Making modifications
   - Adding new features
3. Press `F5` to test in Extension Development Host

## Tips

- Use Cursor's AI chat to ask questions about the extension code
- Leverage Cursor's codebase understanding to enhance the extension
- Combine this extension's profiling with Cursor's AI for comprehensive code optimization

