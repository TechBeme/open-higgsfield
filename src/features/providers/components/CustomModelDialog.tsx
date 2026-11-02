"use client";

import { useModelCopy } from "@/i18n/use-model-copy";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { configRequest, providerErrorMessage } from "../lib/api";
import { fieldClass } from "./styles";
import { type CatalogModel, type MediaType, type ProviderDefinition } from "../types";

export function CustomModelDialog({ provider, templates, onClose, onSaved, returnFocus }: { returnFocus: React.RefObject<HTMLElement | null>; provider: ProviderDefinition; templates: CatalogModel[]; onClose: () => void; onSaved: () => Promise<void> }) {
    const t = useTranslations("providers");
    const { modelLabel } = useModelCopy();
    const common = useTranslations("common");
    const [mediaType, setMediaType] = useState<MediaType>("image");
    const [name, setName] = useState("");
    const [upstream, setUpstream] = useState("");
    const [localId, setLocalId] = useState("");
    const [json, setJson] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const generatedId = `${provider.id}__${upstream.trim().replace(/[^a-zA-Z0-9._-]+/g, "-")}`;

    function loadTemplate(id: string) {
        const source = templates.find(entry => entry.mediaType === mediaType && entry.model.id === id);
        if (!source) { setJson(""); return; }
        const model = { ...source.model };
        delete model.catalog_source;
        delete model.catalog_status;
        setJson(JSON.stringify(model, null, 2));
    }
    async function save(event: React.FormEvent) {
        event.preventDefault(); setError("");
        let capabilities: Record<string, unknown>;
        try {
            capabilities = JSON.parse(json);
            if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) throw new Error();
        } catch { setError(t("modelInvalid")); return; }
        if (capabilities.provider !== provider.id) { setError(t("modelProviderMismatch")); return; }
        const id = localId.trim() || generatedId;
        if (templates.some(entry => entry.model.id === id && entry.mediaType === mediaType)) { setError(t("modelDuplicate")); return; }
        setSaving(true);
        try {
            await configRequest("/api/catalog", "POST", { mediaType, capabilities: { ...capabilities, id, label: name.trim(), provider_model_id: upstream.trim() }, enabled: false });
            onClose();
            // The write is confirmed; a failed list refresh must not invite another POST.
            void onSaved().catch(() => undefined);
        } catch (failure) { setError(providerErrorMessage(failure, t, "modelInvalid")); }
        finally { setSaving(false); }
    }
    return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}><DialogContent finalFocus={returnFocus} closeLabel={common("close")} showCloseButton={!saving} className="max-h-[90dvh] overflow-y-auto bg-[#141618] p-5 sm:max-w-2xl sm:p-6">
        <div><DialogTitle className="pr-6 text-xl leading-snug">{t("addModelTitle", { provider: provider.label })}</DialogTitle><DialogDescription className="mt-2 leading-relaxed">{t("addModelHint")}</DialogDescription></div>
        <form onSubmit={save} className="space-y-4">
            {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
            <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2"><span className="text-sm font-medium">{t("mediaType")}</span><select className={fieldClass} value={mediaType} onChange={event => { setMediaType(event.target.value as MediaType); setJson(""); }}><option value="image">{t("images")}</option><option value="video">{t("videos")}</option></select></label><label className="space-y-2"><span className="text-sm font-medium">{t("template")}</span><select key={mediaType} defaultValue="" onChange={event => loadTemplate(event.target.value)} className={fieldClass}><option value="">{t("chooseTemplate")}</option>{templates.filter(entry => entry.mediaType === mediaType).map(({ model }) => <option key={model.id} value={model.id}>{modelLabel(model.label)}</option>)}</select></label></div>
            <label className="block space-y-2"><span className="text-sm font-medium">{t("modelName")}</span><input required value={name} maxLength={120} onChange={event => setName(event.target.value)} placeholder={t("modelNamePlaceholder")} className={fieldClass} /></label>
            <label className="block space-y-2"><span className="text-sm font-medium">{t("upstreamId")}</span><input required aria-label={t("upstreamId")} aria-describedby="model-id-help" value={upstream} onChange={event => setUpstream(event.target.value)} placeholder={t("modelIdPlaceholder")} className={`${fieldClass} font-mono`} /><span id="model-id-help" className="block text-xs text-muted-foreground">{t("upstreamHint")}</span></label>
            <details className="rounded-xl border border-white/15 p-4"><summary className="cursor-pointer rounded-md text-sm font-medium">{t("advancedModel")}</summary><div className="mt-4 space-y-4"><label className="block space-y-2"><span className="text-sm font-medium">{t("localId")}</span><input value={localId} onChange={event => setLocalId(event.target.value)} placeholder={generatedId} className={`${fieldClass} font-mono`} /></label><label className="block space-y-2"><span className="text-sm font-medium">{t("contract")}</span><textarea aria-label={t("contract")} spellCheck={false} value={json} onChange={event => setJson(event.target.value)} className={`${fieldClass} h-64 resize-y py-3 font-mono text-xs`} /></label><p className="text-xs leading-relaxed text-muted-foreground">{t("contractHint")}</p></div></details>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("disabledHint")}</p>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4"><a href={provider.docsUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground">{t("docs")}<ExternalLink className="size-3" /><span className="sr-only">({t("external")})</span></a><div className="flex gap-2"><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>{t("cancel")}</Button><Button type="submit" disabled={saving || !json.trim() || !name.trim() || !upstream.trim()}>{saving && <Loader2 className="animate-spin" />}{t("saveModel")}</Button></div></div>
        </form>
    </DialogContent></Dialog>;
}
