export const PREVIEW_RESERVED_NAMESPACES: string[];
export const PREVIEW_CONTROL_FILES: string[];
export function previewPath(
  pathname: string,
): { path: string; trailingSlash: boolean } | null;
export function previewBindingPath(resolved: string): string;
export interface PreviewPolicy {
  securityHeaders(options?: { https?: boolean }): Record<string, string>;
  cacheControlFor(path: string): string;
  mimeTypes: Record<string, string>;
}
export interface PreviewEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}
export function createPreviewHandler(options: {
  inventory: Iterable<string>;
  policy: PreviewPolicy;
}): (request: Request, env: PreviewEnv) => Promise<Response>;
