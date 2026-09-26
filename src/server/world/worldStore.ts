import { put, get } from "@vercel/blob";
import type { WorldRecord, WorldSnapshot, WorldMutableState } from "@/types/world";
import { EMPTY_WORLD_MUTABLE_STATE } from "@/types/world";
import type { BobEvent } from "@/types/bob-events";
import { createWorldId } from "./id";

/**
 * Durable, cross-instance World persistence (docs/WORLD_ARCHITECTURE.md).
 *
 * WHY THIS EXISTS: every other store in this project so far
 * (`knowledgeModelStore`, `sessionContextStore`, `domainConceptStore`,
 * `onboardingJourneyStore`, `bobEventBus`) is a plain in-memory `Map` —
 * correct within one warm process, but Vercel does not guarantee that two
 * independent HTTP requests (a browser's `/api/analyze`, then Bob's own
 * `/api/mcp` call moments later) land on the same instance. Empirically
 * confirmed during the prior deployment phase (docs/VERCEL_DEPLOYMENT.md
 * §3): this is common enough in practice to break the core Bob-first
 * workflow, not a rare edge case. A World must be readable from ANY
 * instance, so its identity, its analysis snapshot, and its mutable
 * interpretation state all live in Vercel Blob — the smallest
 * Vercel-native persistence primitive that fits (plain JSON blobs at
 * deterministic pathnames), not a database.
 *
 * LOCAL DEVELOPMENT: falls back to a pure in-memory implementation when
 * neither `BLOB_READ_WRITE_TOKEN` nor `BLOB_STORE_ID` is set (the normal
 * case for `npm run dev`) — zero required setup locally, exactly like every
 * store before it.
 *
 * AUTH MODE: `vercel storage connect` now provisions stores via Vercel's
 * OIDC auth by default — it sets `BLOB_STORE_ID` (a static env var) but
 * deliberately does NOT set `BLOB_READ_WRITE_TOKEN`. The actual credential
 * (`VERCEL_OIDC_TOKEN`) is injected by the Vercel runtime per-request and is
 * NOT visible via `vercel env ls` — the `@vercel/blob` SDK resolves it
 * automatically at call time given `BLOB_STORE_ID`. So the store-selection
 * check below must treat `BLOB_STORE_ID` as sufficient on its own; gating
 * only on `BLOB_READ_WRITE_TOKEN` would silently fall back to in-memory
 * storage in production under this (now-default) connection method.
 *
 * CACHING: a plain in-memory Map sits in front of the Blob-backed
 * implementation, write-through on every mutation and populated on read —
 * this keeps repeated tool calls within one warm instance fast (no network
 * round-trip per call), while still being correct on a cold/different
 * instance (an empty cache just falls through to Blob).
 */

export class WorldNotFoundError extends Error {
  constructor(worldId: string) {
    super(`No CodeBiome world "${worldId}" was found. It may have expired, or the id may be wrong.`);
    this.name = "WorldNotFoundError";
  }
}

export interface WorldStore {
  createWorld(args: {
    repositoryUrl: string;
    repositoryId: string;
    commitSha: string;
    snapshot: Omit<WorldSnapshot, "world">;
  }): Promise<WorldRecord>;
  getWorld(worldId: string): Promise<WorldRecord | null>;
  getSnapshot(worldId: string): Promise<WorldSnapshot | null>;
  getLatestWorldIdForRepository(repositoryId: string): Promise<string | null>;
  getMostRecentWorldId(): Promise<string | null>;
  getMutableState(worldId: string): Promise<WorldMutableState>;
  updateMutableState(worldId: string, updater: (state: WorldMutableState) => WorldMutableState): Promise<WorldMutableState>;
  appendEvent(worldId: string, event: BobEvent): Promise<void>;
  /** Events after `sinceIndex` (exclusive), plus the new highest index — for SSE catch-up across instances. */
  getEventsSince(worldId: string, sinceIndex: number): Promise<{ events: BobEvent[]; latestIndex: number }>;
}

const MAX_STORED_EVENTS = 200;

function repoIndexKey(repositoryId: string): string {
  // repositoryId is "owner/repo" — safe as nested Blob path segments as-is.
  return `worlds-index/by-repository/${repositoryId}.json`;
}

