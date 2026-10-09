export function parseWithNumbers(text: string): unknown;
export function toPlain(tree: unknown): any;
export function canonical(tree: unknown): string;
export function sha256Text(text: string): string;
export function canonicalSha256(value: unknown): string;

export const codePointOrder: (a: string, b: string) => number;
