type CatalogTranslations = { has: (key: string) => boolean; raw: (key: string) => unknown };

export function modelCopyKey(id: string): string {
    return id.replace(/^metadata\./, "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

/** Content keys deduplicate provider documentation; coverage tests catch changed source text. */
export function catalogTextKey(text: string): string {
    const source = text.trim().replace(/\s+/g, " ");
    let hash = 2166136261;
    for (let index = 0; index < source.length; index++) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
    return `text_${(hash >>> 0).toString(16)}_${source.length}`;
}

export function catalogText(t: CatalogTranslations, section: "descriptions" | "options" | "models", source: string): string {
    const key = `${section}.${catalogTextKey(source)}`;
    // Unknown text belongs to a user-added model and must remain editable as supplied.
    const value = t.has(key) ? t.raw(key) : source;
    return typeof value === "string" ? value : source;
}

/** Only documentation is localized: property names, enums and validation rules stay canonical. */
export function localizeSchema<T>(schema: T, translate: (text: string) => string): T {
    if (Array.isArray(schema)) return schema.map(value => localizeSchema(value, translate)) as T;
    if (!schema || typeof schema !== "object") return schema;
    return Object.fromEntries(Object.entries(schema).map(([key, value]) => [key,
        (key === "description" || key === "title") && typeof value === "string" ? translate(value)
            : ["properties", "$defs", "definitions", "patternProperties"].includes(key) && value && typeof value === "object"
                ? Object.fromEntries(Object.entries(value).map(([name, child]) => [name, localizeSchema(child, translate)]))
                : ["items", "additionalProperties", "allOf", "anyOf", "oneOf", "not", "if", "then", "else"].includes(key) ? localizeSchema(value, translate) : value,
    ])) as T;
}
