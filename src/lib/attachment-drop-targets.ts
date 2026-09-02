import type { MediaSlotCapability } from "@/models/capabilities/types";

export type DropMediaKind = "image" | "video" | "audio";

export interface DropRoleDescriptor {
    id: string;
    label: string;
    kind: DropMediaKind;
    required?: boolean;
    multiple?: boolean;
}

export interface GroupedDropTarget {
    id: string;
    label: string;
    kind: DropMediaKind;
    required: boolean;
    roleIds: string[];
    acceptMany: boolean;
}

function normalizeLabel(label: string): string {
    return label
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .replace(/\s*\d+\s*$/g, "")
        .trim();
}

function canGroup(a: DropRoleDescriptor, b: DropRoleDescriptor): boolean {
    if (a.kind !== b.kind) return false;
    if (a.multiple || b.multiple) return false;

    const normalizedA = normalizeLabel(a.label);
    const normalizedB = normalizeLabel(b.label);
    if (!normalizedA || !normalizedB) return false;

    return normalizedA === normalizedB;
}

function groupedLabel(label: string): string {
    return label.replace(/\s*\d+\s*$/g, "").trim() || label;
}

export function buildGroupedDropTargets(
    descriptors: DropRoleDescriptor[]
): GroupedDropTarget[] {
    const groups: Array<{ head: DropRoleDescriptor; members: DropRoleDescriptor[] }> = [];

    for (const descriptor of descriptors) {
        const group = groups.find((candidate) => canGroup(candidate.head, descriptor));
        if (group) {
            group.members.push(descriptor);
            continue;
        }
        groups.push({ head: descriptor, members: [descriptor] });
    }

    return groups.map(({ head, members }) => ({
        id: members.length > 1 ? `group_${members.map((m) => m.id).join("_")}` : head.id,
        label: members.length > 1 ? groupedLabel(head.label) : head.label,
        kind: head.kind,
        required: members.some((member) => Boolean(member.required)),
        roleIds: members.map((member) => member.id),
        acceptMany: Boolean(head.multiple) || members.length > 1,
    }));
}

export function slotsToDropDescriptors(
    slots: MediaSlotCapability[]
): DropRoleDescriptor[] {
    return slots.map((slot) => ({
        id: slot.id,
        label: slot.label,
        kind: slot.kind,
        required: slot.required,
        multiple: slot.multiple,
    }));
}
