"use client";

import { useModelCopy } from "@/i18n/use-model-copy";

import { useRef, useState } from "react";
import { AlertCircle, ArrowUpRight, Download, Loader2, Play, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRuntimeModels } from "@/features/catalog/hooks/useRuntimeModels";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Lightbox, type PreviewItem } from "./Lightbox";
import { useVideoTasks, revalidateVideoTasks } from "../hooks/useVideoTasks";
import { useImageTasks, revalidateImageTasks } from "../hooks/useImageTasks";
import { useTaskRefresh } from "../hooks/useTaskRefresh";
import type { AnyTask } from "@/types";
import { attachmentUrl } from "@/lib/download-url";

function outputs(task: AnyTask, model: string): PreviewItem[] {
    const urls = task.media_type === "video" ? task.video_urls ?? task.result_urls ?? [] : task.result_urls ?? [];
    const count = task.has_download ? Math.max(task.result_count ?? 1, urls.length) : urls.length;
    return Array.from({ length: count }, (_, index) => ({
        url: task.has_download ? `/api/download/${encodeURIComponent(task.task_id)}?index=${index}&inline=1` : urls[index],
        downloadUrl: attachmentUrl(`/api/download/${encodeURIComponent(task.task_id)}?index=${index}`),
        model, prompt: task.prompt, mediaType: task.media_type,
    }));
}

