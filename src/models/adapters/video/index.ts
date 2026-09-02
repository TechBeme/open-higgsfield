/**
 * Video adapter registry — maps model IDs to their adapter instances.
 */
import type { ModelAdapter } from "../base";
import { KlingAdapter } from "./kling";
import { RunwayAdapter } from "./runway";
import { WanAdapter } from "./wan";
import { MinimaxAdapter } from "./minimax";
import { SeedanceAdapter } from "./seedance";
import { PixverseAdapter } from "./pixverse";
import { LtxAdapter } from "./ltx";
import { OmniHumanAdapter } from "./omni-human";

const adapters: ModelAdapter[] = [
    new KlingAdapter(),
    new RunwayAdapter(),
    new WanAdapter(),
    new MinimaxAdapter(),
    new SeedanceAdapter(),
    new PixverseAdapter(),
    new LtxAdapter(),
    new OmniHumanAdapter(),
];

const adapterMap = new Map<string, ModelAdapter>();
for (const adapter of adapters) {
    for (const modelId of adapter.familyModels) {
        adapterMap.set(modelId, adapter);
    }
}

/** Get the adapter for a given video model ID */
export function getVideoAdapter(modelId: string): ModelAdapter | undefined {
    return adapterMap.get(modelId);
}
