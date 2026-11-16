import "server-only";

import fs from "node:fs/promises";

/**
 * Persists a completed rename or link by flushing its parent directory entry.
 * Windows cannot flush a directory handle (FlushFileBuffers fails with EPERM)
 * and NTFS journals the directory change itself, so this is a no-op there.
 */
export async function syncDirectory(directory: string): Promise<void> {
    if (process.platform === "win32") return;
    const handle = await fs.open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
}
