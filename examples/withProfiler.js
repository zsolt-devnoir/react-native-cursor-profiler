"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.useProfiler = exports.withProfiler = void 0;
const react_1 = __importDefault(require("react"));
const react_native_1 = require("react-native");
const axios_1 = __importDefault(require("axios"));
const rn_profiler_config_1 = require("../src/rn-profiler-config");
// Configuration for the VS Code extension server
const PROFILER_SERVER_URL = __DEV__
    ? 'http://localhost:1337/profile-data' // Change this port if your extension uses a different port
    : null; // Disable in production builds
/**
 * Creates the onRender callback for React.Profiler
 */
function createOnRenderCallback(componentName) {
    return (id, phase, actualDuration, baseDuration, startTime, commitTime) => {
        // Only send data if profiling is enabled and this component is in the list
        if (!rn_profiler_config_1.PROFILING_ENABLED || !PROFILER_SERVER_URL) {
            return;
        }
        if (rn_profiler_config_1.COMPONENTS_TO_PROFILE.length > 0 && !rn_profiler_config_1.COMPONENTS_TO_PROFILE.includes(componentName)) {
            return;
        }
        // Prepare the profile log
        const profileLog = {
            id: componentName,
            phase,
            actualDuration,
            baseDuration,
            startTime,
            commitTime,
            timestamp: new Date().toISOString(),
            deviceInfo: {
                os: react_native_1.Platform.OS,
                version: react_native_1.Platform.Version.toString(),
                model: react_native_1.Platform.select({
                    ios: undefined,
                    android: undefined, // Would need DeviceInfo module
                }),
            },
        };
        // Send to VS Code extension server (fire and forget)
        axios_1.default
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
function withProfiler(Component, componentName) {
    const name = componentName || Component.displayName || Component.name || 'UnknownComponent';
    const ProfiledComponent = react_1.default.forwardRef((props, ref) => {
        return (<react_1.default.Profiler id={name} onRender={createOnRenderCallback(name)}>
                <Component {...props} ref={ref}/>
            </react_1.default.Profiler>);
    });
    ProfiledComponent.displayName = `withProfiler(${name})`;
    return ProfiledComponent;
}
exports.withProfiler = withProfiler;
/**
 * Alternative: Hook-based profiler wrapper for functional components
 *
 * Usage:
 *   function MyComponent() {
 *     useProfiler('MyComponent');
 *     return <View>...</View>;
 *   }
 */
function useProfiler(componentName) {
    react_1.default.useEffect(() => {
        if (!rn_profiler_config_1.PROFILING_ENABLED || !PROFILER_SERVER_URL) {
            return;
        }
        if (rn_profiler_config_1.COMPONENTS_TO_PROFILE.length > 0 && !rn_profiler_config_1.COMPONENTS_TO_PROFILE.includes(componentName)) {
            return;
        }
        const mountTime = performance.now();
        return () => {
            const unmountTime = performance.now();
            const duration = unmountTime - mountTime;
            const profileLog = {
                id: componentName,
                phase: 'mount',
                actualDuration: duration,
                baseDuration: duration,
                startTime: mountTime,
                commitTime: unmountTime,
                timestamp: new Date().toISOString(),
                deviceInfo: {
                    os: react_native_1.Platform.OS,
                    version: react_native_1.Platform.Version.toString(),
                },
            };
            axios_1.default
                .post(PROFILER_SERVER_URL, profileLog, { timeout: 1000 })
                .catch(() => {
                // Silently fail
            });
        };
    }, [componentName]);
}
exports.useProfiler = useProfiler;
//# sourceMappingURL=withProfiler.js.map