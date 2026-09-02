import path from "node:path";

export const STORAGE_ROOT = process.env.OPEN_HIGGSFIELD_STORAGE_DIR
    ? path.resolve(process.env.OPEN_HIGGSFIELD_STORAGE_DIR)
    : process.env.VERCEL
        ? path.join("/tmp", "open-higgsfield")
        : process.cwd();
