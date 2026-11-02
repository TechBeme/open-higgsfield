/** Client-side media attached to a studio generation request. */
export interface AttachmentItem {
    id: string;
    roleId: string;
    type: "file" | "url";
    file?: File;
    url?: string;
    previewUrl?: string;
    kind: "image" | "video" | "audio";
}
