/**
 * Authoring contract for the app MCP interface served at `/_mcp`.
 *
 * `defineMcp` is a pure identity function: it exists only so TypeScript checks
 * the manifest shape at the definition site. All runtime validation happens
 * inside the shim (`./shim.ts`) at request time — never at module evaluation,
 * because a module-eval throw surfaces as an undebuggable 502 with empty logs.
 */

/** Per-call context handed to every tool handler by the shim. */
export type ToolContext = {
  /** The app's environment: DB, PROXY_BASE_URL, secrets, ... */
  env: Record<string, unknown>;
  /**
   * Trusted caller identity from the gateway-injected `X-Godeploy-User-Email`
   * header, or `null` on anonymous public-app calls.
   */
  userEmail: string | null;
  /** The raw incoming request, for headers/URL inspection. */
  request: Request;
};

export type McpTool = {
  /**
   * Tool name. Must match `^[a-zA-Z0-9_-]{1,64}$` — the shim enforces this at
   * request time (types cannot express the constraint).
   */
  name: string;
  description: string;
  /** Plain JSON Schema with an object root — no zod, no converters. */
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
};

export type McpManifest = { name: string; version: string; tools: McpTool[] };

export const defineMcp = (m: McpManifest): McpManifest => m;
