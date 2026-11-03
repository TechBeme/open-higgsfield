"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowDown, ArrowUp, ArrowUpRight, Check, CheckSquare, Download, GripVertical, Grid2X2, LayoutGrid, Loader2, Play, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useModelCopy } from "@/i18n/use-model-copy";
import { useRuntimeModels } from "@/features/catalog/hooks/useRuntimeModels";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Lightbox, type PreviewItem } from "./Lightbox";
import { useVideoTasks, revalidateVideoTasks } from "../hooks/useVideoTasks";
import { useImageTasks, revalidateImageTasks } from "../hooks/useImageTasks";
import { useTaskRefresh } from "../hooks/useTaskRefresh";
import type { AnyTask } from "@/types";
import { useBackgroundSubmissions, dismissSubmission, type BackgroundSubmission } from "@/features/studio/lib/background-submissions";
import { writeImageTransfer } from "@/features/studio/lib/media-transfer";
import { GALLERY_DRAG_TYPE, galleryIndices, galleryKey, galleryRank, moveGalleryItem, type GalleryReference } from "@/lib/gallery";
import { attachmentUrl } from "@/lib/download-url";

interface GalleryItem extends GalleryReference { task: AnyTask; model: string; preview?: PreviewItem }
const canReorder = (item: GalleryItem) => !["CREATED", "IN_PROGRESS"].includes(item.task.status ?? item.task.freepik_status ?? "CREATED");
function taskItems(task: AnyTask, model: string): GalleryItem[] {
    const urls = task.media_type === "video" ? task.video_urls ?? task.result_urls ?? [] : task.result_urls ?? [];
    const completed = (task.status ?? task.freepik_status) === "COMPLETED";
    return galleryIndices(task).map(index => ({ taskId: task.task_id, index, task, model, preview: completed && index !== null ? {
        url: task.has_download ? `/api/download/${encodeURIComponent(task.task_id)}?index=${index}&inline=1` : urls[index],
        downloadUrl: attachmentUrl(`/api/download/${encodeURIComponent(task.task_id)}?index=${index}`),
        model, prompt: task.prompt, mediaType: task.media_type,
    } : undefined }));
}

export function ResultsGrid(props: { mode: "image" | "video"; empty: React.ReactNode }) {
    return <Gallery key={props.mode} {...props} />;
}

