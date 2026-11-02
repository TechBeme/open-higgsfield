"use client";

import { useTranslations } from "next-intl";
import { useModelCopy } from "@/i18n/use-model-copy";
import { useId } from "react";
import type { CustomFieldCapability } from "@/models/capabilities/types";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

/** One renderer for every documented parameter, including structured options. */
export function ModelField({ field, value, onChange }: { field: CustomFieldCapability; value: unknown; onChange: (value: unknown) => void }) {
    const id = useId();
    const { fieldLabel, description, optionLabel, schema } = useModelCopy();
    const t = useTranslations("commandBar");
    const current = value ?? field.default ?? "";
    const hint = field.description ? description(field.description) : undefined;
    return <div className={`space-y-1.5 min-w-0 ${field.type === "json" ? "sm:col-span-2" : ""}`}>
        <Label htmlFor={id} className="text-xs">{fieldLabel(field.id, field.label)}{field.required ? " *" : ""}</Label>
        {hint && <p id={`${id}-hint`} className="text-[11px] text-muted-foreground whitespace-pre-line break-words">{hint}</p>}
        {field.type === "select" ? <select id={id} aria-describedby={hint ? `${id}-hint` : undefined} className="h-11 w-full rounded-md border border-input bg-background px-2 text-xs" value={String(current)} onChange={e => onChange(e.target.value)}>
            {!field.required && <option value="">{t("default")}</option>}
            {(field.options ?? []).map(option => <option key={option} value={option}>{optionLabel(option)}</option>)}
        </select> : field.type === "checkbox" ? <Switch id={id} aria-describedby={hint ? `${id}-hint` : undefined} checked={Boolean(current)} onCheckedChange={onChange} />
            : field.type === "json" ? <>
                <textarea id={id} aria-describedby={hint ? `${id}-hint` : undefined} className="min-h-24 w-full rounded-md border border-input bg-background p-2 text-xs font-mono" value={typeof current === "string" ? current : JSON.stringify(current, null, 2)} onChange={e => onChange(e.target.value)} placeholder={field.schema?.type === "array" ? "[]" : "{}"} />
                {field.schema && <details className="text-[11px] text-muted-foreground"><summary className="cursor-pointer">{t("acceptedStructure")}</summary><pre tabIndex={0} role="region" aria-label={`${fieldLabel(field.id, field.label)} - ${t("acceptedStructure")}`} className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(schema(field.schema), null, 2)}</pre></details>}
            </> : <Input id={id} aria-describedby={hint ? `${id}-hint` : undefined} type={field.type === "number" ? "number" : "text"} value={String(current)} min={field.minimum} max={field.maximum} minLength={field.minLength} maxLength={field.maxLength} pattern={field.pattern} step={field.step ?? "any"} className="h-11 text-xs" onChange={e => onChange(field.type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)} />}
    </div>;
}
