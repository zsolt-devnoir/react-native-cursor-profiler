# React Native Profiler AI Extension - Technical Description

## Overview

The **React Native Profiler AI** is a VS Code extension that provides performance profiling capabilities for React Native applications with AI-powered analysis. It integrates directly into the VS Code editor (and Cursor) to help developers identify and optimize performance bottlenecks in their React Native components.

## Architecture

The extension follows a client-server architecture with the following key components:

### 1. **Extension Core** (`extension.ts`)

The main entry point that:

- Activates when VS Code starts
- Registers commands and manages the extension lifecycle
- Coordinates between all components
- Handles React Native project detection (supports monorepos)
- Manages the configuration file (`rn-profiler-config.ts`) that controls profiling state

### 2. **Profiler Panel** (`profilerPanel.ts`)

A WebView-based UI panel that provides:

- **Component Tree View**: Interactive tree showing all React Native components in the project
- **Profiling Controls**: Start/Stop recording buttons
- **Live Logs Display**: Real-time view of profiling data as it's collected
- **AI Analysis Output**: Formatted display of AI-generated performance insights
- **Component Selection**: Click-to-select components for profiling

The panel communicates with the extension via `postMessage` API and maintains state for selected components and collected logs.

### 3. **Profiler Server** (`profilerServer.ts`)

A local Express.js HTTP server that:

- Runs on a configurable port (default: 1337)
- Receives profiling data via POST requests from the React Native app
- Validates incoming profile logs
- Stores logs in memory
- Provides CORS headers for cross-origin requests from mobile devices/emulators
- Exposes a health check endpoint

### 4. **Component Tree Provider** (`componentTreeProvider.ts`)

Scans the React Native project to:

- Find React Native project directory (supports monorepos with common paths like `apps/mobile`, `packages/mobile`, etc.)
- Recursively scan `src` directory (or project root) for component files
- Extract component names from TypeScript/JavaScript files using regex patterns
- Build a hierarchical tree structure of components
- Provide source code content for AI analysis

### 5. **AI Analyzer** (`aiAnalyzer.ts`)

Performs intelligent analysis of profiling data:

- **Bottleneck Identification**: Analyzes logs to find components with:
  - High maximum render durations
  - High average render durations
  - Frequent renders with durations significantly higher than base duration
  - Uses a scoring algorithm to rank bottlenecks
- **Code Context Gathering**: Retrieves source code for bottleneck components
- **AI Integration**: Supports multiple AI providers:
  - OpenAI (GPT-4 Turbo)
  - Anthropic (Claude 3 Opus)
  - Cursor (uses Anthropic API under the hood)
- **Prompt Engineering**: Constructs detailed prompts with:
  - Log summaries and statistics
  - Identified bottlenecks
  - Source code snippets
  - Structured output format requirements

### 6. **Component Wrapper** (`componentWrapper.ts`)

Automatically modifies source code using **AST (Abstract Syntax Tree) transformation**:

- **Robust Code Parsing**: Uses Babel parser to convert source code into an AST, understanding code structure rather than just text patterns
- **Intelligent Component Detection**: Identifies React components by analyzing AST nodes (function declarations, arrow functions, class declarations)
- **Context-Aware Transformation**: Wraps components with `withProfiler` HOC while preserving:
  - Original code formatting and comments
  - Existing HOCs (React.memo, forwardRef, etc.)
  - Import statements and their order
- **Handles Multiple Patterns**:
  - `export default function ComponentName() {}`
  - `export default const ComponentName = () => {}`
  - `export const ComponentName = () => {}`
  - `export function ComponentName() {}`
  - `export default ComponentName` (identifier reference)
  - Components wrapped in React.memo, forwardRef, etc.
- **Smart Import Management**: Automatically adds `withProfiler` import if not present, maintaining proper import order
- **Duplicate Prevention**: Detects if components are already wrapped to avoid double-wrapping
- **Error Handling**: Gracefully handles parsing errors and edge cases without breaking the extension

## How It Works

### Setup Flow

1. **Extension Activation**

   - Extension activates on VS Code startup
   - Scans workspace for React Native project (checks `package.json` for `react-native` dependency)
   - Supports monorepo structures by checking common paths

2. **Component Discovery**

   - When the Profiler Panel is opened, `ComponentTreeProvider` scans the project
   - Recursively searches for `.tsx`, `.jsx`, `.ts`, `.js` files
   - Extracts component names using regex patterns:
     - `export function ComponentName`
     - `export const ComponentName`
     - `export class ComponentName`
   - Builds a tree structure displayed in the panel

3. **Component Selection**
   - User clicks components in the tree to select/deselect them
   - Selected components are stored in the panel's state
   - Selection updates the `COMPONENTS_TO_PROFILE` array in `rn-profiler-config.ts`

### Profiling Flow