function Gallery({ mode, empty }: { mode: "image" | "video"; empty: React.ReactNode }) {
    const t = useTranslations("tasks");
    const errors = useTranslations("errors");
    const { modelLabel } = useModelCopy();
    const videoHistory = useVideoTasks();
    const imageHistory = useImageTasks();
    const catalog = useRuntimeModels(mode);
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
    const [selectionMode, setSelectionMode] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [deleting, setDeleting] = useState<GalleryReference[] | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
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
    const cards = useMemo(() => history.tasks.flatMap(task => taskItems(task, modelLabel(catalog.byId[task.model_id]?.label ?? task.provider_capabilities?.label ?? task.model_id)))
        .sort((a, b) => galleryRank(a.task, a.index) - galleryRank(b.task, b.index) || b.taskId.localeCompare(a.taskId)), [history.tasks, catalog.byId, modelLabel]);
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
    const sortable = arranged.filter(canReorder);
    const allSelected = visible.length > 0 && visible.every(item => selected.has(galleryKey(item)));
    const hasContent = cards.length > 0 || localSubmissions.length > 0;
    const mutationError = (code: string | null) => code && errors.has(code) ? errors(code!) : t("deleteError");

    function toggle(item: GalleryItem, range = false) {
        const key = galleryKey(item);
        const anchor = lastSelected.current;
        setSelectionMode(true);
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
    function requestDelete(items: GalleryReference[]) {
        deleteOpener.current = document.activeElement as HTMLElement;
        setError(null); setDeleting(items.map(({ taskId, index }) => ({ taskId, index })));
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

    return <section ref={resultsRegion} tabIndex={-1} aria-label={t("feedTitle")} className="h-full overflow-y-auto overscroll-contain outline-none" onKeyDown={event => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target as HTMLElement).closest('[role="dialog"], [role="alertdialog"]')) return;
        if (selectionMode && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); selectVisible(); }
        if (event.key === "Escape" && !busy) { setSelected(new Set()); setSelectionMode(false); }
    }}>
        <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
        {!hasContent && (history.isLoading || history.error) && <h1 className="sr-only">{t("feedTitle")}</h1>}
        {history.isLoading && <p role="status" className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("loadingHistory")}</p>}
        {history.error && <div role="alert" className="mx-auto max-w-2xl p-6 text-center text-sm text-destructive"><p>{t("historyError")}</p><Button type="button" variant="outline" className="mt-4" onClick={() => void history.mutate().catch(() => undefined)}>{t("retryHistory")}</Button></div>}
        {!hasContent && !history.isLoading && !history.error ? empty : hasContent && <div className="mx-auto max-w-[1600px] px-4 pb-6 sm:px-6">
            <div className="sm:sticky top-0 z-10 -mx-1 space-y-4 border-b border-white/10 bg-background/95 px-1 py-5 backdrop-blur-xl">
                <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="font-display text-xl font-semibold">{t("feedTitle")}</h1><p className="mt-1 text-xs text-muted-foreground">{t("loadedCount", { count: cards.length })}</p></div><div className="flex flex-wrap items-center gap-2">
                    {!organizing && <Button variant={selectionMode ? "secondary" : "outline"} size="sm" aria-pressed={selectionMode} onClick={() => { setSelectionMode(!selectionMode); setSelected(new Set()); }}><CheckSquare className="size-4" />{t("select")}</Button>}
                    {!selectionMode && cards.length > 1 && <Button variant={organizing ? "secondary" : "outline"} size="sm" disabled={busy} aria-pressed={organizing} onClick={() => { setOrganizing(!organizing); setArrangement(null); setSearch(""); setFilter("all"); setSort("custom"); setError(null); }}><GripVertical className="size-4" />{t("organize")}</Button>}
                    <Button variant="ghost" size="icon" aria-label={t(compact ? "comfortableGrid" : "compactGrid")} aria-pressed={compact} onClick={() => setCompact(!compact)}>{compact ? <Grid2X2 className="size-4" /> : <LayoutGrid className="size-4" />}</Button>
                </div></div>
                {!organizing && <div className="flex flex-wrap items-center gap-2"><div className="relative min-w-40 flex-1 basis-full sm:basis-0"><Search aria-hidden="true" className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input type="search" aria-label={t("searchGallery")} placeholder={t("searchGallery")} value={search} onChange={event => setSearch(event.target.value)} className="h-10 pl-9" /></div>
                    <label className="flex h-10 items-center gap-2 rounded-lg border border-white/15 bg-[#141618] px-3 text-xs"><SlidersHorizontal aria-hidden="true" className="size-3.5 text-muted-foreground" /><span className="sr-only">{t("filterGallery")}</span><select aria-label={t("filterGallery")} value={filter} onChange={event => setFilter(event.target.value)} className="max-w-32 bg-[#141618] text-foreground outline-none">{["all", "completed", "pending", "failed"].map(value => <option key={value} value={value}>{t(`filters.${value}`)}</option>)}</select></label>
                    <select aria-label={t("sortGallery")} value={sort} onChange={event => setSort(event.target.value)} className="h-10 max-w-44 rounded-lg border border-white/15 bg-[#141618] px-3 text-xs text-foreground">{["custom", "newest", "oldest"].map(value => <option key={value} value={value}>{t(`sorts.${value}`)}</option>)}</select>
                </div>}
                {selectionMode && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/25 bg-primary/5 p-3"><span className="min-w-28 flex-1 text-sm font-semibold">{t("selectedCount", { count: selectedItems.length })}</span><Button variant="ghost" size="sm" disabled={!visible.length} onClick={selectVisible}>{t(allSelected ? "deselectVisible" : "selectVisible")}</Button><Button variant="destructive" size="sm" disabled={!selectedItems.length || busy} onClick={() => requestDelete(selectedItems)}><Trash2 className="size-4" />{t("deleteSelected")}</Button><Button variant="ghost" size="icon" aria-label={t("cancelSelection")} onClick={() => { setSelected(new Set()); setSelectionMode(false); }}><X className="size-4" /></Button></div>}
                {organizing && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3"><p className="min-w-40 flex-1 text-xs leading-relaxed text-muted-foreground">{t("organizeHint")}</p><Button variant="outline" size="sm" disabled={busy} onClick={() => { setOrganizing(false); setArrangement(null); setError(null); }}>{t("cancel")}</Button><Button size="sm" disabled={!arrangement || busy} onClick={() => void saveOrder()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{t("saveOrder")}</Button></div>}
                {error && !deleting && <p role="alert" className="text-sm text-destructive">{errors.has(error) ? errors(error) : t("orderError")}</p>}
            </div>
            <div className={`grid gap-4 pt-5 ${compact ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" : "grid-cols-1 min-[500px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}`}>
                {localSubmissions.map(item => <SubmissionCard key={item.id} submission={item} />)}
                {visible.map(item => <GalleryCard key={galleryKey(item)} item={item} compact={compact} selected={selected.has(galleryKey(item))} selecting={selectionMode} organizing={organizing} position={sortable.findIndex(candidate => galleryKey(candidate) === galleryKey(item))} total={sortable.length} dragging={dragging === galleryKey(item)} over={over === galleryKey(item)}
                    onSelect={range => toggle(item, range)} onDelete={() => requestDelete([item])}
                    onPreview={() => { opener.current = document.activeElement as HTMLElement; setPreview({ items: allOutputs, index: allOutputs.findIndex(output => output.url === item.preview?.url) }); }}
                    onDrag={event => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(GALLERY_DRAG_TYPE, galleryKey(item)); setDragging(galleryKey(item)); }}
                    onOver={event => { if (organizing && canReorder(item) && event.dataTransfer.types.includes(GALLERY_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setOver(galleryKey(item)); } }}
                    onDrop={event => { if (organizing && canReorder(item) && event.dataTransfer.types.includes(GALLERY_DRAG_TYPE)) { event.preventDefault(); event.stopPropagation(); move(event.dataTransfer.getData(GALLERY_DRAG_TYPE), galleryKey(item)); } }}
                    onDragEnd={() => { setDragging(null); setOver(null); }}
                    onMove={direction => { const position = sortable.findIndex(candidate => galleryKey(candidate) === galleryKey(item)); const target = sortable[position + direction]; if (target) move(galleryKey(item), galleryKey(target)); }} />)}
            </div>
            {!visible.length && cards.length > 0 && <p role="status" className="py-16 text-center text-sm text-muted-foreground">{t("noMatches")}</p>}
        </div>}
        {history.hasMore && <div className="flex justify-center p-5"><Button type="button" variant="outline" disabled={history.isLoadingMore || Boolean(history.error) || organizing} onClick={() => void history.loadMore()}>{history.isLoadingMore && <Loader2 className="animate-spin" />}{t(history.isLoadingMore ? "loadingHistory" : "loadMore")}</Button></div>}
        <ConfirmDialog returnFocus={deleteOpener} open={Boolean(deleting)} onClose={() => { if (!busy) { setDeleting(null); setError(null); } }} onConfirm={() => void remove()} busy={busy} title={deleting?.length === 1 ? t("deleteTitle") : t("deleteManyTitle", { count: deleting?.length ?? 0 })} description={t("deleteAssetsHint")} error={error && deleting ? mutationError(error) : undefined} confirmLabel={t("deleteConfirm")} cancelLabel={t("cancel")} />
        {preview && preview.index >= 0 && <Lightbox items={preview.items} index={preview.index} returnFocus={opener} onClose={() => setPreview(null)} onNext={() => setPreview(current => current && ({ ...current, index: (current.index + 1) % current.items.length }))} onPrev={() => setPreview(current => current && ({ ...current, index: (current.index - 1 + current.items.length) % current.items.length }))} />}
    </section>;
}

function GalleryCard({ item, compact, selected, selecting, organizing, position, total, dragging, over, onSelect, onDelete, onPreview, onDrag, onOver, onDrop, onDragEnd, onMove }: {
    item: GalleryItem; compact: boolean; selected: boolean; selecting: boolean; organizing: boolean; position: number; total: number; dragging: boolean; over: boolean;
    onSelect: (range: boolean) => void; onDelete: () => void; onPreview: () => void; onDrag: (event: React.DragEvent) => void; onOver: (event: React.DragEvent) => void; onDrop: (event: React.DragEvent) => void; onDragEnd: () => void; onMove: (direction: number) => void;
}) {
    const t = useTranslations("tasks");
    const errors = useTranslations("errors");
    const task = item.task, preview = item.preview;
    const elapsed = useTaskRefresh(task);
    const status = task.status ?? task.freepik_status ?? "CREATED";
    const pending = status === "CREATED" || status === "IN_PROGRESS";
    const rawError = task.error_message ?? "";
    const failure = task.recovery_required ? t("recoveryRequired") : errors.has(rawError) ? errors(rawError) : t("failureFallback");
    const name = `${item.model}${item.index !== null ? ` (${item.index + 1})` : ""}`;
    return <article data-gallery-key={galleryKey(item)} aria-label={name} onDragOver={onOver} onDrop={onDrop} className={`group relative min-w-0 overflow-hidden rounded-2xl border bg-[#111315] transition-[border-color,box-shadow,opacity] ${selected || over ? "border-primary ring-2 ring-primary/25" : "border-white/15 hover:border-white/30"} ${dragging ? "opacity-40" : ""}`}>
        {!organizing && <button type="button" role="checkbox" aria-checked={selected} aria-label={t("selectItem", { name })} onClick={event => onSelect(event.shiftKey)} className={`absolute left-3 top-3 z-[1] grid size-9 place-items-center rounded-lg border shadow-lg transition-opacity focus-visible:opacity-100 ${selected ? "border-primary bg-primary text-primary-foreground" : `border-white/30 bg-black/70 text-white ${selecting ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"}`}`}><Check className={`size-4 ${selected ? "opacity-100" : "opacity-0"}`} /></button>}
        {preview ? <button type="button" aria-label={`${t("preview")} - ${name}`} onClick={event => { if (selecting || event.shiftKey || event.ctrlKey || event.metaKey) onSelect(event.shiftKey); else onPreview(); }} draggable={!organizing && !selecting && preview.mediaType === "image"} onDragStart={event => { if (!organizing && !selecting && preview.mediaType === "image") writeImageTransfer(event.dataTransfer, preview.url); }} title={t(selecting ? "select" : "dragImageHint")} className={`relative flex w-full items-center justify-center overflow-hidden bg-black/30 focus-visible:-outline-offset-4 ${compact ? "h-40 sm:h-48" : "h-60"}`}>
            {preview.mediaType === "video" ? <><video src={preview.url} muted playsInline preload="metadata" className="h-full w-full object-cover" /><span className="absolute grid size-12 place-items-center rounded-full border border-white/25 bg-black/70"><Play className="ml-0.5 size-5" /></span></>
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={preview.url} alt={t("imageAlt", { index: (item.index ?? 0) + 1 })} draggable={!organizing && !selecting} loading="lazy" className="h-full w-full object-cover" />}
            <span aria-hidden="true" className="absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-black/75 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"><ArrowUpRight className="size-4" /></span>
        </button> : <div className={`flex flex-col items-center justify-center gap-3 px-5 text-center ${compact ? "h-40 sm:h-48" : "h-60"}`}>
            {pending ? <><Loader2 aria-hidden="true" className="size-8 animate-spin text-primary" /><p className="text-sm">{t("waiting")}</p><p className="text-xs text-muted-foreground">{t("status.IN_PROGRESS")} · {t("elapsed", { seconds: elapsed })}</p></> : <><AlertCircle aria-hidden="true" className="size-6 text-destructive" /><p className="max-h-32 overflow-y-auto text-xs leading-relaxed text-destructive">{status === "COMPLETED" ? t("noOutput") : failure}</p></>}
        </div>}
        {!pending && !preview && rawError && !errors.has(rawError) && !["error", "failed", "cancelled"].includes(rawError.toLowerCase()) && <details className="px-4 pb-3 text-xs text-muted-foreground"><summary className="cursor-pointer rounded-md py-2">{t("errorDetails")}</summary><p className="max-h-32 overflow-y-auto break-words leading-relaxed">{rawError}</p></details>}
        <div className="flex min-w-0 items-center gap-1 border-t border-white/10 p-3"><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold" title={item.model}>{item.model}</p><p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground" title={task.prompt}>{task.prompt || (t.has(`status.${status}`) ? t(`status.${status}`) : t("status.UNKNOWN"))}</p></div>{!organizing && <>{preview && <a href={preview.downloadUrl} download aria-label={t(preview.mediaType === "video" ? "downloadVideo" : "downloadImage")} className={buttonVariants({ variant: "ghost", size: "icon" })}><Download className="size-4" /></a>}<Button type="button" variant="ghost" size="icon" aria-label={t("deleteConfirm")} onClick={onDelete}><Trash2 className="size-4 text-muted-foreground" /></Button></>}</div>
        {organizing && canReorder(item) && <div className="flex items-center justify-between gap-1 border-t border-white/10 bg-white/[.025] px-2 py-1"><Button type="button" draggable onDragStart={onDrag} onDragEnd={onDragEnd} variant="ghost" size="icon" aria-label={t("dragToReorder", { name })} className="cursor-grab active:cursor-grabbing"><GripVertical className="size-4" /></Button><span className="text-[11px] tabular-nums text-muted-foreground">{position + 1}</span><div className="flex"><Button type="button" variant="ghost" size="icon" aria-label={t("moveEarlier", { name })} disabled={position === 0} onClick={() => onMove(-1)}><ArrowUp className="size-4" /></Button><Button type="button" variant="ghost" size="icon" aria-label={t("moveLater", { name })} disabled={position === total - 1} onClick={() => onMove(1)}><ArrowDown className="size-4" /></Button></div></div>}
    </article>;
}
function SubmissionCard({ submission }: { submission: BackgroundSubmission }) {
    const t = useTranslations("tasks");
    const errors = useTranslations("errors");
    const { modelLabel } = useModelCopy();
    const pending = !submission.outcome || submission.outcome.accepted;
    const message = submission.outcome?.error ?? "ERR_GENERIC";
    return <article data-submission-id={submission.id} className="min-w-0 overflow-hidden rounded-2xl border border-white/15 bg-[#111315]">
        <div className="flex h-56 flex-col items-center justify-center gap-3 px-5 text-center" role={pending ? "status" : "alert"}>
            {pending ? <><Loader2 aria-hidden="true" className="size-8 animate-spin text-primary" /><p className="text-sm">{t(submission.outcome ? "waiting" : "sending")}</p><p className="text-xs text-muted-foreground">{t("backgroundHint")}</p></>
                : <><AlertCircle aria-hidden="true" className="size-6 text-destructive" /><p className="max-h-36 overflow-y-auto text-xs leading-relaxed text-destructive">{errors.has(message) ? errors(message) : errors("ERR_GENERIC")}</p></>}
        </div>
        <div className="flex min-w-0 items-center gap-2 border-t border-white/10 p-3"><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{modelLabel(submission.model)}</p><p className="mt-1 truncate text-[11px] text-muted-foreground" title={submission.prompt}>{submission.prompt}</p></div>
            {!pending && <Button type="button" variant="ghost" size="icon" aria-label={t("dismissSubmission")} onClick={() => dismissSubmission(submission.id)}><Trash2 className="size-4" /></Button>}
        </div>
    </article>;
}
