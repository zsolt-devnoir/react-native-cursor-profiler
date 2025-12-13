# React Native Profiler AI

A VS Code extension that integrates with React Native applications to capture performance profiling data and leverage AI for bottleneck analysis.

## Features

- 🎯 **Component Selection**: Interactive treeview to select which components to profile
- 📊 **Real-time Profiling**: Live display of profiling data as it's collected
- 🤖 **AI-Powered Analysis**: Automatic performance bottleneck detection using OpenAI or Anthropic
- 🔍 **Source Code Context**: AI analysis includes relevant code snippets for better insights
- ⚡ **Easy Integration**: Simple HOC wrapper for React Native components

## Installation

### For VS Code

1. Clone or download this extension
2. Open the project in VS Code
3. Run `npm install` to install dependencies
4. Press `F5` to launch a new Extension Development Host window
5. In the new window, open your React Native project

### For Cursor

✅ **Fully Compatible**: This extension works seamlessly in Cursor (the AI-powered editor). See [CURSOR.md](CURSOR.md) for Cursor-specific setup and tips.

## Configuration

### 1. Set Your AI API Key

1. Open VS Code Settings (File > Preferences > Settings)
2. Search for "RN Profiler AI"
3. Set `rnProfilerAI.apiKey` to your OpenAI, Anthropic, or Cursor API key
4. Set `rnProfilerAI.apiProvider` to either `"openai"`, `"anthropic"`, or `"cursor"`
   - **Note**: When using `"cursor"`, use your Anthropic API key (since Cursor uses Claude models)

### 2. Integrate with Your React Native App

#### Step 1: Install Dependencies

In your React Native project, install `axios`:

```bash
npm install axios
# or
yarn add axios
```

#### Step 2: Add Configuration File

Create `src/rn-profiler-config.ts` in your React Native project:

```typescript
export const PROFILING_ENABLED: boolean = false;
export const COMPONENTS_TO_PROFILE: string[] = [];
```

This file will be automatically managed by the extension, but you need to create it initially.

#### Step 3: Add the Profiler HOC

Copy `examples/withProfiler.tsx` to your React Native project (e.g., `src/utils/withProfiler.tsx`).

**Important**: Update the import path in `withProfiler.tsx`:

```typescript
import {
  PROFILING_ENABLED,
  COMPONENTS_TO_PROFILE,
} from "../src/rn-profiler-config";
```

Also, update the server URL if you're using a different port:

```typescript
const PROFILER_SERVER_URL = __DEV__
  ? "http://localhost:1337/profile-data" // Change port if needed
  : null;
```

#### Step 4: Wrap Your Components

Wrap components you want to profile with the `withProfiler` HOC:

```typescript
import { withProfiler } from "./utils/withProfiler";
import MyComponent from "./MyComponent";

// Option 1: Export wrapped component
export default withProfiler(MyComponent);

// Option 2: Named export
export const ProfiledMyComponent = withProfiler(MyComponent, "MyComponent");
```

Or use the hook for functional components:

```typescript
import { useProfiler } from "./utils/withProfiler";

function MyComponent() {
  useProfiler("MyComponent");
  // ... component code
}
```

## Usage

### 1. Open the Profiler Panel

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run `RN Profiler AI: Show Profiler Panel`

### 2. Select Components to Profile

- Browse the component tree in the panel
- Click on components to select/deselect them for profiling
- Selected components will be highlighted

### 3. Start Recording

1. Click "Start Recording" in the Profiler Panel
2. The extension will:
   - Start a local HTTP server (default port 1337)
   - Update `PROFILING_ENABLED = true` in your RN config
   - Begin accepting profiling data

**Note**: You may need to restart Metro Bundler for the config changes to take effect.

### 4. Interact with Your App

- Use your React Native app normally
- The extension will collect profiling data in real-time
- View live logs in the "Live Logs" section

### 5. Stop Recording

1. Click "Stop Recording"
2. The extension will:
   - Stop the HTTP server
   - Update `PROFILING_ENABLED = false`
   - Display collected logs

### 6. Analyze Logs

1. Click "Analyze Logs" (or it will auto-analyze if enabled)
2. The extension will:
   - Identify bottleneck components
   - Read source code for context
   - Send data to AI for analysis
   - Display results in the "AI Analysis" section

## Commands

- `RN Profiler AI: Show Profiler Panel` - Opens the main profiler UI
- `RN Profiler AI: Start Recording` - Starts profiling session
- `RN Profiler AI: Stop Recording` - Stops profiling session
- `RN Profiler AI: Analyze Logs` - Triggers AI analysis

## Settings

- `rnProfilerAI.apiKey` - Your OpenAI, Anthropic, or Cursor API key
- `rnProfilerAI.apiProvider` - `"openai"`, `"anthropic"`, or `"cursor"` (default: `"openai"`)
  - **Using Cursor**: Set to `"cursor"` and use your Anthropic API key (Cursor uses Claude models)
- `rnProfilerAI.serverPort` - Local server port (default: 1337)
- `rnProfilerAI.autoAnalyze` - Auto-analyze after stopping (default: true)

## Troubleshooting

### "Port already in use" Error

If port 1337 is already in use:

1. Change `rnProfilerAI.serverPort` in settings
2. Update the port in `withProfiler.tsx` to match

### No Logs Appearing

1. Check that `PROFILING_ENABLED` is `true` in `rn-profiler-config.ts`
2. Verify components are in `COMPONENTS_TO_PROFILE` array
3. Restart Metro Bundler
4. Check that your device/emulator can reach `localhost:1337`
   - For Android emulator, use `10.0.2.2:1337` instead of `localhost:1337`
   - For iOS simulator, `localhost` should work

### AI Analysis Fails

1. Verify your API key is set correctly
2. Check your API provider setting
3. Ensure you have API credits/quota
4. Check the VS Code Output panel for error messages

### Components Not Showing in Tree

1. Ensure your components are in `.tsx`, `.jsx`, `.ts`, or `.js` files
2. Components must be exported (e.g., `export function MyComponent`)
3. Check that your project has a `src` directory or components in the root

## Development

### Building

```bash
npm run compile
```

### Watching

```bash
npm run watch
```

### Testing

1. Press `F5` in VS Code to launch Extension Development Host
2. Open your React Native project in the new window
3. Test the extension functionality

## Project Structure

```
.
├── src/
│   ├── extension.ts          # Main extension entry point
│   ├── profilerPanel.ts      # WebView panel management
│   ├── profilerServer.ts     # Local HTTP server
│   ├── componentTreeProvider.ts # Component tree scanning
│   ├── aiAnalyzer.ts         # AI analysis logic
│   └── types.ts              # TypeScript type definitions
├── examples/
│   ├── withProfiler.tsx     # React Native HOC example
│   └── rn-profiler-config.ts # RN config file example
├── package.json
├── tsconfig.json
└── README.md
```

## Security Notes

- API keys are stored securely in VS Code settings (not in code)
- Profiling only works in development mode (`__DEV__`)
- No data is sent to external servers except your chosen AI provider
- All profiling data stays local until you explicitly analyze

## License

MIT

## Contributing

Contributions welcome! Please open issues or pull requests.