1. **Start Recording**

   - User clicks "Start Recording" in the Profiler Panel
   - Extension starts the Express.js server on the configured port
   - Updates `PROFILING_ENABLED = true` in `rn-profiler-config.ts`
   - Updates `COMPONENTS_TO_PROFILE` with selected components
   - Panel shows recording status indicator

2. **Data Collection**

   - React Native app reads `PROFILING_ENABLED` and `COMPONENTS_TO_PROFILE` from config
   - Components wrapped with `withProfiler` HOC use React's `Profiler` API
   - On each render, the `onRender` callback:
     - Checks if profiling is enabled
     - Checks if component is in the profile list
     - Creates a `ProfileLog` object with:
       - Component ID (name)
       - Phase (mount/update/force-update)
       - `actualDuration` (time spent rendering)
       - `baseDuration` (estimated time without memoization)
       - Timestamps
       - Device info (OS, version)
     - Sends POST request to `http://localhost:1337/profile-data` (or configured port)
   - Extension server receives and validates logs
   - Logs are stored in memory

3. **Real-time Display**

   - Panel polls the server every second for new logs
   - Logs are displayed in the "Live Logs" section
   - Each log entry shows: component name, phase, duration, timestamp

4. **Stop Recording**
   - User clicks "Stop Recording"
   - Server stops accepting new requests
   - Server is shut down
   - `PROFILING_ENABLED` is set to `false`
   - All collected logs are stored in the panel
   - If `autoAnalyze` is enabled, analysis starts automatically

### Analysis Flow

1. **Bottleneck Identification**

   - `AIAnalyzer.identifyBottlenecks()` processes all logs:
     - Groups logs by component ID
     - Calculates statistics: total duration, max duration, average duration, count
     - Identifies renders where `actualDuration > baseDuration * 1.5`
     - Scores components using weighted formula:
       ```
       score = maxDuration * 0.4 + avgDuration * 0.3 + highDurationCount * 0.3
       ```
     - Returns top 10 bottleneck components

2. **Code Context Gathering**

   - For each bottleneck component, retrieves source code
   - Truncates code to 2000 characters to stay within token limits
   - Creates a map of component ID → source code

3. **AI Prompt Construction**

   - Builds a comprehensive prompt including:
     - Instructions for React Native performance analysis
     - Log summary (total logs, unique components, averages, phase distribution)
     - List of bottleneck components
     - Source code snippets for bottlenecks
     - Raw log samples (first 50 logs)
     - Output format requirements (Markdown with specific sections)

4. **AI API Call**

   - Based on configured provider:
     - **OpenAI**: Calls `https://api.openai.com/v1/chat/completions` with GPT-4 Turbo
     - **Anthropic**: Calls `https://api.anthropic.com/v1/messages` with Claude 3 Opus
     - **Cursor**: Uses Anthropic API (since Cursor uses Claude models)
   - Sends system message + user prompt
   - Receives analysis response

5. **Result Display**
   - Analysis is displayed in the "AI Analysis" section
   - Markdown is rendered with:
     - Headers (h1, h2, h3)
     - Code blocks
     - Inline code
     - Links (file links can open files in VS Code)

## React Native Integration

### withProfiler HOC

The extension provides a Higher-Order Component (`withProfiler`) that must be integrated into the React Native app:

```typescript
import { withProfiler } from "./utils/withProfiler";
export default withProfiler(MyComponent);
```

**How it works:**

- Wraps component with React's `<Profiler>` component
- Creates an `onRender` callback that:
  - Checks `PROFILING_ENABLED` flag
  - Checks if component is in `COMPONENTS_TO_PROFILE` array
  - Creates profile log with render metrics
  - Sends HTTP POST to extension server (fire-and-forget)
  - Handles errors silently to avoid breaking the app

### Configuration File

The extension manages `src/rn-profiler-config.ts`:

```typescript
export const PROFILING_ENABLED: boolean = false;
export const COMPONENTS_TO_PROFILE: string[] = [];
```

- Auto-generated and updated by the extension
- Changes require Metro Bundler restart to take effect
- Profiling only works in `__DEV__` mode (production builds ignore it)

### Component Wrapping

The extension can automatically wrap components using **AST transformation**:

1. **User Action**: User selects components in the tree and clicks "Wrap Components" button

2. **AST Parsing**:

   - Extension uses Babel parser to convert source code into an Abstract Syntax Tree
   - Supports TypeScript, JSX, and modern JavaScript features
   - Understands code structure, not just text patterns

3. **AST Traversal**:

   - Walks the AST to find component declarations
   - Identifies export patterns (default, named, class, function, arrow function)
   - Detects if components are already wrapped to prevent duplicates
   - Recognizes components wrapped in React.memo, forwardRef, etc.

4. **AST Transformation**:

   - Wraps component declarations with `withProfiler(ComponentName, 'ComponentName')`
   - Preserves original code structure and formatting
   - Maintains comments and code style
   - Handles complex patterns like:
     - `export default function MyComponent() {}` → `export default withProfiler(MyComponent, 'MyComponent')`
     - `export const MyComponent = () => {}` → `export const MyComponent = withProfiler(() => {}, 'MyComponent')`
     - `export default MyComponent` → `export default withProfiler(MyComponent, 'MyComponent')`

