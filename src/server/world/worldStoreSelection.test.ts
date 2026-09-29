import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const blobs = vi.hoisted(() => new Map<string, string>());

/**
 * Direct regression coverage for the exact bug caught during this project's
 * own Vercel deployment: `vercel storage connect`'s CURRENT default flow
 * provisions Blob via OIDC auth, setting `BLOB_STORE_ID` but NOT
 * `BLOB_READ_WRITE_TOKEN` (the actual per-request credential,
 * `VERCEL_OIDC_TOKEN`, is injected by the runtime and never appears as a
 * static project env var). `worldStore`'s module-load-time selection must
 * treat `BLOB_STORE_ID` alone as sufficient to pick the durable
 * `BlobWorldStore` — gating only on `BLOB_READ_WRITE_TOKEN` would silently
 * fall back to `InMemoryWorldStore` in production (docs/WORLD_ARCHITECTURE.md
 * §3). Exercised via dynamic re-import under `vi.resetModules()` since the
 * selection happens once, at module load.
 */
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string, body: string) => {
    blobs.set(pathname, body);
    return { url: `https://blob.example/${pathname}` };
  }),
  get: vi.fn(async (pathname: string) => {
    const body = blobs.get(pathname);
    if (body === undefined) return null;
    return {
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      }),
    };
  }),
}));

const ORIGINAL_ENV = { ...process.env };

async function loadWorldStore() {
  vi.resetModules();
  const mod = await import("./worldStore");
  return mod.worldStore;
}

describe("worldStore selection (module-load-time)", () => {
  beforeEach(() => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_STORE_ID;
    blobs.clear();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.clearAllMocks();
  });

  it("picks the durable Blob-backed store when only BLOB_STORE_ID is set (the OIDC connection method actually used in production)", async () => {
    process.env.BLOB_STORE_ID = "store_test123";
    const { put } = await import("@vercel/blob");
    const store = await loadWorldStore();

    await store.createWorld({
      repositoryUrl: "https://github.com/o/r",
      repositoryId: "o/r",
      commitSha: "abc123",
      snapshot: {} as never,
    });

    // Only the Blob-backed implementation calls put(); the in-memory one
    // never touches @vercel/blob at all.
    expect(put).toHaveBeenCalled();
  });

  it("picks the durable Blob-backed store when only BLOB_READ_WRITE_TOKEN is set (the legacy/manual connection method)", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
    const { put } = await import("@vercel/blob");
    const store = await loadWorldStore();

    await store.createWorld({
      repositoryUrl: "https://github.com/o/r",
      repositoryId: "o/r",
      commitSha: "abc123",
      snapshot: {} as never,
    });

    expect(put).toHaveBeenCalled();
  });

  it("falls back to the in-memory store when neither var is set (local development)", async () => {
    const { put } = await import("@vercel/blob");
    const store = await loadWorldStore();

    await store.createWorld({
      repositoryUrl: "https://github.com/o/r",
      repositoryId: "o/r",
      commitSha: "abc123",
      snapshot: {} as never,
    });

    expect(put).not.toHaveBeenCalled();
    // Sanity: it's still a real, working store.
    expect(await store.getLatestWorldIdForRepository("o/r")).toBeTruthy();
  });

  it("refreshes mutable snapshots and repository indexes across Blob store instances", async () => {
    process.env.BLOB_STORE_ID = "store_test123";
    const storeA = await loadWorldStore();
    const firstWorld = await storeA.createWorld({
      repositoryUrl: "https://github.com/o/r",
      repositoryId: "o/r",
      commitSha: "first",
      snapshot: { marker: "initial" } as never,
    });
    const storeB = await loadWorldStore();

    await expect(storeB.getSnapshot(firstWorld.id)).resolves.toMatchObject({ marker: "initial" });
    await storeA.updateSnapshot(firstWorld.id, (snapshot) => ({ ...snapshot, marker: "updated" } as typeof snapshot));
    await expect(storeB.getSnapshot(firstWorld.id)).resolves.toMatchObject({ marker: "updated" });

    const secondWorld = await storeA.createWorld({
      repositoryUrl: "https://github.com/o/r",
      repositoryId: "o/r",
      commitSha: "second",
      snapshot: {} as never,
    });
    await expect(storeB.getLatestWorldIdForRepository("o/r")).resolves.toBe(secondWorld.id);
  });
});
