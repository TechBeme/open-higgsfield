"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpRight, Check, CheckCheck, ChevronDown, Clapperboard, Copy, Download, GripVertical, ImagePlus, Loader2, MoreHorizontal, Play, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useModelCopy } from "@/i18n/use-model-copy";
import { useRuntimeModels } from "@/features/catalog/hooks/useRuntimeModels";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
    const [compact, setCompact] = useState(false);
    const [organizing, setOrganizing] = useState(false);
    const [arrangement, setArrangement] = useState<string[] | null>(null);
    const [dragging, setDragging] = useState<string | null>(null);
    const [over, setOver] = useState<string | null>(null);
    const [announcement, setAnnouncement] = useState("");
    const lastSelected = useRef<string | null>(null);
    const deleteOpener = useRef<HTMLElement | null>(null);
    const resultsRegion = useRef<HTMLElement | null>(null);
    const opener = useRef<HTMLElement | null>(null);
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
    const visible = sort === "custom" || organizing ? filtered : [...filtered].sort((a, b) => (sort === "newest" ? -1 : 1) * (Date.parse(a.task.created_at) - Date.parse(b.task.created_at)) || (a.index ?? 0) - (b.index ?? 0));
    const allOutputs = visible.flatMap(item => item.preview ? [item.preview] : []);
    const selectedItems = cards.filter(item => selected.has(galleryKey(item)));
    const selecting = selectedItems.length > 0;
    const sortable = arranged.filter(canReorder);
    const allSelected = visible.length > 0 && visible.every(item => selected.has(galleryKey(item)));
    const hasContent = cards.length > 0 || localSubmissions.length > 0;
    const viewChanged = filter !== "all" || sort !== "custom" || compact;
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
    async function mutate(action: "delete" | "reorder", items: GalleryReference[]) {
        const response = await fetch("/api/gallery", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, mediaType: mode, items }) });
        const result = await response.json().catch(() => null);
        if (!response.ok || result?.ok !== true) throw new Error(typeof result?.error === "string" ? result.error : "ERR_GENERIC");
        return typeof result.rankBase === "number" && Number.isFinite(result.rankBase) ? result.rankBase : Date.now();
    }
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
        const next = moveGalleryItem(arranged, source, target);
        setArrangement(next.map(galleryKey)); setOver(null); setDragging(null);
        setAnnouncement(t("itemMoved", { position: next.findIndex(item => galleryKey(item) === source) + 1 }));
    }
    async function saveOrder() {
        if (!arrangement || busy) return;
        setBusy(true); setError(null);
        try {
            const items = sortable.map(({ taskId, index }) => ({ taskId, index }));
            const rankBase = await mutate("reorder", items);
            await history.reorderGalleryItems(items, rankBase);
            setOrganizing(false); setArrangement(null); setAnnouncement(t("orderSaved"));
            void history.mutate().catch(() => undefined);
        } catch (failure) { setError(failure instanceof Error ? failure.message : "ERR_GENERIC"); }
        finally { setBusy(false); }
    }
    function startOrganizing() {
        setOrganizing(true); setArrangement(null); setSearch(""); setSearchOpen(false); setFilter("all"); setSort("custom"); setError(null); clearSelection();
    }

    // While selecting or organizing, the same header row swaps its tools instead of covering the images with a bar.
    const selectionTools = <div className="flex min-w-0 items-center gap-0.5 sm:gap-1">
        <Button type="button" variant="ghost" size="icon-sm" className="size-8" aria-label={t("cancelSelection")} title={t("cancelSelection")} onClick={clearSelection}><X className="size-4" /></Button>
        <span className="whitespace-nowrap px-1 text-xs font-semibold tabular-nums"><span aria-hidden="true" className="sm:hidden">{selectedItems.length}</span><span className="max-sm:sr-only">{t("selectedCount", { count: selectedItems.length })}</span></span>
        <Button type="button" variant="ghost" size="sm" className="h-8" title={t(allSelected ? "deselectVisible" : "selectVisible")} onClick={selectVisible}><CheckCheck className="size-4" /><span className="max-md:sr-only">{t(allSelected ? "deselectVisible" : "selectVisible")}</span></Button>
        {selectedItems.some(item => item.preview) && <Button type="button" variant="ghost" size="sm" className="h-8" title={t("downloadSelected")} onClick={downloadSelected}><Download className="size-4" /><span className="max-md:sr-only">{t("downloadSelected")}</span></Button>}
        <Button type="button" variant="destructive" size="sm" className="h-8" title={t("deleteSelected")} disabled={busy} onClick={() => requestDelete(selectedItems)}><Trash2 className="size-4" /><span className="max-md:sr-only">{t("deleteSelected")}</span></Button>
    </div>;
    const organizeTools = <div className="flex min-w-0 items-center gap-1">
        <span className="truncate px-2 text-xs text-muted-foreground max-lg:sr-only">{t("organizeHint")}</span>
        <Button type="button" variant="ghost" size="sm" className="h-8" disabled={busy} onClick={() => { setOrganizing(false); setArrangement(null); setError(null); }}>{t("cancel")}</Button>
        <Button type="button" size="sm" className="h-8" disabled={!arrangement || busy} onClick={() => void saveOrder()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{t("saveOrder")}</Button>
    </div>;
    const browseTools = <div className="flex min-w-0 items-center gap-1">
        {searchOpen || search ? <div className="relative flex min-w-0 items-center max-sm:absolute max-sm:left-2 max-sm:right-[5.75rem] max-sm:top-1.5 max-sm:z-20">
            <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
            <input type="search" autoFocus aria-label={t("searchGallery")} placeholder={t("searchGallery")} value={search} onChange={event => setSearch(event.target.value)}
                onKeyDown={event => { if (event.key === "Escape") { setSearch(""); setSearchOpen(false); } }} onBlur={() => { if (!search) setSearchOpen(false); }}
                className="h-9 w-full min-w-0 rounded-lg border border-white/10 bg-[#141618] pl-8 pr-8 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/60 sm:h-8 sm:w-60 [&::-webkit-search-cancel-button]:hidden" />
            <button type="button" aria-label={t("clearSearch")} onMouseDown={event => event.preventDefault()} onClick={() => { setSearch(""); setSearchOpen(false); }} className="absolute right-1.5 grid size-6 place-items-center rounded-md text-muted-foreground hover:text-foreground"><X className="size-3.5" /></button>
        </div> : <Button type="button" variant="ghost" size="icon-sm" aria-label={t("searchGallery")} title={t("searchGallery")} onClick={() => setSearchOpen(true)}><Search className="size-4" /></Button>}
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
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-[#0d0f10] p-1" role="group" aria-label={t("densityLabel")}>
                    {[false, true].map(value => <button key={String(value)} type="button" aria-pressed={compact === value} onClick={() => setCompact(value)} className={`h-8 rounded-md text-xs font-medium ${compact === value ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{t(value ? "compactGrid" : "comfortableGrid")}</button>)}
                </div>
                {cards.length > 1 && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={startOrganizing}><GripVertical className="size-4" />{t("organize")}</Button>}
            </PopoverContent>
        </Popover>
    </div>;
    const toolbar = hasContent && (organizing ? organizeTools : selecting ? selectionTools : browseTools);

    return <section ref={resultsRegion} tabIndex={-1} aria-label={t("feedTitle")} className="relative h-full overflow-y-auto overscroll-contain outline-none" onKeyDown={event => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target as HTMLElement).closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
        if (!organizing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); selectVisible(); }
        if (event.key === "Escape" && !busy) clearSelection();
    }}>
        <HeaderToolbar>{toolbar}</HeaderToolbar>
        <h1 className="sr-only">{t("feedTitle")}</h1>
        <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
        {history.isLoading && <p role="status" className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("loadingHistory")}</p>}
        {history.error && <div role="alert" className="mx-auto max-w-2xl p-6 text-center text-sm text-destructive"><p>{t("historyError")}</p><Button type="button" variant="outline" className="mt-4" onClick={() => void history.mutate().catch(() => undefined)}>{t("retryHistory")}</Button></div>}
        {error && !deleting && <p role="alert" className="px-3 pt-2 text-xs text-destructive">{errors.has(error) ? errors(error) : t("orderError")}</p>}
        {!hasContent && !history.isLoading && !history.error ? empty : hasContent && <div className={`flex flex-wrap gap-1 p-1 sm:gap-1.5 sm:p-1.5 ${compact ? "[--row:80px] sm:[--row:130px] xl:[--row:160px]" : "[--row:112px] sm:[--row:190px] xl:[--row:230px]"}`}>
            {localSubmissions.map(item => <SubmissionTile key={item.id} submission={item} ratio={mode === "video" ? 16 / 9 : 1} />)}
            {visible.map(item => <GalleryTile key={galleryKey(item)} item={item} selected={selected.has(galleryKey(item))} selecting={selecting} organizing={organizing} position={sortable.findIndex(candidate => galleryKey(candidate) === galleryKey(item))} total={sortable.length} dragging={dragging === galleryKey(item)} over={over === galleryKey(item)}
                onSelect={range => toggle(item, range)} onDelete={() => requestDelete([item])}
                onReusePrompt={onReusePrompt && item.task.prompt ? () => onReusePrompt(item.task.prompt!) : undefined}
                onSendImage={onSendImage && item.preview?.mediaType === "image" ? target => onSendImage(item.preview!.url, target) : undefined}
                onPreview={() => { opener.current = document.activeElement as HTMLElement; setPreview({ items: allOutputs, index: allOutputs.findIndex(output => output.url === item.preview?.url) }); }}
                onDrag={event => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(GALLERY_DRAG_TYPE, galleryKey(item)); setDragging(galleryKey(item)); }}
                onOver={event => { if (organizing && canReorder(item) && event.dataTransfer.types.includes(GALLERY_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(galleryKey(item)); } }}
                onDrop={event => { if (organizing && canReorder(item) && event.dataTransfer.types.includes(GALLERY_DRAG_TYPE)) { event.preventDefault(); event.stopPropagation(); move(event.dataTransfer.getData(GALLERY_DRAG_TYPE), galleryKey(item)); } }}
                onDragEnd={() => { setDragging(null); setOver(null); }}
                onMove={direction => { const position = sortable.findIndex(candidate => galleryKey(candidate) === galleryKey(item)); const target = sortable[position + direction]; if (target) move(galleryKey(item), galleryKey(target)); }} />)}
            {/* Absorbs the leftover width of the last row so its tiles keep their natural size. */}
            <div aria-hidden="true" className="h-0 basis-0" style={{ flexGrow: 1e6 }} />
            {!visible.length && cards.length > 0 && <p role="status" className="w-full py-16 text-center text-sm text-muted-foreground">{t("noMatches")}</p>}
        </div>}
        {history.hasMore && <div className="flex justify-center p-5"><Button type="button" variant="outline" disabled={history.isLoadingMore || Boolean(history.error) || organizing} onClick={() => void history.loadMore()}>{history.isLoadingMore && <Loader2 className="animate-spin" />}{t(history.isLoadingMore ? "loadingHistory" : "loadMore")}</Button></div>}
        <ConfirmDialog returnFocus={deleteOpener} open={Boolean(deleting)} onClose={() => { if (!busy) { setDeleting(null); setError(null); } }} onConfirm={() => void remove()} busy={busy} title={deleting?.length === 1 ? t("deleteTitle") : t("deleteManyTitle", { count: deleting?.length ?? 0 })} description={t("deleteAssetsHint")} error={error && deleting ? mutationError(error) : undefined} confirmLabel={t("deleteConfirm")} cancelLabel={t("cancel")} />
        {preview && preview.index >= 0 && <Lightbox items={preview.items} index={preview.index} returnFocus={opener} onClose={() => setPreview(null)} onNext={() => setPreview(current => current && ({ ...current, index: (current.index + 1) % current.items.length }))} onPrev={() => setPreview(current => current && ({ ...current, index: (current.index - 1 + current.items.length) % current.items.length }))} />}
    </section>;
}

/** A justified-row tile: it grows in proportion to its aspect ratio, so every tile in a row ends up with the same height. */
function tileStyle(ratio: number): React.CSSProperties {
    return { flexGrow: ratio, flexBasis: `calc(var(--row) * ${ratio})`, aspectRatio: String(ratio) };
}

function Hint({ label, children }: { label: string; children: React.ReactElement }) {
    return <Tooltip><TooltipTrigger render={children} /><TooltipContent side="left">{label}</TooltipContent></Tooltip>;
}

function GalleryTile({ item, selected, selecting, organizing, position, total, dragging, over, onSelect, onDelete, onPreview, onReusePrompt, onSendImage, onDrag, onOver, onDrop, onDragEnd, onMove }: {
    item: GalleryItem; selected: boolean; selecting: boolean; organizing: boolean; position: number; total: number; dragging: boolean; over: boolean;
    onSelect: (range: boolean) => void; onDelete: () => void; onPreview: () => void; onReusePrompt?: () => void; onSendImage?: (target: ImageTarget) => void;
    onDrag: (event: React.DragEvent) => void; onOver: (event: React.DragEvent) => void; onDrop: (event: React.DragEvent) => void; onDragEnd: () => void; onMove: (direction: number) => void;
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
    const showActions = !organizing && !selecting;

    return <article data-gallery-key={galleryKey(item)} aria-label={name} onDragOver={onOver} onDrop={onDrop} style={tileStyle(ratio)}
        onMouseEnter={() => { if (!selecting && !organizing) void video.current?.play().catch(() => undefined); }}
        onMouseLeave={() => { if (video.current) { video.current.pause(); video.current.currentTime = 0; } }}
        className={`group/tile @container relative min-w-0 overflow-hidden rounded-lg bg-white/[.04] transition-[opacity,box-shadow] ${selected || over ? "outline-2 -outline-offset-2 outline-primary" : ""} ${dragging ? "opacity-40" : ""}`}>
        {preview ? <button type="button" aria-label={`${t("preview")} - ${name}`} onClick={event => { if (selecting || event.shiftKey || event.ctrlKey || event.metaKey) onSelect(event.shiftKey); else if (!organizing) onPreview(); }}
            draggable={!organizing && !selecting && preview.mediaType === "image"} onDragStart={event => { if (!organizing && !selecting && preview.mediaType === "image") writeImageTransfer(event.dataTransfer, preview.url); }}
            className={`absolute inset-0 block size-full overflow-hidden focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${organizing ? "cursor-default" : selecting ? "cursor-pointer" : "cursor-zoom-in"}`}>
            {preview.mediaType === "video"
                ? <video ref={video} src={preview.url} muted loop playsInline preload="metadata" onLoadedMetadata={event => measured(event.currentTarget.videoWidth, event.currentTarget.videoHeight)} className={`size-full object-cover transition-transform duration-200 ${selected ? "scale-[.94] rounded-md" : ""}`} />
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={preview.url} alt={t("imageAlt", { index: (item.index ?? 0) + 1 })} draggable={!organizing && !selecting} loading="lazy" onLoad={event => measured(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} className={`size-full object-cover transition-transform duration-200 ${selected ? "scale-[.94] rounded-md" : ""}`} />}
            {preview.mediaType === "video" && <span aria-hidden="true" className="absolute bottom-2 left-2 grid size-6 place-items-center rounded-full bg-black/60 transition-opacity group-hover/tile:opacity-0"><Play className="ml-px size-3 fill-current" /></span>}
        </button> : <div role={pending ? "status" : undefined} title={technicalError} className="absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-hidden bg-[radial-gradient(circle_at_center,rgba(255,255,255,.05),transparent_70%)] p-4 text-center">
            {pending ? <><Loader2 aria-hidden="true" className="size-6 animate-spin text-primary" /><p className="text-xs">{t("waiting")}</p><p className="text-[11px] tabular-nums text-muted-foreground">{t("status.IN_PROGRESS")} · {t("elapsed", { seconds: elapsed })}</p></>
                : <><AlertCircle aria-hidden="true" className="size-5 shrink-0 text-destructive" /><p className="line-clamp-4 text-[11px] leading-relaxed text-destructive/90">{status === "COMPLETED" ? t("noOutput") : failure}</p></>}
        </div>}

        {/* Soft shading keeps the hover controls legible on bright images without covering the picture at rest. */}
        <span aria-hidden="true" className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent [@media(hover:none)]:h-14 [@media(hover:none)]:from-black/35 ${selecting && !selected ? "opacity-100" : revealOnHover}`} />
        {preview && onSendImage && showActions && <span aria-hidden="true" className={`pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/50 to-transparent ${revealOnHover} ${desktopOnly}`} />}

        {!organizing && <button type="button" role="checkbox" aria-checked={selected} aria-label={t("selectItem", { name })} onClick={event => onSelect(event.shiftKey)}
            className={`absolute left-2 top-2 z-[1] grid size-6 place-items-center rounded-full border-2 shadow transition-[opacity,background-color] focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-primary ${selected ? "border-primary bg-primary text-primary-foreground" : `border-white/80 bg-black/25 text-transparent hover:bg-black/50 ${selecting ? "opacity-100" : revealOnHover}`}`}>
            <Check strokeWidth={3} className="size-3.5" />
        </button>}

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

        {organizing && canReorder(item) && <div className="absolute inset-x-1.5 bottom-1.5 z-[1] flex items-center justify-between gap-1 rounded-full bg-black/70 p-0.5 text-white backdrop-blur-md">
            <Button type="button" draggable onDragStart={onDrag} onDragEnd={onDragEnd} variant="ghost" size="icon-sm" aria-label={t("dragToReorder", { name })} className="cursor-grab rounded-full active:cursor-grabbing"><GripVertical className="size-4" /></Button>
            <span className="text-[11px] tabular-nums text-white/70">{position + 1}</span>
            <div className="flex"><Button type="button" variant="ghost" size="icon-sm" className="rounded-full" aria-label={t("moveEarlier", { name })} disabled={position === 0} onClick={() => onMove(-1)}><ArrowUp className="size-4" /></Button><Button type="button" variant="ghost" size="icon-sm" className="rounded-full" aria-label={t("moveLater", { name })} disabled={position === total - 1} onClick={() => onMove(1)}><ArrowDown className="size-4" /></Button></div>
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
