import path from "node:path";

export const STORAGE_ROOT = process.env.FLOW_STORAGE_DIR
    ? path.resolve(process.env.FLOW_STORAGE_DIR)
    : process.env.VERCEL
        ? path.join("/tmp", "flow-ai-studio")
        : process.cwd();
