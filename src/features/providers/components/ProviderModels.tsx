"use client";

import { useModelCopy } from "@/i18n/use-model-copy";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2, Image as ImageIcon, Loader2, Plus, RefreshCw, Search, Video, X } from "lucide-react";
import type { ProviderConnectionRecord } from "@/providers/config-types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CustomModelDialog } from "./CustomModelDialog";
import { configRequest, providerErrorMessage } from "../lib/api";
import { fieldClass, panelClass } from "./styles";
import { type CatalogModel, type CatalogResponse, type MediaType, type ProviderDefinition } from "../types";

export function ProviderModels({ provider, catalog, connections, connected, reload, setCatalog }: {
    provider: ProviderDefinition; catalog: CatalogResponse; connections: ProviderConnectionRecord[]; connected: boolean;
    reload: () => Promise<void>; setCatalog: (catalog: CatalogResponse) => void;
}) {
    const t = useTranslations("providers");
    const { modelLabel } = useModelCopy();
    const addButton = useRef<HTMLButtonElement>(null);
    const [mediaType, setMediaType] = useState<MediaType>("image");
    const [search, setSearch] = useState("");
    const [visibility, setVisibility] = useState("all");
    const [adding, setAdding] = useState(false);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
    const models: CatalogModel[] = [
        ...catalog.images.map((model) => ({ model, mediaType: "image" as const })),
        ...catalog.videos.map((model) => ({ model, mediaType: "video" as const })),
    ].filter(({ model }) => model.provider === provider.id);
    const overrides = new Map(catalog.overrides.map((entry) => [`${entry.mediaType}:${entry.modelId}`, entry]));
    const isEnabled = ({ model, mediaType: type }: CatalogModel) => overrides.get(`${type}:${model.id}`)?.enabled ?? model.catalog_status !== "disabled";
    const visible = models.filter(entry => entry.mediaType === mediaType
        && `${modelLabel(entry.model.label)} ${entry.model.label} ${entry.model.id} ${entry.model.provider_model_id ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
        && (visibility === "all" || (visibility === "visible") === isEnabled(entry)));
    const enabled = visible.filter(isEnabled);
    const disabled = visible.filter(entry => !isEnabled(entry));
    const candidates = catalog.discovered.filter(model => model.providerId === provider.id);
    const supportsDiscovery = ["google-ai-studio", "vercel-ai-gateway"].includes(provider.id);

    async function toggle(entries: CatalogModel[], value: boolean) {
        setBusy(true); setNotice(null);
        try {
            for (const { model, mediaType: type } of entries) {
                setCatalog(await configRequest<CatalogResponse>("/api/catalog", "PATCH", { modelId: model.id, mediaType: type, enabled: value }));
            }
        } catch (failure) { setNotice({ error: true, text: providerErrorMessage(failure, t) }); }
        finally { setBusy(false); }
    }
    async function discover() {
        setBusy(true); setNotice(null);
        try {
            const connection = connections.filter(entry => entry.enabled && entry.secretConfigured).sort((a, b) => a.priority - b.priority)[0];
            const result = await configRequest<{ discovered?: unknown[] }>("/api/catalog/discover", "POST", { providerId: provider.id, connectionId: connection?.id });
            await reload();
            setNotice({ error: false, text: t("syncSuccess", { count: result.discovered?.length ?? 0 }) });
        } catch (failure) { setNotice({ error: true, text: providerErrorMessage(failure, t) }); }
        finally { setBusy(false); }
    }

    function tile(entry: CatalogModel, active: boolean) {
        const { model, mediaType: type } = entry;
        return <div key={`${type}:${model.id}`} className={`flex min-w-0 items-center gap-3 rounded-xl border p-3.5 transition-colors ${active ? "border-white/12 bg-white/[.025]" : "border-dashed border-white/15"}`}>
            <div className="min-w-0 flex-1"><p title={modelLabel(model.label)} className="truncate text-sm font-medium">{modelLabel(model.label)}</p><p title={model.provider_model_id ?? model.id} className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{model.provider_model_id ?? model.id}</p>{model.catalog_source === "custom" && <span className="mt-1 block text-[11px] text-amber-200">{t("customBadge")}</span>}</div>
            <Switch aria-label={t("showModel", { name: modelLabel(model.label) })} checked={active} disabled={busy} onCheckedChange={checked => void toggle([entry], checked)} />
        </div>;
    }

    return <section className={panelClass} aria-labelledby="provider-models-title">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 id="provider-models-title" className="text-base font-semibold">{t("modelsTitle")}</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("modelsHint")}</p></div><div className="flex flex-wrap gap-2">{supportsDiscovery && <Button variant="secondary" disabled={busy || !connected} title={t("syncHint")} onClick={() => void discover()}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}{t("sync")}</Button>}<Button ref={addButton} variant="outline" onClick={() => setAdding(true)}><Plus />{t("addModel")}</Button></div></div>
        {!connected && <p className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200/15 bg-amber-200/5 p-3 text-xs leading-relaxed text-amber-100"><AlertCircle className="size-4 shrink-0" />{t("needsConnection")}</p>}
        {notice && <div role={notice.error ? "alert" : "status"} className={`mt-4 flex items-start gap-2 rounded-xl p-3 text-sm ${notice.error ? "bg-destructive/10 text-destructive" : "bg-primary/5 text-primary"}`}>{notice.error ? <AlertCircle className="size-4 shrink-0" /> : <CheckCircle2 className="size-4 shrink-0" />}{notice.text}</div>}
        <div className="mt-5 flex flex-wrap items-center gap-3 border-b border-white/10 pb-4">
            <div role="group" aria-label={t("mediaType")} className="flex gap-1 rounded-xl bg-black/25 p-1">{(["image", "video"] as const).map(type => <button key={type} type="button" aria-pressed={mediaType === type} onClick={() => setMediaType(type)} className={`flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm ${mediaType === type ? "bg-white/10 text-white" : "text-muted-foreground hover:text-white"}`}>{type === "image" ? <ImageIcon className="size-4" /> : <Video className="size-4" />}{t(type === "image" ? "images" : "videos")}<span className="text-xs text-muted-foreground">{models.filter(entry => entry.mediaType === type).length}</span></button>)}</div>
            <label className="relative min-w-48 flex-1"><Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" /><input type="search" aria-label={t("searchModels")} placeholder={t("searchModels")} value={search} onChange={event => setSearch(event.target.value)} className={`${fieldClass} pl-9 pr-10 [&::-webkit-search-cancel-button]:appearance-none`} />{search && <button type="button" aria-label={t("clearSearch")} onClick={() => setSearch("")} className="absolute right-1 top-1 grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-white/10"><X className="size-4" /></button>}</label>
            <select aria-label={t("modelStatus")} value={visibility} onChange={event => setVisibility(event.target.value)} className={`${fieldClass} w-auto flex-1 sm:flex-none`}><option value="all">{t("allModels")}</option><option value="visible">{t("onlyVisible")}</option><option value="hidden">{t("onlyHidden")}</option></select>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-xs text-muted-foreground">{t("filteredCount", { shown: visible.length, total: models.filter(entry => entry.mediaType === mediaType).length })}</p><div className="flex gap-1"><Button variant="ghost" size="sm" disabled={busy || !disabled.length} onClick={() => void toggle(disabled, true)}>{t("enableAll")}</Button><Button variant="ghost" size="sm" disabled={busy || !enabled.length} onClick={() => void toggle(enabled, false)}>{t("disableAll")}</Button></div></div>
        {visible.length ? <div className="space-y-5 pt-3">{enabled.length > 0 && <div><p className="mb-3 text-xs font-medium text-muted-foreground">{t("visible")} ({enabled.length})</p><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{enabled.map(entry => tile(entry, true))}</div></div>}{disabled.length > 0 && <div><p className="mb-3 text-xs font-medium text-muted-foreground">{t("hidden")} ({disabled.length})</p><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{disabled.map(entry => tile(entry, false))}</div></div>}</div> : <p className="py-10 text-center text-sm text-muted-foreground">{t("emptyModels")}</p>}
        {candidates.length > 0 && <details className="mt-5 border-t border-white/10 pt-4"><summary className="cursor-pointer rounded-md py-2 text-sm font-medium">{t("discovered")} ({candidates.length})</summary><p className="my-3 text-sm leading-relaxed text-muted-foreground">{t("discoveredHint")}</p><div className="grid gap-2 sm:grid-cols-2">{candidates.map(model => <div key={model.id} className="min-w-0 rounded-lg bg-black/20 p-3 text-sm"><p className="truncate">{model.displayName ?? model.providerModelId}</p><p className="mt-1 truncate font-mono text-xs text-muted-foreground">{model.providerModelId}</p></div>)}</div></details>}
        {adding && <CustomModelDialog returnFocus={addButton} provider={provider} templates={models} onClose={() => setAdding(false)} onSaved={reload} />}
    </section>;
}
