"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronDown, Clapperboard, Copy, Download, Image as ImageIcon, ImagePlus, Loader2, MoreHorizontal, Play, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useModelCopy } from "@/i18n/use-model-copy";
import { useRuntimeModels } from "@/features/catalog/hooks/useRuntimeModels";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useStoredNumber } from "@/lib/use-stored-number";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { HeaderToolbar } from "@/components/layout/toolbar-slot";
import { Lightbox, type PreviewItem } from "./Lightbox";
import { useVideoTasks, revalidateVideoTasks } from "../hooks/useVideoTasks";
import { useImageTasks, revalidateImageTasks } from "../hooks/useImageTasks";
import { useTaskRefresh } from "../hooks/useTaskRefresh";
import type { AnyTask } from "@/types";
import { useBackgroundSubmissions, dismissSubmission, type BackgroundSubmission } from "@/features/studio/lib/background-submissions";
import { writeImageTransfer } from "@/features/studio/lib/media-transfer";
import { GALLERY_DRAG_TYPE, galleryIndices, galleryKey, galleryRank, moveGalleryItem, type GalleryReference } from "@/lib/gallery";
import { attachmentUrl } from "@/lib/download-url";

export type ImageTarget = "reference" | "start" | "end";
interface GalleryItem extends GalleryReference { task: AnyTask; model: string; preview?: PreviewItem }
interface GalleryProps { mode: "image" | "video"; empty: React.ReactNode; onReusePrompt?: (prompt: string) => void; onSendImage?: (url: string, target: ImageTarget) => void }

const ROW_MIN = 90, ROW_DEFAULT = 200, ROW_MAX = 420;
const canReorder = (item: GalleryItem) => !["CREATED", "IN_PROGRESS"].includes(item.task.status ?? item.task.freepik_status ?? "CREATED");
/** Remembers each output's real proportions so the justified rows do not jump when the gallery remounts. */
const ratios = new Map<string, number>();
const clampRatio = (value: number) => Number.isFinite(value) && value > 0 ? Math.min(2.4, Math.max(0.42, value)) : 1;
// Hover-only affordances stay visible on touchscreens, where there is no hover.
const revealOnHover = "opacity-0 transition-opacity group-hover/tile:opacity-100 group-focus-within/tile:opacity-100 [@media(hover:none)]:opacity-100";
// On touchscreens only selection and the "more" menu stay on each tile; the menu already holds every action.
const desktopOnly = "[@media(hover:none)]:hidden";
const roundAction = "grid size-8 place-items-center rounded-full bg-black/55 text-white backdrop-blur-md transition-colors hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-primary";

function taskItems(task: AnyTask, model: string): GalleryItem[] {
    const urls = task.media_type === "video" ? task.video_urls ?? task.result_urls ?? [] : task.result_urls ?? [];
    const completed = (task.status ?? task.freepik_status) === "COMPLETED";
    return galleryIndices(task).map(index => ({ taskId: task.task_id, index, task, model, preview: completed && index !== null ? {
        url: task.has_download ? `/api/download/${encodeURIComponent(task.task_id)}?index=${index}&inline=1` : urls[index],
        downloadUrl: attachmentUrl(`/api/download/${encodeURIComponent(task.task_id)}?index=${index}`),
        model, prompt: task.prompt, mediaType: task.media_type,
    } : undefined }));
}

/** Applies a gallery change on the server and returns the rank base the server used for a new order. */
async function galleryMutation(mediaType: "image" | "video", action: "delete" | "reorder", items: GalleryReference[]): Promise<number> {
    const response = await fetch("/api/gallery", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, mediaType, items }) });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true) throw new Error(typeof result?.error === "string" ? result.error : "ERR_GENERIC");
    return typeof result.rankBase === "number" && Number.isFinite(result.rankBase) ? result.rankBase : Date.now();
}

export function ResultsGrid(props: GalleryProps) {
    return <Gallery key={props.mode} {...props} />;
}

