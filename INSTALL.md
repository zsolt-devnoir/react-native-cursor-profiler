# Installing the RN Profiler AI Extension

## Quick Start (Development Mode)

1. **Open the extension project** in VS Code or Cursor
2. **Press `F5`** (or Run > Start Debugging)
3. A new "Extension Development Host" window will open
4. **Open your React Native project** in that new window
5. The extension is now active!

## Permanent Installation

### Option 1: Install from Local Folder

1. **Package the extension**:

   ```bash
   npm install -g vsce
   vsce package
   ```

   This creates a `.vsix` file.

2. **Install the extension**:
   - Open VS Code/Cursor
   - Press `Ctrl+Shift+X` (or `Cmd+Shift+X` on Mac) to open Extensions
   - Click the `...` menu (top right)
   - Select "Install from VSIX..."
   - Choose the `.vsix` file you just created

### Option 2: Install from Command Line

```bash
# Install vsce globally (if not already installed)
npm install -g vsce

# Package the extension
vsce package

# Install the .vsix file
code --install-extension rn-profiler-ai-0.1.0.vsix
# Or for Cursor:
cursor --install-extension rn-profiler-ai-0.1.0.vsix
```

## Verify Installation

1. Open Command Palette: `Ctrl+Shift+P` (or `Cmd+Shift+P`)
2. Type "RN Profiler AI"
3. You should see these commands:
   - `RN Profiler AI: Show Profiler Panel`
   - `RN Profiler AI: Start Recording`
   - `RN Profiler AI: Stop Recording`
   - `RN Profiler AI: Analyze Logs`

## Next Steps

1. **Configure your API key** in Settings
2. **Set up your React Native app** (see README.md)
3. **Start profiling!**

## Troubleshooting

### Extension Not Appearing

- Make sure you compiled the extension: `npm run compile`
- Check that the `out/` folder exists with compiled JavaScript files
- Reload the window: `Ctrl+R` (or `Cmd+R`)

### Commands Not Working

- Check the Output panel: View > Output > Select "RN Profiler AI"
- Look for error messages
- Make sure you're in a React Native project workspace
