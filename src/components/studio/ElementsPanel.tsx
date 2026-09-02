"use client";

import { useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, X, Upload, Link2, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Image from "next/image";

function shortId() {
    return Math.random().toString(36).slice(2, 10);
}

interface ImageEntry {
    id: string;
    file?: File;
    url?: string;
    preview?: string;
}

export interface ElementState {
    id: string;
    frontal: ImageEntry | null;
    refs: ImageEntry[];
}

interface ImageSlotProps {
    label: string;
    multiple?: boolean;
    entries: ImageEntry[];
    onAdd: (entry: ImageEntry) => void;
    onRemove: (id: string) => void;
}

function ImageSlot({ label, multiple = false, entries, onAdd, onRemove }: ImageSlotProps) {
    const fileRef = useRef<HTMLInputElement>(null);
    const [urlValue, setUrlValue] = useState("");
    const [dragOver, setDragOver] = useState(false);

    const addFile = useCallback((file: File) => {
        if (!multiple && entries.length > 0) return;
        const preview = URL.createObjectURL(file);
        onAdd({ id: shortId(), file, preview });
    }, [entries.length, multiple, onAdd]);

    function addUrl() {
        const url = urlValue.trim();
        if (!url) return;
        if (!multiple && entries.length > 0) return;
        onAdd({ id: shortId(), url });
        setUrlValue("");
    }

    const onDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setDragOver(false);
            Array.from(e.dataTransfer.files)
                .filter((f) => f.type.startsWith("image/"))
                .forEach(addFile);
        },
        [addFile],
    );

    const canAdd = multiple || entries.length === 0;

    return (
        <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground">{label}</p>

            {entries.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {entries.map((entry) => (
                        <div
                            key={entry.id}
                            className="relative group rounded-md overflow-hidden border bg-muted w-12 h-12 flex-shrink-0"
                        >
                            {entry.preview ? (
                                <Image src={entry.preview} alt="" width={48} height={48} className="w-full h-full object-cover" unoptimized />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                </div>
                            )}
                            <button
                                type="button"
                                onClick={() => onRemove(entry.id)}
                                className="absolute top-0.5 right-0.5 rounded-full bg-background/80 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <X className="h-2.5 w-2.5" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {canAdd && (
                <Tabs defaultValue="upload" className="w-full">
                    <TabsList className="h-6 p-0.5 gap-0">
                        <TabsTrigger value="upload" className="h-5 px-2 text-[10px]">Upload</TabsTrigger>
                        <TabsTrigger value="url" className="h-5 px-2 text-[10px]">URL</TabsTrigger>
                    </TabsList>
                    <TabsContent value="upload" className="mt-1">
                        <div
                            className={`flex items-center justify-center rounded-md border-2 border-dashed p-2 cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
                            onClick={() => fileRef.current?.click()}
                            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={onDrop}
                        >
                            <Upload className="h-3 w-3 text-muted-foreground mr-1" />
                            <span className="text-[10px] text-muted-foreground">Drop or click</span>
                        </div>
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/*"
                            multiple={multiple}
                            className="hidden"
                            onChange={(e) => {
                                if (e.target.files) Array.from(e.target.files).forEach(addFile);
                                e.target.value = "";
                            }}
                        />
                    </TabsContent>
                    <TabsContent value="url" className="mt-1">
                        <div className="flex gap-1">
                            <Input
                                value={urlValue}
                                onChange={(e) => setUrlValue(e.target.value)}
                                placeholder="https://..."
                                className="h-6 text-[10px]"
                                onKeyDown={(e) => e.key === "Enter" && addUrl()}
                            />
                            <Button type="button" size="sm" variant="secondary" className="h-6 px-1.5 text-[10px]" onClick={addUrl}>
                                <Link2 className="h-2.5 w-2.5" />
                            </Button>
                        </div>
                    </TabsContent>
                </Tabs>
            )}
        </div>
    );
}

interface ElementCardProps {
    index: number;
    element: ElementState;
    onChange: (updated: ElementState) => void;
    onRemove: () => void;
}

function ElementCard({ index, element, onChange, onRemove }: ElementCardProps) {
    return (
        <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">
                    @Element{index + 1}
                </span>
                <button
                    type="button"
                    onClick={onRemove}
                    className="rounded p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            <ImageSlot
                label="Frontal Image (optional)"
                multiple={false}
                entries={element.frontal ? [element.frontal] : []}
                onAdd={(entry) => onChange({ ...element, frontal: entry })}
                onRemove={() => onChange({ ...element, frontal: null })}
            />

            <ImageSlot
                label="Reference Images (optional, multiple)"
                multiple={true}
                entries={element.refs}
                onAdd={(entry) => onChange({ ...element, refs: [...element.refs, entry] })}
                onRemove={(id) => onChange({ ...element, refs: element.refs.filter((r) => r.id !== id) })}
            />
        </div>
    );
}

interface ElementsPanelProps {
    elements: ElementState[];
    onChange: (elements: ElementState[]) => void;
}

export function ElementsPanel({ elements, onChange }: ElementsPanelProps) {
    function addElement() {
        if (elements.length >= 6) return;
        onChange([...elements, { id: shortId(), frontal: null, refs: [] }]);
    }

    function updateElement(index: number, updated: ElementState) {
        const next = [...elements];
        next[index] = updated;
        onChange(next);
    }

    function removeElement(index: number) {
        onChange(elements.filter((_, i) => i !== index));
    }

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">
                    Elements{" "}
                    <span className="font-normal text-[10px]">(reference in prompt as @Element1, @Element2…)</span>
                </p>
                {elements.length < 6 && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[10px] gap-1"
                        onClick={addElement}
                    >
                        <Plus className="h-3 w-3" />
                        Add
                    </Button>
                )}
            </div>

            <AnimatePresence>
                {elements.map((elem, i) => (
                    <motion.div
                        key={elem.id}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                    >
                        <ElementCard
                            index={i}
                            element={elem}
                            onChange={(updated) => updateElement(i, updated)}
                            onRemove={() => removeElement(i)}
                        />
                    </motion.div>
                ))}
            </AnimatePresence>

            {elements.length === 0 && (
                <p className="text-[10px] text-muted-foreground italic">
                    No elements added. Add elements to reference consistent characters or objects in your prompt.
                </p>
            )}
        </div>
    );
}
