import type { Server } from "node:http";
export function socketOwnership(port: number): {
  available: boolean;
  states: string[];
  pids: number[];
};
export function listenDistServer(options: {
  port: number;
  directory: string;
  isReady?: () => boolean;
}): Promise<Server>;
