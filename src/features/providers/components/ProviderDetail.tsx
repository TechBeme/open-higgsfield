"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2, ExternalLink, KeyRound, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import type { ProviderConnectionRecord } from "@/providers/config-types";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ConnectionDialog } from "./ConnectionDialog";
import { ProviderMark } from "./ProviderMark";
import { ProviderModels } from "./ProviderModels";
import { configRequest, providerErrorMessage } from "../lib/api";
import { panelClass } from "./styles";
import type { CatalogResponse, ProviderDefinition } from "../types";

export function ProviderDetail({ provider, connections, catalog, reload, setCatalog, connected, environmentConfigured }: {
    provider: ProviderDefinition; connections: ProviderConnectionRecord[]; catalog: CatalogResponse;
    reload: () => Promise<void>; setCatalog: (catalog: CatalogResponse) => void; connected: boolean; environmentConfigured: boolean;
}) {
    const t = useTranslations("providers");
    const returnFocus = useRef<HTMLElement | null>(null);
    const addButton = useRef<HTMLButtonElement>(null);
    const [editing, setEditing] = useState<ProviderConnectionRecord | "new" | null>(null);
    const [removing, setRemoving] = useState<ProviderConnectionRecord | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
    const canVerify = ["google-ai-studio", "vercel-ai-gateway", "runware"].includes(provider.id);

    async function act(id: string, action: "test" | "delete" | "enable", enabled?: boolean) {
        setBusy(id); setNotice(null);
        try {
            const result = await configRequest<{ status?: string }>(`/api/providers/${encodeURIComponent(id)}${action === "test" ? "/test" : ""}`, action === "test" ? "POST" : action === "delete" ? "DELETE" : "PATCH", action === "enable" ? { enabled } : undefined);
            if (action === "delete") { returnFocus.current = addButton.current; setRemoving(null); }
            await reload();
            if (action === "test") setNotice({ error: false, text: t(result.status === "healthy" ? "testSuccess" : "unsupportedTest") });
        } catch (failure) { setNotice({ error: true, text: providerErrorMessage(failure, t, action === "test" ? "testFailure" : "saveError") }); }
        finally { setBusy(null); }
    }

    return <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex min-w-0 items-start gap-4"><ProviderMark id={provider.id} large /><div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{provider.label}</h1><span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${connected ? "border-primary/20 bg-primary/5 text-primary" : "border-white/15 text-muted-foreground"}`}>{t(connected ? "connected" : "disconnected")}</span></div><p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">{t(`descriptions.${provider.id}`)}</p></div></div>
            <a href={provider.docsUrl} target="_blank" rel="noreferrer" aria-label={`${t("docs")} (${t("external")})`} className="inline-flex min-h-10 items-center gap-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground">{t("docs")}<ExternalLink className="size-3.5" /></a>
        </div>
        {notice && <div role={notice.error ? "alert" : "status"} className={`flex items-start gap-3 rounded-xl border p-4 text-sm leading-relaxed ${notice.error ? "border-destructive/25 bg-destructive/10 text-destructive" : "border-primary/20 bg-primary/5 text-primary"}`}>{notice.error ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}{notice.text}</div>}
        <section aria-label={t("connections")} className={panelClass}>
            <div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-base font-semibold">{t("connections")} <span className="ml-1 text-sm font-normal text-muted-foreground">{connections.length}</span></h2><p className="mt-1 text-sm text-muted-foreground">{t("connectionsHint")}</p></div><Button ref={addButton} onClick={event => { returnFocus.current = event.currentTarget; setEditing("new"); }}><Plus />{t("addConnection")}</Button></div>
            {environmentConfigured && connections.length === 0 ? <div className="mt-5 flex items-start gap-3 rounded-xl border border-primary/15 bg-primary/[.04] p-4"><KeyRound className="mt-0.5 size-5 shrink-0 text-primary" /><div><p className="text-sm font-semibold">{t("environment")}</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("environmentHint")}</p></div></div>
                : connections.length === 0 ? <div className="mt-5 flex items-start gap-3 rounded-xl border border-dashed border-white/20 p-5"><KeyRound className="mt-0.5 size-5 shrink-0 text-muted-foreground" /><div><h3 className="text-sm font-semibold">{t("noConnections")}</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t("noConnectionsHint", { provider: provider.label })}</p></div></div>
                    : <div className="mt-5 divide-y divide-white/10">{connections.map(connection => <div key={connection.id} className="flex flex-wrap items-center gap-3 py-4 first:pt-0 last:pb-0">
                        <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[.03]"><KeyRound className="size-4 text-muted-foreground" /></div>
                        <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold">{connection.label}</h3><div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"><span className={connection.enabled ? "text-primary" : "text-muted-foreground"}>{t(connection.enabled ? "enabled" : "disabled")}</span><span className="text-muted-foreground">{t("priorityValue", { value: connection.priority })}</span><span className={connection.lastHealth === "healthy" ? "text-emerald-300" : connection.lastHealth === "unhealthy" ? "text-destructive" : "text-muted-foreground"}>{t(connection.lastHealth === "healthy" ? "healthy" : connection.lastHealth === "unhealthy" ? "unhealthy" : "untested")}</span></div></div>
                        <div className="flex flex-wrap items-center gap-2">
                            {canVerify && <Button size="sm" variant="outline" title={t("testHint")} disabled={busy !== null || !connection.enabled} onClick={() => void act(connection.id, "test")}>{busy === connection.id && <Loader2 className="animate-spin" />}{t("test")}</Button>}
                            <Button size="icon" variant="ghost" aria-label={t("editName", { name: connection.label })} title={t("editConnection")} onClick={event => { returnFocus.current = event.currentTarget; setEditing(connection); }} disabled={busy !== null}><Pencil /></Button>
                            <Button size="icon" variant="ghost" aria-label={t("deleteName", { name: connection.label })} className="text-muted-foreground hover:text-destructive" onClick={event => { returnFocus.current = event.currentTarget; setNotice(null); setRemoving(connection); }} disabled={busy !== null}><Trash2 /></Button>
                            <Switch aria-label={t("enableName", { name: connection.label })} checked={connection.enabled} onCheckedChange={enabled => void act(connection.id, "enable", enabled)} disabled={busy !== null} />
                        </div>
                    </div>)}</div>}
            {environmentConfigured && connections.length > 0 && !connected && <p className="mt-4 text-sm text-muted-foreground">{t("envPaused")}</p>}
        </section>
        <ProviderModels provider={provider} catalog={catalog} connections={connections} connected={connected} reload={reload} setCatalog={setCatalog} />
        {editing && <ConnectionDialog returnFocus={returnFocus} provider={provider} connection={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSaved={reload} />}
        <ConfirmDialog returnFocus={returnFocus} open={Boolean(removing)} onClose={() => setRemoving(null)} onConfirm={() => { if (removing) void act(removing.id, "delete"); }} title={t("deleteTitle")} description={t("deleteHint", { name: removing?.label ?? "" })} error={notice?.error ? notice.text : undefined} confirmLabel={t("deleteConfirm")} cancelLabel={t("cancel")} busy={busy !== null} />
    </div>;
}
