# Debugging: No Logs Appearing

## Quick Checklist

### 1. ✅ Components Must Be Wrapped

**CRITICAL**: You MUST wrap your components with `withProfiler` HOC:

```typescript
// ❌ This won't work:
export default function MyComponent() { ... }

// ✅ This will work:
import { withProfiler } from './utils/withProfiler';
function MyComponent() { ... }
export default withProfiler(MyComponent);
```

### 2. ✅ Config File Location & Content

Check `apps/mobile/src/rn-profiler-config.ts`:
```typescript
export const PROFILING_ENABLED: boolean = true;  // Must be true!
export const COMPONENTS_TO_PROFILE: string[] = ['MyComponent', 'AnotherComponent'];
```

### 3. ✅ Server URL for Expo

**For Expo (especially Android emulator), localhost doesn't work!**

Update `withProfiler.tsx`:

**iOS Simulator:**
```typescript
const PROFILER_SERVER_URL = __DEV__ 
    ? 'http://localhost:1337/profile-data'
    : null;
```

**Android Emulator:**
```typescript
const PROFILER_SERVER_URL = __DEV__ 
    ? 'http://10.0.2.2:1337/profile-data'  // Android emulator uses 10.0.2.2 for host
    : null;
```

**Physical Device / Expo Go:**
You need your computer's local IP address:
```typescript
const PROFILER_SERVER_URL = __DEV__ 
    ? 'http://192.168.1.XXX:1337/profile-data'  // Replace XXX with your computer's IP
    : null;
```

Find your IP:
- **Windows**: Run `ipconfig` → Look for IPv4 Address
- **macOS/Linux**: Run `ifconfig` → Look for inet address

### 4. ✅ Metro Bundler Restart

After changing config file:
1. Stop Metro Bundler
2. Clear cache: `npx expo start -c` or `npm start -- --reset-cache`
3. Restart Metro
4. Reload app

### 5. ✅ Component Names Must Match

Component names in `COMPONENTS_TO_PROFILE` must match:
- The component name you wrapped (if you passed a name to `withProfiler`)
- Or the component's `displayName` or `name` property

```typescript
// Option 1: Use component's name
export default withProfiler(MyComponent);
// Name will be "MyComponent"

// Option 2: Specify custom name
export default withProfiler(MyComponent, 'CustomName');
// Name will be "CustomName" - must match COMPONENTS_TO_PROFILE
```

### 6. ✅ Check Browser Console

In your Expo app, open the developer menu and check console logs:
- Look for: `[Profiler] Failed to send profile data...`
- This tells you if there's a network error

### 7. ✅ Verify Server is Running

Check the Extension panel - the status indicator should be red (recording).
Or check: `http://localhost:1337/health` in your browser

### 8. ✅ Test with Simple Component

Create a test component to verify setup:

```typescript
// TestComponent.tsx
import React from 'react';
import { View, Button } from 'react-native';
import { withProfiler } from './utils/withProfiler';

function TestComponent() {
  const [count, setCount] = React.useState(0);
  
  return (
    <View>
      <Button 
        title={`Count: ${count}`} 
        onPress={() => setCount(c => c + 1)} 
      />
    </View>
  );
}

export default withProfiler(TestComponent, 'TestComponent');
```

Then in config:
```typescript
export const COMPONENTS_TO_PROFILE: string[] = ['TestComponent'];
```

Click the button multiple times - you should see logs!

## Common Issues

### Issue: "Network request failed"
- **Solution**: Use correct server URL (10.0.2.2 for Android, local IP for physical device)

### Issue: "0 logs collected"
- **Solution**: Components not wrapped OR names don't match OR PROFILING_ENABLED is false

### Issue: "Config not updating"
- **Solution**: Restart Metro Bundler after extension updates config

