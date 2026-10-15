/**
 * Browser-safe surface of the adapter.
 *
 * Deliberately excludes `client.ts`: that module talks to node-only APIs
 * (`node:fs`, MCP SDK transports, tokens). The single-file HTML build bundles
 * this entry instead, so no secret or node builtin ever reaches the bundle.
 */
export * from './types.ts';
export * from './fixture.ts';
export * from './normalizer.ts';
export * from './operations.ts';