/** In-memory implementation — used for local development only. */
class InMemoryWorldStore implements WorldStore {
  private records = new Map<string, WorldRecord>();
  private snapshots = new Map<string, WorldSnapshot>();
  private mutableState = new Map<string, WorldMutableState>();
  private events = new Map<string, BobEvent[]>();
  private latestByRepository = new Map<string, string>();
  private mostRecentWorldId: string | null = null;

  async createWorld(args: { repositoryUrl: string; repositoryId: string; commitSha: string; snapshot: Omit<WorldSnapshot, "world"> }) {
    const world: WorldRecord = {
      id: createWorldId(),
      repositoryUrl: args.repositoryUrl,
      repositoryId: args.repositoryId,
      commitSha: args.commitSha,
      createdAt: new Date().toISOString(),
    };
    this.records.set(world.id, world);
    this.snapshots.set(world.id, { world, ...args.snapshot });
    this.mutableState.set(world.id, { ...EMPTY_WORLD_MUTABLE_STATE });
    this.latestByRepository.set(args.repositoryId, world.id);
    this.mostRecentWorldId = world.id;
    return world;
  }

  async getWorld(worldId: string) {
    return this.records.get(worldId) ?? null;
  }

  async getSnapshot(worldId: string) {
    return this.snapshots.get(worldId) ?? null;
  }

  async getLatestWorldIdForRepository(repositoryId: string) {
    return this.latestByRepository.get(repositoryId) ?? null;
  }

  async getMostRecentWorldId() {
    return this.mostRecentWorldId;
  }

  async getMutableState(worldId: string) {
    return this.mutableState.get(worldId) ?? { ...EMPTY_WORLD_MUTABLE_STATE };
  }

  async updateMutableState(worldId: string, updater: (state: WorldMutableState) => WorldMutableState) {
    const next = updater(this.mutableState.get(worldId) ?? { ...EMPTY_WORLD_MUTABLE_STATE });
    this.mutableState.set(worldId, next);
    return next;
  }

  async appendEvent(worldId: string, event: BobEvent) {
    const list = this.events.get(worldId) ?? [];
    list.push(event);
    if (list.length > MAX_STORED_EVENTS) list.shift();
    this.events.set(worldId, list);
  }

  async getEventsSince(worldId: string, sinceIndex: number) {
    const list = this.events.get(worldId) ?? [];
    return { events: list.slice(sinceIndex), latestIndex: list.length };
  }
}

/** Vercel Blob-backed implementation — used in production (and anywhere Blob credentials are configured, via either a static token or OIDC + `BLOB_STORE_ID`). */
class BlobWorldStore implements WorldStore {
  // Read-through/write-through cache — same data, just avoids a network
  // round-trip to Blob for every single tool call within one warm
  // instance. Never the sole source of truth: a cache miss always falls
  // through to Blob, which is what makes this correct across instances.
  private recordCache = new Map<string, WorldRecord>();
  private snapshotCache = new Map<string, WorldSnapshot>();
  private mutableStateCache = new Map<string, WorldMutableState>();
  private eventsCache = new Map<string, BobEvent[]>();
  private repoIndexCache = new Map<string, string>();
  private mostRecentCache: string | null = null;

  private async putJson(pathname: string, data: unknown): Promise<void> {
    // This project's Blob store was provisioned with `--access private`
    // (docs/VERCEL_DEPLOYMENT.md §4) — Vercel rejects `access: "public"`
    // writes against it ("Cannot use public access on a private store"),
    // confirmed against the real deployment. `access` here describes the
    // blob's own ACL, which must match the store, not an independent choice.
    await put(pathname, JSON.stringify(data), { access: "private", allowOverwrite: true, contentType: "application/json" });
  }

