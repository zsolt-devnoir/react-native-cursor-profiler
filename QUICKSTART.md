# Quick Start Guide

Get up and running with RN Profiler AI in 5 minutes!

## Step 1: Install Dependencies

In your React Native project:

```bash
npm install axios
# or
yarn add axios
```

## Step 2: Add Files to Your React Native Project

1. Copy `examples/rn-profiler-config.ts` to `src/rn-profiler-config.ts`
2. Copy `examples/withProfiler.tsx` to `src/utils/withProfiler.tsx` (or wherever you keep utilities)

3. **Important**: Update the import in `withProfiler.tsx`:

```typescript
// Change this line to match your project structure:
import { PROFILING_ENABLED, COMPONENTS_TO_PROFILE } from '../rn-profiler-config';
//                                                      ^^^ adjust path as needed
```

4. **For Android Emulator**: Update the server URL in `withProfiler.tsx`:

```typescript
const PROFILER_SERVER_URL = __DEV__ 
    ? 'http://10.0.2.2:1337/profile-data' // Use 10.0.2.2 for Android emulator
    : null;
```

## Step 3: Wrap Your Components

In any component file you want to profile:

```typescript
import { withProfiler } from './utils/withProfiler';
import MyComponent from './MyComponent';

// Export the wrapped component
export default withProfiler(MyComponent);
```

## Step 4: Configure VS Code Extension

1. Open VS Code Settings (`Ctrl+,` or `Cmd+,`)
2. Search for "RN Profiler AI"
3. Set your API key:
   - `rnProfilerAI.apiKey`: Your OpenAI or Anthropic API key
   - `rnProfilerAI.apiProvider`: Choose `"openai"` or `"anthropic"`

## Step 5: Use the Extension

1. **Open the Profiler Panel**:
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
   - Type "RN Profiler AI: Show Profiler Panel"
   - Press Enter

2. **Select Components**:
   - Browse the component tree
   - Click components to select them for profiling

3. **Start Recording**:
   - Click "Start Recording"
   - **Important**: Restart Metro Bundler if the config doesn't update automatically

4. **Use Your App**:
   - Interact with your React Native app
   - Watch logs appear in real-time

5. **Stop Recording**:
   - Click "Stop Recording"
   - View collected logs

6. **Analyze**:
   - Click "Analyze Logs" (or wait for auto-analysis)
   - Read AI-generated performance recommendations

## Troubleshooting

### No Components Showing

- Make sure your components are in `.tsx`, `.jsx`, `.ts`, or `.js` files
- Components must be exported (e.g., `export function MyComponent`)
- Check that your project has a `src` directory

### No Logs Appearing

1. Check `src/rn-profiler-config.ts` - `PROFILING_ENABLED` should be `true`
2. Verify your component is in `COMPONENTS_TO_PROFILE` array
3. Restart Metro Bundler
4. For Android emulator, use `10.0.2.2` instead of `localhost`
5. Check VS Code Output panel for errors

### AI Analysis Not Working

1. Verify API key is set in VS Code settings
2. Check you have API credits/quota
3. Look at VS Code Output panel for error messages

## Next Steps

- Read the full [README.md](README.md) for detailed documentation
- Check [examples/README.md](examples/README.md) for integration details
- Review the [CHANGELOG.md](CHANGELOG.md) for updates

Happy profiling! 🚀

