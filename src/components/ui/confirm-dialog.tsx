"use client";

import { useRef } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

export function ConfirmDialog({ open, onClose, onConfirm, title, description, error, returnFocus, confirmLabel, cancelLabel, busy = false }: {
    open: boolean; onClose: () => void; onConfirm: () => void;
    returnFocus?: React.RefObject<HTMLElement | null>;
    title: string; description: string; error?: string; confirmLabel: string; cancelLabel: string; busy?: boolean;
}) {
    const cancel = useRef<HTMLButtonElement>(null);
    return <Dialog open={open} onOpenChange={next => { if (!next && !busy) onClose(); }}>
        <DialogContent role="alertdialog" initialFocus={cancel} finalFocus={returnFocus} closeLabel={cancelLabel} showCloseButton={!busy} className="bg-[#141618] p-6 sm:max-w-md">
            <DialogTitle className="pr-6 text-lg leading-snug">{title}</DialogTitle>
            <DialogDescription className="leading-relaxed">{description}</DialogDescription>
            {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
            <div className="mt-2 flex flex-wrap justify-end gap-2"><Button ref={cancel} variant="outline" onClick={onClose} disabled={busy}>{cancelLabel}</Button><Button variant="destructive" onClick={onConfirm} disabled={busy}>{busy && <Loader2 className="animate-spin" />}{confirmLabel}</Button></div>
        </DialogContent>
    </Dialog>;
}
