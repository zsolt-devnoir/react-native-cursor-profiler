# React Native Integration Examples

This directory contains example files for integrating the RN Profiler AI extension with your React Native application.

## Files

- **`withProfiler.tsx`** - Higher-Order Component for wrapping React Native components with profiling
- **`rn-profiler-config.ts`** - Configuration file that the extension manages

## Setup Instructions

1. Copy `withProfiler.tsx` to your React Native project (e.g., `src/utils/withProfiler.tsx`)
2. Copy `rn-profiler-config.ts` to `src/rn-profiler-config.ts` in your React Native project
3. Update the import path in `withProfiler.tsx` to match your project structure
4. Install `axios` in your React Native project: `npm install axios`
5. Wrap your components with `withProfiler` as shown in the main README

## Android Emulator Note

If you're using an Android emulator, you'll need to change the server URL in `withProfiler.tsx`:

```typescript
const PROFILER_SERVER_URL = __DEV__ 
    ? 'http://10.0.2.2:1337/profile-data' // Use 10.0.2.2 for Android emulator
    : null;
```

The Android emulator uses `10.0.2.2` to refer to the host machine's `localhost`.

## iOS Simulator

The iOS simulator can use `localhost` directly, so no changes are needed.

## Physical Devices

For physical devices, you'll need to use your computer's local IP address:

```typescript
const PROFILER_SERVER_URL = __DEV__ 
    ? 'http://192.168.1.XXX:1337/profile-data' // Replace with your computer's IP
    : null;
```

Find your IP address:
- **Windows**: Run `ipconfig` and look for IPv4 Address
- **macOS/Linux**: Run `ifconfig` or `ip addr` and look for your network interface