  private async getJson<T>(pathname: string): Promise<T | null> {
    try {
      // `get()` (not `head()` + a raw `fetch`) because a private blob's URL
      // isn't fetchable unauthenticated — `get()` resolves the same
      // OIDC/token credential `put()` used and streams the content back.
      const result = await get(pathname, { access: "private", useCache: false });
      if (!result || result.stream === null) return null;
      const text = await new Response(result.stream).text();
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  async createWorld(args: { repositoryUrl: string; repositoryId: string; commitSha: string; snapshot: Omit<WorldSnapshot, "world"> }) {
    const world: WorldRecord = {
      id: createWorldId(),
      repositoryUrl: args.repositoryUrl,
      repositoryId: args.repositoryId,
      commitSha: args.commitSha,
      createdAt: new Date().toISOString(),
    };
    const snapshot: WorldSnapshot = { world, ...args.snapshot };

    await Promise.all([
      this.putJson(`worlds/${world.id}/record.json`, world),
      this.putJson(`worlds/${world.id}/snapshot.json`, snapshot),
      this.putJson(`worlds/${world.id}/state.json`, EMPTY_WORLD_MUTABLE_STATE),
      this.putJson(repoIndexKey(args.repositoryId), { worldId: world.id }),
      this.putJson(`worlds-index/most-recent.json`, { worldId: world.id }),
    ]);

    this.recordCache.set(world.id, world);
    this.snapshotCache.set(world.id, snapshot);
    this.mutableStateCache.set(world.id, { ...EMPTY_WORLD_MUTABLE_STATE });
    this.repoIndexCache.set(args.repositoryId, world.id);
    this.mostRecentCache = world.id;

    return world;
  }

  async getWorld(worldId: string) {
    const cached = this.recordCache.get(worldId);
    if (cached) return cached;
    const record = await this.getJson<WorldRecord>(`worlds/${worldId}/record.json`);
    if (record) this.recordCache.set(worldId, record);
    return record;
  }

  async getSnapshot(worldId: string) {
    const cached = this.snapshotCache.get(worldId);
    if (cached) return cached;
    const snapshot = await this.getJson<WorldSnapshot>(`worlds/${worldId}/snapshot.json`);
    if (snapshot) this.snapshotCache.set(worldId, snapshot);
    return snapshot;
  }

  async getLatestWorldIdForRepository(repositoryId: string) {
    const cached = this.repoIndexCache.get(repositoryId);
    if (cached) return cached;
    const pointer = await this.getJson<{ worldId: string }>(repoIndexKey(repositoryId));
    if (pointer) this.repoIndexCache.set(repositoryId, pointer.worldId);
    return pointer?.worldId ?? null;
  }

  async getMostRecentWorldId() {
    if (this.mostRecentCache) return this.mostRecentCache;
    const pointer = await this.getJson<{ worldId: string }>(`worlds-index/most-recent.json`);
    if (pointer) this.mostRecentCache = pointer.worldId;
    return pointer?.worldId ?? null;
  }

  async getMutableState(worldId: string) {
    const cached = this.mutableStateCache.get(worldId);
    if (cached) return cached;
    const state = (await this.getJson<WorldMutableState>(`worlds/${worldId}/state.json`)) ?? { ...EMPTY_WORLD_MUTABLE_STATE };
    this.mutableStateCache.set(worldId, state);
    return state;
  }

  async updateMutableState(worldId: string, updater: (state: WorldMutableState) => WorldMutableState) {
    // Read-modify-write, not a transaction — the same weak-consistency
    // tradeoff every in-memory store in this project already accepted for
    // a single-developer hackathon demo (docs/BOB_INTEGRATION.md §9),
    // just now also true across instances instead of only within one.
    const current = await this.getMutableState(worldId);
    const next = updater(current);
    await this.putJson(`worlds/${worldId}/state.json`, next);
    this.mutableStateCache.set(worldId, next);
    return next;
  }

  async appendEvent(worldId: string, event: BobEvent) {
    const cached = this.eventsCache.get(worldId);
    const current = cached ?? (await this.getJson<BobEvent[]>(`worlds/${worldId}/events.json`)) ?? [];
    const next = [...current, event].slice(-MAX_STORED_EVENTS);
    this.eventsCache.set(worldId, next);
    // Fire-and-forget from the caller's perspective is tempting, but a
    // dropped write here means Bob's action silently never reaches a
    // browser on a different instance — worth the extra latency to await.
    await this.putJson(`worlds/${worldId}/events.json`, next);
  }

  async getEventsSince(worldId: string, sinceIndex: number) {
    const cached = this.eventsCache.get(worldId);
    const events = cached ?? (await this.getJson<BobEvent[]>(`worlds/${worldId}/events.json`)) ?? [];
    if (!cached) this.eventsCache.set(worldId, events);
    return { events: events.slice(sinceIndex), latestIndex: events.length };
  }
}

export const worldStore: WorldStore =
  process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID ? new BlobWorldStore() : new InMemoryWorldStore();
