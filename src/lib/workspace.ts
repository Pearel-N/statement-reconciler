import { randomUUID } from "node:crypto";

/**
 * A workspace is nothing but an unguessable identifier in the URL.
 *
 * `randomUUID` is 122 bits of CSPRNG entropy — not enumerable, and no
 * dependency needed. There is no endpoint anywhere that lists workspaces, so
 * possession of the URL is the entire access model. That is a deliberate
 * trade for a five-day build, recorded in decisions.md, not an oversight.
 */
export function createWorkspaceId(): string {
  return randomUUID();
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidWorkspaceId(value: string): boolean {
  return UUID_V4.test(value);
}
