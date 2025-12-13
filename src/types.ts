/**
 * Profile log data structure received from React Native app
 */
export interface ProfileLog {
    id: string; // Component name or unique ID
    phase: 'mount' | 'update' | 'force-update';
    actualDuration: number; // Time spent rendering
    baseDuration: number; // Estimated time without memoization
    startTime: number;
    commitTime: number;
    timestamp: string; // ISO string of when render completed
    deviceInfo: {
        os: string; // e.g., 'ios', 'android'
        version: string; // OS version
        model?: string; // Device model
    };
    interactions?: string[]; // Array of interaction IDs associated with this render
}

/**
 * Component tree node structure
 */
export interface ComponentTreeNode {
    name: string;
    path: string;
    type: 'file' | 'component';
    children?: ComponentTreeNode[];
}

/**
 * Message types for WebView communication
 */
export interface WebViewMessage {
    type: string;
    [key: string]: any;
}

