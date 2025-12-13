import express from 'express';
import { ProfileLog } from './types';

/**
 * Local HTTP server that receives profiling data from React Native app
 */
export class ProfilerServer {
    private app: express.Application;
    private server: any;
    private port: number;
    private logs: ProfileLog[] = [];

    constructor(port: number) {
        this.port = port;
        this.app = express();
        this.setupRoutes();
    }

    private setupRoutes() {
        // Enable CORS for React Native app
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type');
            if (req.method === 'OPTIONS') {
                res.sendStatus(200);
            } else {
                next();
            }
        });

        this.app.use(express.json());

        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok', logsCount: this.logs.length });
        });

        // Main endpoint for receiving profiling data
        this.app.post('/profile-data', (req, res) => {
            try {
                const profileLog: ProfileLog = req.body;
                
                // Validate the log structure
                if (!profileLog || typeof profileLog !== 'object') {
                    res.status(400).json({ error: 'Invalid profile log: must be an object' });
                    return;
                }

                if (!profileLog.id || !profileLog.phase || typeof profileLog.actualDuration !== 'number') {
                    res.status(400).json({ error: 'Invalid profile log format: missing required fields' });
                    return;
                }

                // Validate phase
                if (!['mount', 'update', 'force-update'].includes(profileLog.phase)) {
                    res.status(400).json({ error: 'Invalid phase: must be mount, update, or force-update' });
                    return;
                }

                // Add timestamp if not present
                if (!profileLog.timestamp) {
                    profileLog.timestamp = new Date().toISOString();
                }

                // Ensure deviceInfo exists
                if (!profileLog.deviceInfo) {
                    profileLog.deviceInfo = {
                        os: 'unknown',
                        version: 'unknown'
                    };
                }

                this.logs.push(profileLog);
                res.json({ success: true, logId: profileLog.id, totalLogs: this.logs.length });

                console.log(`[Profiler] Received log: ${profileLog.id} - ${profileLog.phase} (${profileLog.actualDuration.toFixed(2)}ms)`);
            } catch (error: any) {
                console.error('[Profiler] Error processing profile log:', error);
                res.status(500).json({ error: 'Internal server error', message: error.message });
            }
        });
    }

    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.server = this.app.listen(this.port, () => {
                    console.log(`Profiler server started on port ${this.port}`);
                    resolve();
                });

                this.server.on('error', (error: any) => {
                    if (error.code === 'EADDRINUSE') {
                        reject(new Error(`Port ${this.port} is already in use`));
                    } else {
                        reject(error);
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    stop(): void {
        if (this.server) {
            this.server.close();
            this.server = undefined;
            console.log('Profiler server stopped');
        }
    }

    getLogs(): ProfileLog[] {
        return [...this.logs];
    }

    clearLogs(): void {
        this.logs = [];
    }

    isRunning(): boolean {
        return this.server !== undefined;
    }
}

