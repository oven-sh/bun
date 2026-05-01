import * as net from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * A Unix domain socket proxy that forwards connections to a TCP host:port.
 * This is useful for testing Unix socket connections when the actual service
 * is running in a Docker container accessible only via TCP.
 */
export class UnixDomainSocketProxy {
  private server: net.Server | null = null;
  private socketPath: string;
  private targetHost: string;
  private targetPort: number;
  private serviceName: string;
  private connections: Set<net.Socket> = new Set();

  constructor(serviceName: string, targetHost: string, targetPort: number) {
    this.serviceName = serviceName;
    this.targetHost = targetHost;
    this.targetPort = targetPort;
    this.socketPath = path.join(os.tmpdir(), `${serviceName}_proxy_${Date.now()}.sock`);
  }

  /**
   * Get the Unix socket path for clients to connect to
   */
  get path(): string {
    return this.socketPath;
  }

  /**
   * Start the proxy server
   */
  async start(): Promise<void> {
    // Clean up any existing socket file
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      // Ignore error if file doesn't exist
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer(clientSocket => {
        console.log(`${this.serviceName} connection received on unix socket`);

        // Track this connection
        this.connections.add(clientSocket);

        // Create connection to the actual service container
        const containerSocket = net.createConnection({
          host: this.targetHost,
          port: this.targetPort,
        });

        // Handle container connection
        containerSocket.on("connect", () => {
          console.log(`Connected to ${this.serviceName} container via proxy`);
        });

        containerSocket.on("error", err => {
          console.error(`${this.serviceName} container connection error:`, err);
          clientSocket.destroy();
        });

        containerSocket.on("close", () => {
          clientSocket.end();
          this.connections.delete(clientSocket);
        });

        // Handle client socket
        clientSocket.on("data", data => {
          containerSocket.write(data);
        });

        clientSocket.on("error", err => {
          console.error(`${this.serviceName} client socket error:`, err);
          containerSocket.destroy();
        });

        clientSocket.on("close", () => {
          containerSocket.end();
          this.connections.delete(clientSocket);
        });

        // Forward container responses back to client
        containerSocket.on("data", data => {
          clientSocket.write(data);
        });
      });

      this.server.on("error", reject);

      this.server.listen(this.socketPath, () => {
        console.log(`Unix domain socket proxy for ${this.serviceName} listening on ${this.socketPath}`);
        resolve();
      });
    });
  }

  /**
   * Stop the proxy server and clean up
   */
  stop(): void {
    // Close all active connections
    for (const connection of this.connections) {
      connection.destroy();
    }
    this.connections.clear();

    // Close the server
    if (this.server) {
      this.server.close();
      this.server = null;
      console.log(`Closed Unix socket proxy server for ${this.serviceName}`);
    }

    // Remove the socket file
    try {
      fs.unlinkSync(this.socketPath);
      console.log(`Removed Unix socket file for ${this.serviceName}`);
    } catch {
      // Ignore error if file doesn't exist
    }
  }

  /**
   * Create and start a proxy instance
   */
  static async create(serviceName: string, targetHost: string, targetPort: number): Promise<UnixDomainSocketProxy> {
    const proxy = new UnixDomainSocketProxy(serviceName, targetHost, targetPort);
    await proxy.start();
    return proxy;
  }
}