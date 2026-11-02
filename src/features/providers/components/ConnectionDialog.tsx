"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Eye, EyeOff, ExternalLink, Loader2, LockKeyhole } from "lucide-react";
import type { ProviderConnectionRecord } from "@/providers/config-types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { configRequest, providerErrorMessage } from "../lib/api";
import { fieldClass } from "./styles";
import type { ProviderDefinition } from "../types";

export function ConnectionDialog({ provider, connection, onClose, onSaved, returnFocus }: {
    returnFocus: React.RefObject<HTMLElement | null>;
    provider: ProviderDefinition; connection?: ProviderConnectionRecord; onClose: () => void; onSaved: () => Promise<void>;
}) {
    const t = useTranslations("providers");
    const common = useTranslations("common");
    const [label, setLabel] = useState(connection?.label ?? "");
    const [secret, setSecret] = useState("");
    const [showSecret, setShowSecret] = useState(false);
    const [project, setProject] = useState(String(connection?.metadata?.project ?? ""));
    const [location, setLocation] = useState(String(connection?.metadata?.location ?? "global"));
    const [veoLocation, setVeoLocation] = useState(String(connection?.metadata?.veoLocation ?? "us-central1"));
    const [priority, setPriority] = useState(connection?.priority ?? 100);
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const serviceAccount = provider.secretKind === "google-service-account";

    async function save(event: React.FormEvent) {
        event.preventDefault(); setError("");
        let account: Record<string, unknown> | undefined;
        if (serviceAccount && secret.trim()) {
            try { account = JSON.parse(secret); if (!account || typeof account !== "object" || Array.isArray(account)) throw new Error(); }
            catch { setError(t("invalidCredentials")); return; }
        }
        setSaving(true);
        try {
            const metadata = { ...connection?.metadata, ...(serviceAccount ? { project: project.trim() || account?.project_id, location: location.trim(), veoLocation: veoLocation.trim() } : {}) };
            await configRequest(connection ? `/api/providers/${encodeURIComponent(connection.id)}` : "/api/providers", connection ? "PATCH" : "POST", { providerId: provider.id, label, ...(secret.trim() ? { secret } : {}), metadata, priority });
            onClose();
            // The write is confirmed; a failed list refresh must not invite another POST.
            void onSaved().catch(() => undefined);
        } catch (failure) { setError(providerErrorMessage(failure, t)); }
        finally { setSaving(false); }
    }

    return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
        <DialogContent finalFocus={returnFocus} closeLabel={common("close")} showCloseButton={!saving} className="max-h-[90dvh] overflow-y-auto bg-[#141618] p-5 sm:max-w-lg sm:p-6">
            <div><DialogTitle className="pr-6 text-xl leading-snug">{t(connection ? "editConnection" : "addConnection")}</DialogTitle><DialogDescription className="mt-2">{provider.label}</DialogDescription></div>
            <form onSubmit={save} className="space-y-4">
                {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
                <label className="block space-y-2"><span className="text-sm font-medium">{t("name")}</span><input autoFocus required maxLength={120} value={label} onChange={event => setLabel(event.target.value)} placeholder={t("namePlaceholder")} className={fieldClass} /></label>
                <div className="space-y-2"><label className="block space-y-2"><span className="text-sm font-medium">{t(serviceAccount ? "serviceAccount" : "apiKey")}</span>
                    {serviceAccount ? <textarea required={!connection} aria-describedby="connection-key-help" value={secret} onChange={event => setSecret(event.target.value)} placeholder={connection ? t("keySaved") : '{"type": "service_account", ...}'} spellCheck={false} className={`${fieldClass} h-32 py-3 font-mono text-xs`} /> : <input type={showSecret ? "text" : "password"} required={!connection} aria-describedby="connection-key-help" autoComplete="new-password" value={secret} onChange={event => setSecret(event.target.value)} placeholder={t(connection ? "keySaved" : "keyPlaceholder")} className={fieldClass} />}
                </label><div className="flex flex-wrap items-center justify-between gap-2"><p id="connection-key-help" className="text-xs text-muted-foreground">{connection ? t("keepKey") : t("keyHint")}</p>{!serviceAccount && <button type="button" aria-label={t(showSecret ? "hideKey" : "showKey")} onClick={() => setShowSecret(!showSecret)} className="inline-flex min-h-8 items-center gap-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground">{showSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}{t(showSecret ? "hideKey" : "showKey")}</button>}</div></div>
                {serviceAccount && <div className="space-y-4 rounded-xl border border-white/10 p-4"><label className="block space-y-2"><span className="text-sm font-medium">{t("project")}</span><input value={project} onChange={event => setProject(event.target.value)} placeholder={t("projectPlaceholder")} className={fieldClass} /></label><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-2"><span className="text-xs text-muted-foreground">{t("location")}</span><input required value={location} onChange={event => setLocation(event.target.value)} className={fieldClass} /></label><label className="space-y-2"><span className="text-xs text-muted-foreground">{t("veoLocation")}</span><input required value={veoLocation} onChange={event => setVeoLocation(event.target.value)} className={fieldClass} /></label></div><p className="text-xs leading-relaxed text-muted-foreground">{t("locationHint")}</p></div>}
                <details className="rounded-xl border border-white/10 p-3"><summary className="cursor-pointer rounded-md text-sm font-medium text-muted-foreground">{t("settings")}</summary><label className="mt-4 block space-y-2"><span className="text-sm font-medium">{t("priority")}</span><input type="number" aria-label={t("priority")} aria-describedby="connection-priority-help" min={0} max={10000} step={1} required value={priority} onChange={event => setPriority(Number(event.target.value))} className={fieldClass} /><span id="connection-priority-help" className="block text-xs leading-relaxed text-muted-foreground">{t("priorityHint")}</span></label></details>
                <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-primary" />{t("secureHint")}</p>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4"><a href={provider.docsUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground">{t("docs")}<ExternalLink className="size-3" /><span className="sr-only">({t("external")})</span></a><div className="flex gap-2"><Button type="button" variant="ghost" onClick={onClose} disabled={saving}>{t("cancel")}</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="animate-spin" />}{t(saving ? "saving" : "save")}</Button></div></div>
            </form>
        </DialogContent>
    </Dialog>;
}
