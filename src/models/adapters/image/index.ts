import type { ModelAdapter } from "../base";
import { FluxAdapter } from "./flux";
import { SeedreamAdapter } from "./seedream";
import { ZImageAdapter } from "./z-image";

const ADAPTERS: ModelAdapter[] = [
    new FluxAdapter(),
    new SeedreamAdapter(),
    new ZImageAdapter(),
];

const ADAPTER_MAP = new Map<string, ModelAdapter>();
for (const a of ADAPTERS) {
    for (const id of a.familyModels) {
        ADAPTER_MAP.set(id, a);
    }
}

export function getImageAdapter(modelId: string): ModelAdapter | undefined {
    return ADAPTER_MAP.get(modelId);
}
