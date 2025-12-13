/**
 * Higher-Order Component (HOC) for React Native Performance Profiling
 * 
 * This HOC wraps React Native components with React.Profiler to capture
 * performance metrics and send them to the VS Code extension's local server.
 * 
 * Usage:
 *   import { withProfiler } from './withProfiler';
 *   export default withProfiler(MyComponent);
 * 
 * Or wrap multiple components:
 *   export const ProfiledComponent = withProfiler(MyComponent);
 */

import React, { ProfilerOnRenderCallback } from 'react';
import { Platform } from 'react-native';
import axios from 'axios';
import { PROFILING_ENABLED, COMPONENTS_TO_PROFILE } from '../src/rn-profiler-config';

// Configuration for the VS Code extension server
const PROFILER_SERVER_URL = __DEV__ 
    ? 'http://localhost:1337/profile-data' // Change this port if your extension uses a different port
    : null; // Disable in production builds

/**
 * Profile log data structure sent to VS Code extension
 */
interface ProfileLog {
    id: string;
    phase: 'mount' | 'update' | 'force-update';
    actualDuration: number;
    baseDuration: number;
    startTime: number;
    commitTime: number;
    timestamp: string;
    deviceInfo: {
        os: string;
        version: string;
        model?: string;
    };
    interactions?: string[];
}

/**
 * Creates the onRender callback for React.Profiler
 */
function createOnRenderCallback(componentName: string): ProfilerOnRenderCallback {
    return (
        id: string,
        phase: 'mount' | 'update',
        actualDuration: number,
        baseDuration: number,
        startTime: number,
        commitTime: number
    ) => {
        // Only send data if profiling is enabled and this component is in the list
        if (!PROFILING_ENABLED || !PROFILER_SERVER_URL) {
            return;
        }

        if (COMPONENTS_TO_PROFILE.length > 0 && !COMPONENTS_TO_PROFILE.includes(componentName)) {
            return;
        }

        // Prepare the profile log
        const profileLog: ProfileLog = {
            id: componentName,
            phase,
            actualDuration,
            baseDuration,
            startTime,
            commitTime,
            timestamp: new Date().toISOString(),
            deviceInfo: {
                os: Platform.OS,
                version: Platform.Version.toString(),
                model: Platform.select({
                    ios: undefined, // Platform doesn't provide model on iOS easily
                    android: undefined, // Would need DeviceInfo module
                }),
            },
        };

        // Send to VS Code extension server (fire and forget)
        axios
            .post(PROFILER_SERVER_URL, profileLog, {
                timeout: 1000, // Short timeout to avoid blocking
            })
            .catch((error) => {
                // Silently fail - we don't want profiling to break the app
                if (__DEV__) {
                    console.warn(`[Profiler] Failed to send profile data for ${componentName}:`, error.message);
                }
            });
    };
}

/**
 * Higher-Order Component that wraps a component with React.Profiler
 * 
 * @param Component - The React component to profile
 * @param componentName - Optional custom name for the component (defaults to Component.displayName or Component.name)
 * @returns The wrapped component with profiling enabled
 */
export function withProfiler<P extends object>(
    Component: React.ComponentType<P>,
    componentName?: string
): React.ComponentType<P> {
    const name = componentName || Component.displayName || Component.name || 'UnknownComponent';

    const ProfiledComponent = React.forwardRef<any, P>((props, ref) => {
        return (
            <React.Profiler id={name} onRender={createOnRenderCallback(name)}>
                <Component {...props} ref={ref} />
            </React.Profiler>
        );
    });

    ProfiledComponent.displayName = `withProfiler(${name})`;

    return ProfiledComponent as React.ComponentType<P>;
}

/**
 * Alternative: Hook-based profiler wrapper for functional components
 * 
 * Usage:
 *   function MyComponent() {
 *     useProfiler('MyComponent');
 *     return <View>...</View>;
 *   }
 */
export function useProfiler(componentName: string) {
    React.useEffect(() => {
        if (!PROFILING_ENABLED || !PROFILER_SERVER_URL) {
            return;
        }

        if (COMPONENTS_TO_PROFILE.length > 0 && !COMPONENTS_TO_PROFILE.includes(componentName)) {
            return;
        }

        const mountTime = performance.now();
        
        return () => {
            const unmountTime = performance.now();
            const duration = unmountTime - mountTime;

            const profileLog: ProfileLog = {
                id: componentName,
                phase: 'mount',
                actualDuration: duration,
                baseDuration: duration,
                startTime: mountTime,
                commitTime: unmountTime,
                timestamp: new Date().toISOString(),
                deviceInfo: {
                    os: Platform.OS,
                    version: Platform.Version.toString(),
                },
            };

            axios
                .post(PROFILER_SERVER_URL, profileLog, { timeout: 1000 })
                .catch(() => {
                    // Silently fail
                });
        };
    }, [componentName]);
}