5. **Import Management**:

   - Checks if `withProfiler` is already imported
   - Calculates correct relative path to `withProfiler` utility
   - Inserts import statement in the appropriate location (after other imports)

6. **Code Generation**:
   - Uses Babel generator to convert modified AST back to source code
   - Preserves formatting and comments
   - Writes transformed code back to file

**Why AST Transformation?**

- **Reliability**: Understands code structure, not just text patterns
- **Context-Aware**: Handles scope, imports, and complex patterns correctly
- **Preserves Code**: Maintains formatting, comments, and code style
- **Robust**: Handles edge cases that regex cannot (nested HOCs, complex exports, etc.)

## Data Flow Diagram

```
React Native App
    │
    │ (reads config)
    ├─> rn-profiler-config.ts
    │
    │ (wrapped components)
    ├─> withProfiler HOC
    │   └─> React.Profiler.onRender
    │       └─> Creates ProfileLog
    │           └─> HTTP POST
    │
    └─────────────────────────────────┐
                                        │
                                        ▼
                            ProfilerServer (Express)
                            Port: 1337 (configurable)
                                        │
                                        │ (stores logs)
                                        ▼
                            Extension (VS Code)
                                        │
                                        ├─> ProfilerPanel (WebView)
                                        │   ├─> Component Tree
                                        │   ├─> Live Logs
                                        │   └─> AI Analysis
                                        │
                                        └─> AIAnalyzer
                                            ├─> Identifies Bottlenecks
                                            ├─> Gets Source Code
                                            └─> Calls AI API
                                                └─> Returns Analysis
```

## Key Features

### 1. **Monorepo Support**

- Automatically detects React Native projects in monorepos
- Checks common paths: `apps/mobile`, `packages/mobile`, `mobile`, `app`
- Handles relative paths correctly for component scanning

### 2. **Real-time Profiling**

- Live updates of profiling data (1-second polling)
- Visual status indicator (pulsing red dot when recording)
- No need to wait for recording to finish to see data

### 3. **Selective Profiling**

- Only profile selected components
- Reduces noise and focuses on specific areas
- Easy to add/remove components from profiling

### 4. **AI-Powered Analysis**

- Intelligent bottleneck detection using statistical analysis
- Context-aware analysis with source code
- Actionable recommendations with code examples
- Supports multiple AI providers

### 5. **Developer Experience**

- One-click component wrapping
- Automatic config file management
- Integrated into VS Code UI
- No external tools required

## Configuration

### VS Code Settings

- `rnProfilerAI.apiKey`: API key for AI provider (stored securely)
- `rnProfilerAI.apiProvider`: `"openai"`, `"anthropic"`, or `"cursor"`
- `rnProfilerAI.serverPort`: HTTP server port (default: 1337)
- `rnProfilerAI.autoAnalyze`: Auto-analyze after stopping (default: true)

### React Native Configuration

- `PROFILER_SERVER_URL`: Server URL in `withProfiler.tsx` (default: `http://localhost:1337/profile-data`)
  - For Android emulator: Use `10.0.2.2:1337` instead of `localhost:1337`
  - For iOS simulator: `localhost` works fine

## Security & Privacy

- API keys stored in VS Code settings (encrypted at rest)
- Profiling only works in development mode (`__DEV__`)
- No data sent to external servers except chosen AI provider
- All profiling data stays local until explicit analysis
- Server only accepts local connections

## Limitations & Considerations

1. **Metro Bundler Restart**: Config changes require Metro restart
2. **Network Access**: React Native app must be able to reach `localhost:1337` (or configured port)
3. **Performance Overhead**: Profiling adds minimal overhead, but should only be used in development
4. **Token Limits**: Large source files are truncated to 2000 characters for AI analysis
5. **Component Discovery**: Component tree scanning uses regex patterns for initial detection (may miss some patterns)
6. **Component Wrapping**: Uses AST transformation (Babel) for reliable code modification, but complex edge cases may require manual wrapping
7. **Android Emulator**: Requires special IP address (`10.0.2.2`) instead of `localhost`
8. **Extension Size**: Babel dependencies add to extension bundle size (~2-3MB)

## Technical Stack

- **Extension**: TypeScript, VS Code Extension API
- **Server**: Express.js, Node.js
- **Code Transformation**: Babel (@babel/parser, @babel/traverse, @babel/generator, @babel/types) for AST-based component wrapping
- **React Native**: React Profiler API, axios
- **AI**: OpenAI API, Anthropic API
- **UI**: WebView with vanilla JavaScript, VS Code CSS variables for theming

## Future Enhancements (Potential)

- Support for React DevTools Profiler integration
- Historical profiling data storage
- Performance regression detection
- Custom profiling metrics
- Export/import profiling sessions
- Integration with CI/CD pipelines
- Support for React Native Web profiling
