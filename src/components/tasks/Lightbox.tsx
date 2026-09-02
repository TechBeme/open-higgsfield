"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Download, Volume2, VolumeX } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

interface LightboxProps {
  images: string[];
  index: number;
  modelId?: string;
  prompt?: string;
  mediaType?: "image" | "video";
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
}

export function Lightbox({ images, index, modelId, prompt, mediaType = "image", onClose, onNext, onPrev }: LightboxProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") onNext();
      if (e.key === "ArrowLeft") onPrev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, onNext, onPrev]);

  const isVideo = mediaType === "video";

  return (
    <AnimatePresence>
      <motion.div
        key="lightbox"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
        onClick={onClose}
      >
        {/* Controls bar */}
        <div
          className="absolute top-4 right-4 flex gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          {isVideo && (
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={() => setMuted(!muted)}>
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </Button>
          )}
          <a
            href={images[index]}
            download
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "ghost", size: "icon" }) + " text-white hover:bg-white/10"}
          >
            <Download className="h-5 w-5" />
          </a>
          <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Prev */}
        {images.length > 1 && (
          <button
            className="absolute left-4 text-white hover:bg-white/10 p-2 rounded-full transition-colors"
            onClick={(e) => { e.stopPropagation(); onPrev(); }}
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        {/* Media */}
        <motion.div
          key={index}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="max-w-[90vw] max-h-[90vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {isVideo ? (
            <video
              ref={videoRef}
              key={images[index]}
              src={images[index]}
              className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
              autoPlay
              loop
              playsInline
              muted={muted}
              controls
            />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={images[index]}
              alt={`Image ${index + 1} of ${images.length}`}
              className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            />
          )}
        </motion.div>

        {/* Next */}
        {images.length > 1 && (
          <button
            className="absolute right-4 text-white hover:bg-white/10 p-2 rounded-full transition-colors"
            onClick={(e) => { e.stopPropagation(); onNext(); }}
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}

        {/* Dot pagination */}
        {images.length > 1 && (
          <div className="absolute bottom-6 flex gap-1.5" onClick={(e) => e.stopPropagation()}>
            {images.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-200 ${i === index ? "w-4 bg-white" : "w-1.5 bg-white/40"}`}
              />
            ))}
          </div>
        )}

        {/* Model info */}
        {modelId && (
          <div
            className={`absolute ${images.length > 1 ? "bottom-12" : "bottom-6"} text-xs font-medium px-3 py-1 rounded-lg`}
            style={{ background: "rgba(0,0,0,.6)", color: "rgba(244,247,251,.8)", backdropFilter: "blur(8px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {modelId}
          </div>
        )}

        {/* Prompt */}
        {prompt && (
          <div
            className="absolute top-4 left-4 max-w-[60vw] text-sm leading-relaxed px-4 py-2 rounded-xl"
            style={{ background: "rgba(0,0,0,.6)", color: "rgba(244,247,251,.85)", backdropFilter: "blur(8px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="line-clamp-4">{prompt}</p>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