export function ResultsGrid({ mode, empty }: { mode: "image" | "video"; empty: React.ReactNode }) {
    const t = useTranslations("tasks");
    const { modelLabel } = useModelCopy();
    const videoHistory = useVideoTasks();
    const imageHistory = useImageTasks();
    const catalog = useRuntimeModels(mode);
    const history = mode === "image" ? imageHistory : videoHistory;
    const [preview, setPreview] = useState<{ items: PreviewItem[]; index: number } | null>(null);
    const [deleting, setDeleting] = useState<{ id: string; mode: "image" | "video" } | null>(null);
    const [busy, setBusy] = useState(false);
    const [deleteError, setDeleteError] = useState(false);
    const deleteOpener = useRef<HTMLElement | null>(null);
    const resultsRegion = useRef<HTMLElement | null>(null);
    const opener = useRef<HTMLElement | null>(null);
    const cards = history.tasks.map(task => ({ task, model: modelLabel(catalog.byId[task.model_id]?.label ?? task.provider_capabilities?.label ?? task.model_id) }));
    const allOutputs = cards.filter(({ task }) => (task.status ?? task.freepik_status) === "COMPLETED").flatMap(({ task, model }) => outputs(task, model));

    async function remove() {
        if (!deleting || busy) return;
        setBusy(true); setDeleteError(false);
        try {
            const response = await fetch(`/api/${deleting.mode === "image" ? "image-tasks" : "tasks"}/${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
            if (!response.ok) throw new Error();
            deleteOpener.current = resultsRegion.current;
            setDeleting(null);
            if (deleting.mode === "image") revalidateImageTasks(); else revalidateVideoTasks();
        } catch { setDeleteError(true); }
        finally { setBusy(false); }
    }

    return <section ref={resultsRegion} tabIndex={-1} aria-label={t("feedTitle")} className="h-full overflow-y-auto overscroll-contain outline-none">
        {!history.tasks.length && (history.isLoading || history.error) && <h1 className="sr-only">{t("feedTitle")}</h1>}
        {history.isLoading && <p role="status" className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("loadingHistory")}</p>}
        {history.error && <div role="alert" className="mx-auto max-w-2xl p-6 text-center text-sm text-destructive"><p>{t("historyError")}</p><Button type="button" variant="outline" className="mt-4" onClick={() => void history.mutate().catch(() => undefined)}>{t("retryHistory")}</Button></div>}
        {!history.tasks.length && !history.isLoading && !history.error ? empty : history.tasks.length > 0 && <div className="mx-auto max-w-[1440px] p-4 sm:p-6"><h1 className="mb-5 font-display text-xl font-semibold">{t("feedTitle")}</h1><div className="grid grid-cols-1 gap-4 min-[500px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{cards.map(({ task, model }) => <TaskCard key={task.task_id} task={task} model={model}
            onDelete={() => { deleteOpener.current = document.activeElement as HTMLElement; setDeleteError(false); setDeleting({ id: task.task_id, mode }); }}
            onPreview={item => { opener.current = document.activeElement as HTMLElement; setPreview({ items: allOutputs, index: Math.max(0, allOutputs.findIndex(candidate => candidate.url === item.url)) }); }} />)}</div></div>}
        {history.hasMore && <div className="flex justify-center p-5"><Button type="button" variant="outline" disabled={history.isLoadingMore || Boolean(history.error)} onClick={() => void history.loadMore()}>{history.isLoadingMore && <Loader2 className="animate-spin" />}{t(history.isLoadingMore ? "loadingHistory" : "loadMore")}</Button></div>}
        <ConfirmDialog returnFocus={deleteOpener} open={Boolean(deleting)} onClose={() => { setDeleting(null); setDeleteError(false); }} onConfirm={() => void remove()} busy={busy} title={t("deleteTitle")} description={t("deleteHint")} error={deleteError ? t("deleteError") : undefined} confirmLabel={t("deleteConfirm")} cancelLabel={t("cancel")} />
        {preview && <Lightbox items={preview.items} index={preview.index} returnFocus={opener} onClose={() => setPreview(null)} onNext={() => setPreview(current => current && ({ ...current, index: (current.index + 1) % current.items.length }))} onPrev={() => setPreview(current => current && ({ ...current, index: (current.index - 1 + current.items.length) % current.items.length }))} />}
    </section>;
}

function TaskCard({ task, model, onDelete, onPreview }: { task: AnyTask; model: string; onDelete: () => void; onPreview: (item: PreviewItem) => void }) {
    const t = useTranslations("tasks");
    const errors = useTranslations("errors");
    const elapsed = useTaskRefresh(task);
    const status = task.status ?? task.freepik_status ?? "CREATED";
    const pending = status === "CREATED" || status === "IN_PROGRESS";
    const items = status === "COMPLETED" ? outputs(task, model) : [];
    const rawError = task.error_message ?? "";
    const failure = task.recovery_required ? t("recoveryRequired") : errors.has(rawError) ? errors(rawError) : t("failureFallback");
    return <>{(items.length ? items : [null]).map((item, index) => <article key={item?.url ?? task.task_id} className="min-w-0 overflow-hidden rounded-2xl border border-white/15 bg-[#111315]">
        {item ? <button type="button" aria-label={`${t("preview")} - ${model}${items.length > 1 ? ` (${index + 1})` : ""}`} onClick={() => onPreview(item)} className="group relative flex h-56 w-full items-center justify-center overflow-hidden bg-black/30 focus-visible:-outline-offset-4">
            {item.mediaType === "video" ? <><video src={item.url} muted playsInline preload="metadata" className="h-full w-full object-contain" /><span className="absolute grid size-12 place-items-center rounded-full border border-white/25 bg-black/70"><Play className="ml-0.5 size-5" /></span></>
                // eslint-disable-next-line @next/next/no-img-element
                : <img src={item.url} alt={t("imageAlt", { index: index + 1 })} loading="lazy" className="h-full w-full object-contain" />}
            <span aria-hidden="true" className="absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-black/75 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><ArrowUpRight className="size-4" /></span>
        </button> : <div className="flex h-56 flex-col items-center justify-center gap-3 px-5 text-center">
            {pending ? <><Loader2 className="size-8 animate-spin text-primary" /><p className="text-sm">{t("waiting")}</p><p className="text-xs text-muted-foreground">{t("status.IN_PROGRESS")} · {t("elapsed", { seconds: elapsed })}</p></> : <><AlertCircle className="size-6 text-destructive" /><p className="max-h-32 overflow-y-auto text-xs leading-relaxed text-destructive">{status === "COMPLETED" ? t("noOutput") : failure}</p></>}
        </div>}
        {!pending && !item && rawError && !errors.has(rawError) && !["error", "failed", "cancelled"].includes(rawError.toLowerCase()) && <details className="px-4 pb-3 text-xs text-muted-foreground"><summary className="cursor-pointer rounded-md py-2">{t("errorDetails")}</summary><p className="max-h-32 overflow-y-auto break-words leading-relaxed">{rawError}</p></details>}
        <div className="flex min-w-0 items-center gap-2 border-t border-white/10 p-3"><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold" title={model}>{model}</p><p className="mt-1 truncate text-[11px] text-muted-foreground" title={task.prompt}>{task.prompt || (t.has(`status.${status}`) ? t(`status.${status}`) : t("status.UNKNOWN"))}</p></div>{item && <a href={item.downloadUrl} download aria-label={t(item.mediaType === "video" ? "downloadVideo" : "downloadImage")} className={buttonVariants({ variant: "ghost", size: "icon" })}><Download className="size-4" /></a>}<Button type="button" variant="ghost" size="icon" aria-label={t("deleteConfirm")} onClick={onDelete}><Trash2 className="size-4 text-muted-foreground" /></Button></div>
    </article>)}</>;
}
