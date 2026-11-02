import type { AttachmentItem } from "@/features/studio/types";
import type { MediaSlotCapability } from "@/models/capabilities/types";

type SlotCandidate = {
    id: string;
    label: string;
    kind: "image" | "video" | "audio";
    multiple?: boolean;
    max_count?: number;
};

function capacity(slot: SlotCandidate): number {
    return slot.max_count ?? (slot.multiple ? 256 : 1);
}

function normalizeLabel(label: string): string {
    return label
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .replace(/\s*\d+\s*$/g, "")
        .trim();
}

function compatibleFileKind(
    item: AttachmentItem,
    targetKind: "image" | "video" | "audio"
): boolean {
    if (item.kind !== targetKind) return false;
    return Boolean(item.file || item.url);
}

function chooseCandidate(
    sourceLabel: string,
    targetKind: "image" | "video" | "audio",
    candidates: SlotCandidate[],
    preferredId?: string
): SlotCandidate | null {
    if (preferredId) {
        const byId = candidates.find((candidate) => candidate.id === preferredId && candidate.kind === targetKind);
        if (byId) return byId;
    }

    const sourceNormalized = normalizeLabel(sourceLabel);
    const byLabel = candidates.find(
        (candidate) => candidate.kind === targetKind && normalizeLabel(candidate.label) === sourceNormalized
    );
    if (byLabel) return byLabel;

    const sameKind = candidates.find((candidate) => candidate.kind === targetKind);
    return sameKind ?? null;
}

export function remapSlotFilesOnModelSwitch(
    prevFiles: Record<string, File[]>,
    previousSlots: MediaSlotCapability[],
    nextSlots: MediaSlotCapability[]
): Record<string, File[]> {
    const nextCandidates: SlotCandidate[] = nextSlots.map((slot) => ({
        id: slot.id,
        label: slot.label,
        kind: slot.kind,
        multiple: slot.multiple,
        max_count: slot.max_count,
    }));

    const nextById = new Set(nextSlots.map((slot) => slot.id));
    const mapped: Record<string, File[]> = {};

    for (const slot of previousSlots) {
        const currentFiles = prevFiles[slot.id] ?? [];
        if (currentFiles.length === 0) continue;

        const target = chooseCandidate(slot.label, slot.kind, nextCandidates, nextById.has(slot.id) ? slot.id : undefined);
        if (!target) continue;

        const retained = mapped[target.id] ?? [];
        const available = Math.max(0, capacity(target) - retained.length);
        if (available) mapped[target.id] = [...retained, ...currentFiles.slice(0, available)];
    }

    return mapped;
}

export function remapVideoAttachmentsOnModelSwitch(
    prevItems: AttachmentItem[],
    previousRoles: SlotCandidate[],
    nextRoles: SlotCandidate[]
): AttachmentItem[] {
    if (prevItems.length === 0 || nextRoles.length === 0) return [];

    const previousById = new Map(previousRoles.map((role) => [role.id, role]));
    const nextById = new Map(nextRoles.map((role) => [role.id, role]));
    const assignedCounts = new Map<string, number>();
    const nextItems: AttachmentItem[] = [];

    for (const item of prevItems) {
        const currentRole = previousById.get(item.roleId);
        const sourceLabel = currentRole?.label ?? item.roleId;
        const preferredId = nextById.has(item.roleId) ? item.roleId : undefined;
        let target = chooseCandidate(sourceLabel, item.kind, nextRoles, preferredId);
        if (!target) continue;
        if (!compatibleFileKind(item, target.kind)) continue;

        if (!target.multiple && (assignedCounts.get(target.id) ?? 0) >= capacity(target)) {
            const fallback = nextRoles.find(
                (candidate) => candidate.kind === item.kind && candidate.multiple && compatibleFileKind(item, candidate.kind)
            );
            if (!fallback) continue;
            target = fallback;
        }

        const assigned = assignedCounts.get(target.id) ?? 0;
        if (assigned >= capacity(target)) continue;
        assignedCounts.set(target.id, assigned + 1);

        nextItems.push({
            ...item,
            roleId: target.id,
            kind: target.kind,
        });
    }

    return nextItems;
}
