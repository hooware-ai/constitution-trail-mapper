export const TILE_ORIGIN: string;
export function contentSecurityPolicy(options?: {
  https?: boolean;
  extraConnect?: string[];
}): string;
export function securityHeaders(options?: {
  https?: boolean;
  extraConnect?: string[];
}): Record<string, string>;
export function cacheControlFor(path: string): string;
export const mimeTypes: Record<string, string>;