function Gallery({ mode, empty, onReusePrompt, onSendImage }: GalleryProps) {
    const t = useTranslations("tasks");
    const errors = useTranslations("errors");
    const { modelLabel } = useModelCopy();
    const videoHistory = useVideoTasks();
    const imageHistory = useImageTasks();
    const imageCatalog = useRuntimeModels("image");
    const videoCatalog = useRuntimeModels("video");
    const history = mode === "image" ? imageHistory : videoHistory;
    const submissions = useBackgroundSubmissions();
    const localSubmissions = submissions.filter(item => item.mode === mode && !history.tasks.some(task =>
        task.task_id === item.outcome?.taskId || ((!item.outcome || item.outcome.accepted) && task.reuse_state?.clientSubmissionId === item.id)));
    useEffect(() => {
        for (const item of submissions) {
            if (item.outcome && [...imageHistory.tasks, ...videoHistory.tasks].some(task => task.task_id === item.outcome?.taskId || (item.outcome?.accepted && task.reuse_state?.clientSubmissionId === item.id))) dismissSubmission(item.id);
        }
    }, [submissions, imageHistory.tasks, videoHistory.tasks]);
    useEffect(() => {
        if (!submissions.some(item => !item.outcome || item.outcome.accepted)) return;
        const timer = setInterval(() => { void revalidateImageTasks(); void revalidateVideoTasks(); }, 3_000);
        return () => clearInterval(timer);
    }, [submissions]);
    const [preview, setPreview] = useState<{ items: PreviewItem[]; index: number } | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [deleting, setDeleting] = useState<GalleryReference[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [searchOpen, setSearchOpen] = useState(false);
    const [filter, setFilter] = useState("all");
    const [sort, setSort] = useState("custom");
    // Row height of the justified grid in pixels on wider screens; phones use 60% of it.
    const [rowSize, setRowSize] = useStoredNumber("open-higgsfield:gallery-row-size", ROW_DEFAULT, ROW_MIN, ROW_MAX);
    const [saving, setSaving] = useState(false);
    const [arrangement, setArrangement] = useState<string[] | null>(null);
    const [dragging, setDragging] = useState<string | null>(null);
    const [over, setOver] = useState<string | null>(null);
    const [announcement, setAnnouncement] = useState("");
    const lastSelected = useRef<string | null>(null);
    const deleteOpener = useRef<HTMLElement | null>(null);
    const resultsRegion = useRef<HTMLElement | null>(null);
    const opener = useRef<HTMLElement | null>(null);
    const searchInput = useRef<HTMLInputElement | null>(null);
    useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);
    // A task keeps its own media type, so labels resolve against the matching catalog even while the other tab is shown.
    const cards = useMemo(() => history.tasks.flatMap(task => {
        const byId = task.media_type === "video" ? videoCatalog.byId : imageCatalog.byId;
        return taskItems(task, modelLabel(byId[task.model_id]?.label ?? task.provider_capabilities?.label ?? task.model_id));
    }).sort((a, b) => galleryRank(a.task, a.index) - galleryRank(b.task, b.index) || b.taskId.localeCompare(a.taskId)), [history.tasks, imageCatalog.byId, videoCatalog.byId, modelLabel]);
    const arranged = arrangement ? [...cards].sort((a, b) => {
        const ai = arrangement.indexOf(galleryKey(a)), bi = arrangement.indexOf(galleryKey(b));
        return (ai < 0 ? -1 : ai) - (bi < 0 ? -1 : bi);
    }) : cards;
    const filtered = arranged.filter(item => {
        const status = item.task.status ?? item.task.freepik_status ?? "CREATED";
        return (!search.trim() || `${item.model} ${item.task.prompt ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) &&
            (filter === "all" || (filter === "completed" ? status === "COMPLETED" : filter === "pending" ? ["CREATED", "IN_PROGRESS"].includes(status) : ["ERROR", "FAILED", "CANCELLED"].includes(status)));
    });
    const visible = sort === "custom" ? filtered : [...filtered].sort((a, b) => (sort === "newest" ? -1 : 1) * (Date.parse(a.task.created_at) - Date.parse(b.task.created_at)) || (a.index ?? 0) - (b.index ?? 0));
    const allOutputs = visible.flatMap(item => item.preview ? [item.preview] : []);
    const selectedItems = cards.filter(item => selected.has(galleryKey(item)));
    const selecting = selectedItems.length > 0;
    const sortable = arranged.filter(canReorder);
    // Dragging always reorders, except while a date sort is shown, where a custom position would not be visible.
    const reorderable = sort === "custom" && !saving;
    const allSelected = visible.length > 0 && visible.every(item => selected.has(galleryKey(item)));
    const hasContent = cards.length > 0 || localSubmissions.length > 0;
    const viewChanged = filter !== "all" || sort !== "custom";
    const mutationError = (code: string | null) => code && errors.has(code) ? errors(code!) : t("deleteError");

    function toggle(item: GalleryItem, range = false) {
        const key = galleryKey(item);
        const anchor = lastSelected.current;
        setSelected(current => {
            const next = new Set(current);
            const first = visible.findIndex(candidate => galleryKey(candidate) === anchor), last = visible.findIndex(candidate => galleryKey(candidate) === key);
            const keys = range && first >= 0 ? visible.slice(Math.min(first, last), Math.max(first, last) + 1).map(galleryKey) : [key];
            for (const candidate of keys) { if (current.has(key)) next.delete(candidate); else next.add(candidate); }
            return next;
        });
        lastSelected.current = key;
    }
    function selectVisible() {
        setSelected(current => { const next = new Set(current); for (const item of visible) { if (allSelected) next.delete(galleryKey(item)); else next.add(galleryKey(item)); } return next; });
    }
    function clearSelection() { setSelected(new Set()); lastSelected.current = null; }
    function requestDelete(items: GalleryReference[]) {
        deleteOpener.current = document.activeElement as HTMLElement;
        setError(null); setDeleting(items.map(({ taskId, index }) => ({ taskId, index })));
    }
    function downloadSelected() {
        // Browsers only start several downloads when they are spaced out, each from its own link.
        selectedItems.flatMap(item => item.preview ? [item.preview.downloadUrl] : []).forEach((href, position) => setTimeout(() => {
            const link = Object.assign(document.createElement("a"), { href, download: "" });
            document.body.append(link); link.click(); link.remove();
        }, position * 300));
    }
    const mutate = (action: "delete" | "reorder", items: GalleryReference[]) => galleryMutation(mode, action, items);
    async function remove() {
        if (!deleting || busy) return;
        setBusy(true); setError(null);
        try {
            await mutate("delete", deleting);
            await history.removeGalleryItems(deleting);
            deleteOpener.current = resultsRegion.current;
            setSelected(current => new Set([...current].filter(key => !deleting.some(item => galleryKey(item) === key))));
            setAnnouncement(t("deletedCount", { count: deleting.length }));
            setDeleting(null);
            void history.mutate().catch(() => undefined);
        } catch (failure) { setError(failure instanceof Error ? failure.message : "ERR_GENERIC"); }
        finally { setBusy(false); }
    }
    function move(source: string, target: string) {
        setOver(null); setDragging(null);
        if (source === target || !reorderable) return;
        void persistOrder(moveGalleryItem(arranged, source, target), source);
    }
    /** Shows the new order at once and saves it; a failed save puts the previous order back. */
    async function persistOrder(next: GalleryItem[], moved: string) {
        setArrangement(next.map(galleryKey)); setError(null); setSaving(true);
        setAnnouncement(t("itemMoved", { position: next.findIndex(item => galleryKey(item) === moved) + 1 }));
        try {
            const items = next.filter(canReorder).map(({ taskId, index }) => ({ taskId, index }));
            const rankBase = await mutate("reorder", items);
            await history.reorderGalleryItems(items, rankBase);
            setArrangement(null); setAnnouncement(t("orderSaved"));
            void history.mutate().catch(() => undefined);
        } catch (failure) { setArrangement(null); setError(failure instanceof Error ? failure.message : "ERR_GENERIC"); }
        finally { setSaving(false); }
    }

    // While selecting, the same header row swaps its tools instead of covering the images with a bar.
    const selectionTools = <div className="flex min-w-0 items-center gap-0.5 sm:gap-1">
        <Button type="button" variant="ghost" size="icon-sm" className="size-8" aria-label={t("cancelSelection")} title={t("cancelSelection")} onClick={clearSelection}><X className="size-4" /></Button>
        <span className="whitespace-nowrap px-1 text-xs font-semibold tabular-nums"><span aria-hidden="true" className="sm:hidden">{selectedItems.length}</span><span className="max-sm:sr-only">{t("selectedCount", { count: selectedItems.length })}</span></span>
        <Button type="button" variant="ghost" size="sm" className="h-8" title={t(allSelected ? "deselectVisible" : "selectVisible")} onClick={selectVisible}><CheckCheck className="size-4" /><span className="max-md:sr-only">{t(allSelected ? "deselectVisible" : "selectVisible")}</span></Button>
        {selectedItems.some(item => item.preview) && <Button type="button" variant="ghost" size="sm" className="h-8" title={t("downloadSelected")} onClick={downloadSelected}><Download className="size-4" /><span className="max-md:sr-only">{t("downloadSelected")}</span></Button>}
        <Button type="button" variant="destructive" size="sm" className="h-8" title={t("deleteSelected")} disabled={busy} onClick={() => requestDelete(selectedItems)}><Trash2 className="size-4" /><span className="max-md:sr-only">{t("deleteSelected")}</span></Button>
    </div>;
    const browseTools = <div className="flex min-w-0 items-center gap-1">
        {/* The field stays open from small tablets up; on phones it folds into an icon that opens it over the header. */}
        <div className={`relative min-w-0 items-center ${searchOpen ? "flex max-sm:absolute max-sm:left-2 max-sm:right-[5.75rem] max-sm:top-1.5 max-sm:z-20" : "hidden sm:flex"}`}>
            <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
            <input ref={searchInput} type="search" aria-label={t("searchGallery")} placeholder={t("searchGallery")} value={search} onChange={event => setSearch(event.target.value)}
                onKeyDown={event => { if (event.key === "Escape") { setSearch(""); setSearchOpen(false); event.currentTarget.blur(); } }} onBlur={() => { if (!search) setSearchOpen(false); }}
                className="h-9 w-full min-w-0 rounded-lg border border-white/10 bg-[#141618] pl-8 pr-8 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60 sm:h-8 sm:w-44 lg:w-64 [&::-webkit-search-cancel-button]:hidden" />
            {(search || searchOpen) && <button type="button" aria-label={t("clearSearch")} onMouseDown={event => event.preventDefault()} onClick={() => { setSearch(""); setSearchOpen(false); }} className="absolute right-1.5 grid size-6 place-items-center rounded-md text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>}
        </div>
        {/* Preview size, like a photo app's zoom slider; phones get the same control inside the view options. */}
        <div className="mx-1 hidden w-32 items-center gap-2 text-muted-foreground md:flex lg:w-40" title={t("densityLabel")}>
            <ImageIcon aria-hidden="true" className="size-3 shrink-0" />
            <Slider min={ROW_MIN} max={ROW_MAX} step={10} value={[rowSize]} onValueChange={value => setRowSize(Array.isArray(value) ? value[0] : value)} thumbLabel={t("densityLabel")} />
            <ImageIcon aria-hidden="true" className="size-4 shrink-0" />
        </div>
        {!searchOpen && <Button type="button" variant="ghost" size="icon-sm" className="sm:hidden" aria-label={t("searchGallery")} title={t("searchGallery")} onClick={() => setSearchOpen(true)}><Search className="size-4" /></Button>}
        <Popover>
            <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={t("viewOptions")} title={t("viewOptions")} className="relative" />}>
                <SlidersHorizontal className="size-4" />{viewChanged && <span aria-hidden="true" className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 gap-3 border border-white/10 bg-[#141618] p-3">
                <label className="grid gap-1.5 text-[11px] font-medium text-muted-foreground">{t("statusLabel")}
                    <select aria-label={t("filterGallery")} value={filter} onChange={event => setFilter(event.target.value)} className="h-9 rounded-lg border border-white/10 bg-[#0d0f10] px-2.5 text-sm text-foreground">{["all", "completed", "pending", "failed"].map(value => <option key={value} value={value}>{t(`filters.${value}`)}</option>)}</select>
                </label>
                <label className="grid gap-1.5 text-[11px] font-medium text-muted-foreground">{t("orderLabel")}
                    <select aria-label={t("sortGallery")} value={sort} onChange={event => setSort(event.target.value)} className="h-9 rounded-lg border border-white/10 bg-[#0d0f10] px-2.5 text-sm text-foreground">{["custom", "newest", "oldest"].map(value => <option key={value} value={value}>{t(`sorts.${value}`)}</option>)}</select>
                </label>
                <div className="grid gap-2.5 text-[11px] font-medium text-muted-foreground md:hidden">{t("densityLabel")}
                    <div className="flex items-center gap-2.5 px-1"><ImageIcon aria-hidden="true" className="size-3 shrink-0" />
                        <Slider min={ROW_MIN} max={ROW_MAX} step={10} value={[rowSize]} onValueChange={value => setRowSize(Array.isArray(value) ? value[0] : value)} thumbLabel={t("densityLabel")} />
                        <ImageIcon aria-hidden="true" className="size-4 shrink-0" /></div>
                </div>
            </PopoverContent>
        </Popover>
    </div>;
    const toolbar = hasContent && (selecting ? selectionTools : browseTools);

    return <section ref={resultsRegion} tabIndex={-1} aria-label={t("feedTitle")} className="relative h-full overflow-y-auto overscroll-contain outline-none" onKeyDown={event => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target as HTMLElement).closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); selectVisible(); }
        if (event.key === "Escape" && !busy) clearSelection();
    }}>
        <HeaderToolbar>{toolbar}</HeaderToolbar>
        <h1 className="sr-only">{t("feedTitle")}</h1>
        <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
        {history.isLoading && <p role="status" className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("loadingHistory")}</p>}
        {history.error && <div role="alert" className="mx-auto max-w-2xl p-6 text-center text-sm text-destructive"><p>{t("historyError")}</p><Button type="button" variant="outline" className="mt-4" onClick={() => void history.mutate().catch(() => undefined)}>{t("retryHistory")}</Button></div>}
        {error && !deleting && <p role="alert" className="px-3 pt-2 text-xs text-destructive">{errors.has(error) ? errors(error) : t("orderError")}</p>}
        {!hasContent && !history.isLoading && !history.error ? empty : hasContent && <div data-gallery-grid style={{ "--row-size": `${rowSize}px` } as React.CSSProperties} className="flex flex-wrap gap-1 p-1 [--row:calc(var(--row-size)*0.6)] sm:gap-1.5 sm:p-1.5 sm:[--row:var(--row-size)]">
            {localSubmissions.map(item => <SubmissionTile key={item.id} submission={item} ratio={mode === "video" ? 16 / 9 : 1} />)}
            {visible.map(item => {
                const key = galleryKey(item), position = sortable.findIndex(candidate => galleryKey(candidate) === key);
                const movable = reorderable && canReorder(item);
                return <GalleryTile key={key} item={item} selected={selected.has(key)} selecting={selecting} dragging={dragging === key} over={over === key}
                    canMoveBefore={movable && position > 0} canMoveAfter={movable && position >= 0 && position < sortable.length - 1}
                    onSelect={range => toggle(item, range)} onDelete={() => requestDelete([item])}
                    onReusePrompt={onReusePrompt && item.task.prompt ? () => onReusePrompt(item.task.prompt!) : undefined}
                    onSendImage={onSendImage && item.preview?.mediaType === "image" ? target => onSendImage(item.preview!.url, target) : undefined}
                    onPreview={() => { opener.current = document.activeElement as HTMLElement; setPreview({ items: allOutputs, index: allOutputs.findIndex(output => output.url === item.preview?.url) }); }}
                    onDragStart={event => {
                        // One gesture serves both drops: another tile reorders, the prompt receives the image as a reference.
                        if (movable) event.dataTransfer.setData(GALLERY_DRAG_TYPE, key);
                        if (item.preview?.mediaType === "image") writeImageTransfer(event.dataTransfer, item.preview.url);
                        event.dataTransfer.effectAllowed = "copyMove";
                        setDragging(key);
                    }}
                    onOver={event => { if (movable && dragging !== key && event.dataTransfer.types.includes(GALLERY_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(key); } }}
                    onLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(current => current === key ? null : current); }}
                    onDrop={event => { if (movable && event.dataTransfer.types.includes(GALLERY_DRAG_TYPE)) { event.preventDefault(); move(event.dataTransfer.getData(GALLERY_DRAG_TYPE), key); } }}
                    onDragEnd={() => { setDragging(null); setOver(null); }}
                    onMove={direction => { const target = sortable[position + direction]; if (target) move(key, galleryKey(target)); }} />;
            })}
            {/* Absorbs the leftover width of the last row so its tiles keep their natural size. */}
            <div aria-hidden="true" className="h-0 basis-0" style={{ flexGrow: 1e6 }} />
            {!visible.length && cards.length > 0 && <p role="status" className="w-full py-16 text-center text-sm text-muted-foreground">{t("noMatches")}</p>}
        </div>}
        {history.hasMore && <div className="flex justify-center p-5"><Button type="button" variant="outline" disabled={history.isLoadingMore || Boolean(history.error)} onClick={() => void history.loadMore()}>{history.isLoadingMore && <Loader2 className="animate-spin" />}{t(history.isLoadingMore ? "loadingHistory" : "loadMore")}</Button></div>}
        <ConfirmDialog returnFocus={deleteOpener} open={Boolean(deleting)} onClose={() => { if (!busy) { setDeleting(null); setError(null); } }} onConfirm={() => void remove()} busy={busy} title={deleting?.length === 1 ? t("deleteTitle") : t("deleteManyTitle", { count: deleting?.length ?? 0 })} description={t("deleteAssetsHint")} error={error && deleting ? mutationError(error) : undefined} confirmLabel={t("deleteConfirm")} cancelLabel={t("cancel")} />
        {preview && preview.index >= 0 && <Lightbox items={preview.items} index={preview.index} returnFocus={opener} actions={{
            onReusePrompt: onReusePrompt ? item => item.prompt && onReusePrompt(item.prompt) : undefined,
            onSendImage: onSendImage ? (item, target) => onSendImage(item.url, target) : undefined,
            onDelete: item => {
                const owner = cards.find(card => card.preview?.url === item.url);
                if (!owner) return;
                setPreview(null); setError(null);
                deleteOpener.current = resultsRegion.current;
                setDeleting([{ taskId: owner.taskId, index: owner.index }]);
            },
        }} onClose={() => setPreview(null)} onNext={() => setPreview(current => current && ({ ...current, index: (current.index + 1) % current.items.length }))} onPrev={() => setPreview(current => current && ({ ...current, index: (current.index - 1 + current.items.length) % current.items.length }))} />}
    </section>;
}

/** A justified-row tile: it grows in proportion to its aspect ratio, so every tile in a row ends up with the same height. */
function tileStyle(ratio: number): React.CSSProperties {
    return { flexGrow: ratio, flexBasis: `calc(var(--row) * ${ratio})`, aspectRatio: String(ratio) };
}

function Hint({ label, children }: { label: string; children: React.ReactElement }) {
    return <Tooltip><TooltipTrigger render={children} /><TooltipContent side="left">{label}</TooltipContent></Tooltip>;
}

function GalleryTile({ item, selected, selecting, dragging, over, canMoveBefore, canMoveAfter, onSelect, onDelete, onPreview, onReusePrompt, onSendImage, onDragStart, onOver, onLeave, onDrop, onDragEnd, onMove }: {
    item: GalleryItem; selected: boolean; selecting: boolean; dragging: boolean; over: boolean; canMoveBefore: boolean; canMoveAfter: boolean;
    onSelect: (range: boolean) => void; onDelete: () => void; onPreview: () => void; onReusePrompt?: () => void; onSendImage?: (target: ImageTarget) => void;
    onDragStart: (event: React.DragEvent) => void; onOver: (event: React.DragEvent) => void; onLeave: (event: React.DragEvent) => void; onDrop: (event: React.DragEvent) => void; onDragEnd: () => void; onMove: (direction: number) => void;
}) {
    const t = useTranslations("tasks");
    const errors = useTranslations("errors");
    const task = item.task, preview = item.preview;
    const elapsed = useTaskRefresh(task);
    const video = useRef<HTMLVideoElement>(null);
    const fallback = task.media_type === "video" ? 16 / 9 : 1;
    const [ratio, setRatio] = useState(() => (preview && ratios.get(preview.url)) || fallback);
    const status = task.status ?? task.freepik_status ?? "CREATED";
    const pending = status === "CREATED" || status === "IN_PROGRESS";
    const rawError = task.error_message ?? "";
    const failure = task.recovery_required ? t("recoveryRequired") : errors.has(rawError) ? errors(rawError) : t("failureFallback");
    const technicalError = !pending && !preview && rawError && !errors.has(rawError) && !["error", "failed", "cancelled"].includes(rawError.toLowerCase()) ? rawError : undefined;
    const name = `${item.model}${item.index !== null ? ` (${item.index + 1})` : ""}`;
    const measured = (width: number, height: number) => {
        if (!preview || !width || !height) return;
        const next = clampRatio(width / height);
        ratios.set(preview.url, next); setRatio(next);
    };
    const showActions = !selecting;
    const draggable = !selecting && (Boolean(preview) || canMoveBefore || canMoveAfter);

    return <article data-gallery-key={galleryKey(item)} aria-label={name} draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={onOver} onDragLeave={onLeave} onDrop={onDrop} style={tileStyle(ratio)}
        onMouseEnter={() => { if (!selecting) void video.current?.play().catch(() => undefined); }}
        onMouseLeave={() => { if (video.current) { video.current.pause(); video.current.currentTime = 0; } }}
        className={`group/tile @container relative min-w-0 overflow-hidden rounded-lg bg-white/[.04] transition-[opacity,box-shadow] ${selected || over ? "outline-2 -outline-offset-2 outline-primary" : ""} ${dragging ? "opacity-40" : ""}`}>
        {preview ? <button type="button" aria-label={`${t("preview")} - ${name}`} title={selecting ? undefined : t("dragImageHint")} onClick={event => { if (selecting || event.shiftKey || event.ctrlKey || event.metaKey) onSelect(event.shiftKey); else onPreview(); }}
            className={`absolute inset-0 block size-full overflow-hidden focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${selecting ? "cursor-pointer" : "cursor-zoom-in"}`}>
            {preview.mediaType === "video"
                ? <video ref={video} src={preview.url} muted loop playsInline preload="metadata" onLoadedMetadata={event => measured(event.currentTarget.videoWidth, event.currentTarget.videoHeight)} className={`size-full object-cover transition-transform duration-200 ${selected ? "scale-[.94] rounded-md" : ""}`} />
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={preview.url} alt={t("imageAlt", { index: (item.index ?? 0) + 1 })} draggable={false} loading="lazy" onLoad={event => measured(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} className={`size-full object-cover transition-transform duration-200 ${selected ? "scale-[.94] rounded-md" : ""}`} />}
            {preview.mediaType === "video" && <span aria-hidden="true" className="absolute bottom-2 left-2 grid size-6 place-items-center rounded-full bg-black/60 transition-opacity group-hover/tile:opacity-0"><Play className="ml-px size-3 fill-current" /></span>}
        </button> : <div role={pending ? "status" : undefined} title={technicalError} className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-hidden bg-[radial-gradient(circle_at_center,rgba(255,255,255,.05),transparent_70%)] p-4 text-center">
            {pending ? <><Loader2 aria-hidden="true" className="size-6 animate-spin text-primary" /><p className="text-xs">{t("waiting")}</p><p className="text-[11px] tabular-nums text-muted-foreground">{t("status.IN_PROGRESS")} · {t("elapsed", { seconds: elapsed })}</p></>
                : <><AlertCircle aria-hidden="true" className="size-5 shrink-0 text-destructive" /><p className="line-clamp-4 text-[11px] leading-relaxed text-destructive/90">{status === "COMPLETED" ? t("noOutput") : failure}</p></>}
        </div>}

        {/* Soft shading keeps the hover controls legible on bright images without covering the picture at rest. */}
        <span aria-hidden="true" className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent [@media(hover:none)]:h-14 [@media(hover:none)]:from-black/35 ${selecting && !selected ? "opacity-100" : revealOnHover}`} />
        {preview && onSendImage && showActions && <span aria-hidden="true" className={`pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/50 to-transparent ${revealOnHover} ${desktopOnly}`} />}

        <button type="button" role="checkbox" aria-checked={selected} aria-label={t("selectItem", { name })} onClick={event => onSelect(event.shiftKey)}
            className={`absolute left-2 top-2 z-[1] grid size-6 place-items-center rounded-full border-2 shadow transition-[opacity,background-color] focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-primary ${selected ? "border-primary bg-primary text-primary-foreground" : `border-white/80 bg-black/25 text-transparent hover:bg-black/50 ${selecting ? "opacity-100" : revealOnHover}`}`}>
            <Check strokeWidth={3} className="size-3.5" />
        </button>

        {showActions && <div className={`absolute right-2 top-2 z-[1] flex flex-col gap-1.5 ${revealOnHover}`}>
            {preview && <Hint label={t(preview.mediaType === "video" ? "downloadVideo" : "downloadImage")}><a href={preview.downloadUrl} download aria-label={t(preview.mediaType === "video" ? "downloadVideo" : "downloadImage")} className={`${roundAction} ${desktopOnly}`}><Download className="size-4" /></a></Hint>}
            {onReusePrompt && <Hint label={t("reusePrompt")}><button type="button" aria-label={t("reusePrompt")} onClick={onReusePrompt} className={`${roundAction} ${desktopOnly}`}><Copy className="size-4" /></button></Hint>}
            <Hint label={t("delete")}><button type="button" aria-label={t("delete")} onClick={onDelete} className={`${roundAction} ${desktopOnly}`}><Trash2 className="size-4" /></button></Hint>
            <DropdownMenu>
                <DropdownMenuTrigger aria-label={t("moreActions")} className={roundAction}><MoreHorizontal className="size-4" /></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 p-1.5">
                    {preview && <DropdownMenuItem className="min-h-9" onClick={onPreview}><ArrowUpRight />{t("open")}</DropdownMenuItem>}
                    {onReusePrompt && <DropdownMenuItem className="min-h-9" onClick={onReusePrompt}><Copy />{t("reusePrompt")}</DropdownMenuItem>}
                    {onSendImage && <>
                        <DropdownMenuItem className="min-h-9" onClick={() => onSendImage("reference")}><ImagePlus />{t("useAsReference")}</DropdownMenuItem>
                        <DropdownMenuItem className="min-h-9" onClick={() => onSendImage("start")}><Clapperboard />{t("animateFromStart")}</DropdownMenuItem>
                        <DropdownMenuItem className="min-h-9" onClick={() => onSendImage("end")}><Clapperboard />{t("animateToEnd")}</DropdownMenuItem>
                    </>}
                    {(canMoveBefore || canMoveAfter) && <><DropdownMenuSeparator />
                        {canMoveBefore && <DropdownMenuItem className="min-h-9" onClick={() => onMove(-1)}><ArrowLeft />{t("moveBefore")}</DropdownMenuItem>}
                        {canMoveAfter && <DropdownMenuItem className="min-h-9" onClick={() => onMove(1)}><ArrowRight />{t("moveAfter")}</DropdownMenuItem>}
                    </>}
                    {preview && <><DropdownMenuSeparator /><DropdownMenuItem className="min-h-9" render={<a href={preview.downloadUrl} download />}><Download />{t("download")}</DropdownMenuItem></>}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" className="min-h-9" onClick={onDelete}><Trash2 />{t("delete")}</DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>}

        {preview && onSendImage && showActions && <div className={`absolute inset-x-2 bottom-2 z-[1] hidden items-center justify-end gap-1.5 @min-[230px]:flex [@media(hover:none)]:hidden! ${revealOnHover}`}>
            <button type="button" onClick={() => onSendImage("reference")} className="flex h-8 items-center gap-1.5 rounded-full bg-black/55 px-3 text-xs font-semibold text-white backdrop-blur-md hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-primary"><ImagePlus className="size-3.5" />{t("reference")}</button>
            <DropdownMenu>
                <DropdownMenuTrigger className="flex h-8 items-center gap-1.5 rounded-full bg-black/55 pl-3 pr-2 text-xs font-semibold text-white backdrop-blur-md hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-primary"><Clapperboard className="size-3.5" />{t("animate")}<ChevronDown className="size-3.5 opacity-70" /></DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end" className="w-44 p-1.5">
                    <DropdownMenuGroup>
                        <DropdownMenuLabel className="px-2 py-1 text-[11px] text-muted-foreground">{t("framePlacement")}</DropdownMenuLabel>
                        <DropdownMenuItem className="min-h-9" onClick={() => onSendImage("start")}>{t("startFrame")}</DropdownMenuItem>
                        <DropdownMenuItem className="min-h-9" onClick={() => onSendImage("end")}>{t("endFrame")}</DropdownMenuItem>
                    </DropdownMenuGroup>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>}

    </article>;
}

function SubmissionTile({ submission, ratio }: { submission: BackgroundSubmission; ratio: number }) {
    const t = useTranslations("tasks");
    const errors = useTranslations("errors");
    const { modelLabel } = useModelCopy();
    const pending = !submission.outcome || submission.outcome.accepted;
    const message = submission.outcome?.error ?? "ERR_GENERIC";
    return <article data-submission-id={submission.id} aria-label={modelLabel(submission.model)} style={tileStyle(ratio)} className="group/tile relative min-w-0 overflow-hidden rounded-lg bg-white/[.04]">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center" role={pending ? "status" : "alert"} title={submission.prompt}>
            {pending ? <><Loader2 aria-hidden="true" className="size-6 animate-spin text-primary" /><p className="text-xs">{t(submission.outcome ? "waiting" : "sending")}</p><p className="text-[11px] text-muted-foreground">{t("backgroundHint")}</p></>
                : <><AlertCircle aria-hidden="true" className="size-5 text-destructive" /><p className="line-clamp-4 text-[11px] leading-relaxed text-destructive/90">{errors.has(message) ? errors(message) : errors("ERR_GENERIC")}</p></>}
        </div>
        {!pending && <button type="button" aria-label={t("dismissSubmission")} onClick={() => dismissSubmission(submission.id)} className={`absolute right-2 top-2 ${roundAction} ${revealOnHover}`}><Trash2 className="size-4" /></button>}
    </article>;
}
