import "server-only";

/** Reviewed snapshot of https://ai-gateway.vercel.sh/v1/models, 2026-11-01.
 * Vendor generation controls: https://ai-sdk.dev/providers/ai-sdk-providers/.
 * Operational controls (routing, callbacks, credentials) are intentionally server-owned.
 */
import type { CustomFieldCapability, MediaSlotCapability, ModelCapabilities, ParameterSchema } from "@/models/capabilities/types";

type ImageCapability = ModelCapabilities & { has_edit_variant: boolean };
interface VideoLimits { max_count?: number; max_file_size_mb?: number; supported_formats?: string[]; [key: string]: unknown }
interface CatalogModel { id: string; name: string; type: string; video?: {
    supported_operations?: string[]; supported_resolutions?: string[]; supported_aspect_ratios?: string[];
    supported_durations_seconds?: number[]; generate_audio?: boolean; supported_fps?: number[];
    max_sample_count?: number; input_limits?: { image?: VideoLimits; video?: VideoLimits; audio?: VideoLimits; text?: VideoLimits; max_total_inputs?: number };
} }

// BEGIN OFFICIAL CATALOG SNAPSHOT
const CATALOG: CatalogModel[] = [
    {"id":"alibaba/wan-v2.5-t2v-preview","name":"Wan v2.5 Text-to-Video Preview","type":"video","video":{"supported_operations":["text-to-video"],"supported_resolutions":["480p","720p","1080p"],"supported_aspect_ratios":["16:9","9:16","1:1","4:3","3:4"],"supported_durations_seconds":[5,10],"generate_audio":true,"supported_fps":[24],"input_limits":{"text":{"max_chars":1500},"audio":{"max_file_size_mb":15,"supported_formats":["wav","mp3"],"supported_sources":["url"],"min_duration_seconds":3,"max_duration_seconds":30}}}},
    {"id":"alibaba/wan-v2.6-i2v","name":"Wan v2.6 Image-to-Video","type":"video","video":{"supported_operations":["image-to-video"],"supported_resolutions":["720p","1080p"],"supported_aspect_ratios":["16:9","9:16","1:1","4:3","3:4"],"supported_durations_seconds":[2,3,4,5,6,7,8,9,10,11,12,13,14,15],"generate_audio":true,"supported_fps":[24],"input_limits":{"text":{"max_chars":1500},"image":{"max_count":1,"max_file_size_mb":20,"supported_formats":["jpeg","jpg","png","bmp","webp"],"supported_sources":["url"],"min_dimension_pixels":240,"max_dimension_pixels":8000},"audio":{"max_file_size_mb":15,"supported_formats":["wav","mp3"],"supported_sources":["url"],"min_duration_seconds":3,"max_duration_seconds":30}}}},
    {"id":"alibaba/wan-v2.6-i2v-flash","name":"Wan v2.6 Image-to-Video Flash","type":"video","video":{"supported_operations":["image-to-video"],"supported_resolutions":["720p","1080p"],"supported_aspect_ratios":["16:9","9:16","1:1","4:3","3:4"],"supported_durations_seconds":[2,3,4,5,6,7,8,9,10,11,12,13,14,15],"generate_audio":true,"supported_fps":[24],"input_limits":{"text":{"max_chars":1500},"image":{"max_count":1,"max_file_size_mb":20,"supported_formats":["jpeg","jpg","png","bmp","webp"],"supported_sources":["url"],"min_dimension_pixels":240,"max_dimension_pixels":8000},"audio":{"max_file_size_mb":15,"supported_formats":["wav","mp3"],"supported_sources":["url"],"min_duration_seconds":3,"max_duration_seconds":30}}}},
    {"id":"alibaba/wan-v2.6-r2v","name":"Wan v2.6 Reference-to-Video","type":"video","video":{"supported_operations":["reference-to-video"],"supported_resolutions":["720p","1080p"],"supported_aspect_ratios":["16:9","9:16","1:1","4:3","3:4"],"supported_durations_seconds":[2,3,4,5,6,7,8,9,10],"generate_audio":true,"supported_fps":[24],"input_limits":{"text":{"max_chars":1500},"image":{"max_count":5,"max_file_size_mb":20,"supported_formats":["jpeg","jpg","png","bmp","webp"],"supported_sources":["url"],"min_dimension_pixels":240,"max_dimension_pixels":8000},"video":{"max_count":3,"max_file_size_mb":100,"supported_formats":["mp4","mov"],"supported_sources":["url"],"min_duration_seconds":1,"max_duration_seconds":30},"max_total_inputs":5}}},
    {"id":"alibaba/wan-v2.6-r2v-flash","name":"Wan v2.6 Reference-to-Video Flash","type":"video","video":{"supported_operations":["reference-to-video"],"supported_resolutions":["720p","1080p"],"supported_aspect_ratios":["16:9","9:16","1:1","4:3","3:4"],"supported_durations_seconds":[2,3,4,5,6,7,8,9,10],"generate_audio":true,"supported_fps":[24],"input_limits":{"text":{"max_chars":1500},"image":{"max_count":5,"max_file_size_mb":20,"supported_formats":["jpeg","jpg","png","bmp","webp"],"supported_sources":["url"],"min_dimension_pixels":240,"max_dimension_pixels":8000},"video":{"max_count":3,"max_file_size_mb":100,"supported_formats":["mp4","mov"],"supported_sources":["url"],"min_duration_seconds":1,"max_duration_seconds":30},"max_total_inputs":5}}},
    {"id":"alibaba/wan-v2.6-t2v","name":"Wan v2.6 Text-to-Video","type":"video","video":{"supported_operations":["text-to-video"],"supported_resolutions":["720p","1080p"],"supported_aspect_ratios":["16:9","9:16","1:1","4:3","3:4"],"supported_durations_seconds":[2,3,4,5,6,7,8,9,10,11,12,13,14,15],"generate_audio":true,"supported_fps":[24],"input_limits":{"text":{"max_chars":1500},"audio":{"max_file_size_mb":15,"supported_formats":["wav","mp3"],"supported_sources":["url"],"min_duration_seconds":3,"max_duration_seconds":30}}}},
    {"id":"alibaba/wan-v2.7-r2v","name":"Wan v2.7 Reference-to-Video","type":"video","video":{"supported_operations":["reference-to-video"],"supported_resolutions":["720p","1080p"],"supported_aspect_ratios":["16:9","9:16","1:1","4:3","3:4"],"supported_durations_seconds":[2,3,4,5,6,7,8,9,10],"generate_audio":true,"supported_fps":[24],"input_limits":{"text":{"max_chars":5000},"image":{"max_count":5,"max_file_size_mb":20,"supported_formats":["jpeg","jpg","png","bmp","webp"],"supported_sources":["url","base64"],"min_dimension_pixels":240,"max_dimension_pixels":8000,"min_aspect_ratio":"1:8","max_aspect_ratio":"8:1"},"video":{"max_count":3,"max_file_size_mb":100,"supported_formats":["mp4","mov"],"supported_sources":["url"],"min_duration_seconds":1,"max_duration_seconds":30,"min_dimension_pixels":240,"max_dimension_pixels":4096},"audio":{"max_file_size_mb":15,"supported_formats":["wav","mp3"],"supported_sources":["url"],"min_duration_seconds":1,"max_duration_seconds":10},"max_total_inputs":5}}},
    {"id":"alibaba/wan-v2.7-t2v","name":"Wan v2.7 Text-to-Video","type":"video","video":{"supported_operations":["text-to-video"],"supported_resolutions":["720p","1080p"],"supported_aspect_ratios":["16:9","9:16","1:1","4:3","3:4"],"supported_durations_seconds":[2,3,4,5,6,7,8,9,10,11,12,13,14,15],"generate_audio":true,"supported_fps":[24],"input_limits":{"text":{"max_chars":5000},"audio":{"max_file_size_mb":15,"supported_formats":["wav","mp3"],"supported_sources":["url"],"min_duration_seconds":2,"max_duration_seconds":30}}}},
    {"id":"alibaba/wan-v3.0-video","name":"Wan v3.0 Video","type":"video","video":{"supported_operations":["text-to-video","image-to-video","first-last-frame","reference-to-video"],"supported_resolutions":["480p","720p","1080p"],"supported_aspect_ratios":["16:9","4:3","1:1","3:4","9:16","adaptive"],"supported_durations_seconds":[2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],"supported_fps":[30],"max_sample_count":1,"input_limits":{"text":{"max_chars":20000},"image":{"max_count":10,"max_file_size_mb":20,"supported_formats":["jpeg","jpg","png","bmp","webp"],"supported_sources":["url","base64"],"min_dimension_pixels":240,"max_dimension_pixels":8000,"min_aspect_ratio":"1:8","max_aspect_ratio":"8:1"},"video":{"max_count":5,"max_file_size_mb":100,"supported_formats":["mp4","mov"],"supported_sources":["url"],"min_duration_seconds":1,"max_duration_seconds":15,"min_dimension_pixels":240,"max_dimension_pixels":4096},"audio":{"max_file_size_mb":15,"supported_formats":["wav","mp3"],"supported_sources":["url"],"min_duration_seconds":1,"max_duration_seconds":15}}}},
    {"id":"alibaba/wan-v3.0-video-prime","name":"Wan v3.0 Video Prime","type":"video","video":{"supported_operations":["text-to-video","image-to-video","first-last-frame","reference-to-video"],"supported_resolutions":["480p","720p","1080p"],"supported_aspect_ratios":["16:9","4:3","1:1","3:4","9:16","adaptive"],"supported_durations_seconds":[2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],"supported_fps":[30],"max_sample_count":1,"input_limits":{"text":{"max_chars":20000},"image":{"max_count":10,"max_file_size_mb":20,"supported_formats":["jpeg","jpg","png","bmp","webp"],"supported_sources":["url","base64"],"min_dimension_pixels":240,"max_dimension_pixels":8000,"min_aspect_ratio":"1:8","max_aspect_ratio":"8:1"},"video":{"max_count":5,"max_file_size_mb":100,"supported_formats":["mp4","mov"],"supported_sources":["url"],"min_duration_seconds":1,"max_duration_seconds":15,"min_dimension_pixels":240,"max_dimension_pixels":4096},"audio":{"max_file_size_mb":15,"supported_formats":["wav","mp3"],"supported_sources":["url"],"min_duration_seconds":1,"max_duration_seconds":15}}}},
    {"id":"bfl/flux-2-flex","name":"FLUX.2 [flex]","type":"image"},
    {"id":"bfl/flux-2-klein-4b","name":"FLUX.2 [klein] 4B","type":"image"},
    {"id":"bfl/flux-2-klein-9b","name":"FLUX.2 [klein] 9B","type":"image"},
    {"id":"bfl/flux-2-max","name":"FLUX.2 [max]","type":"image"},
    {"id":"bfl/flux-2-pro","name":"FLUX.2 [pro]","type":"image"},
    {"id":"bfl/flux-3-image","name":"FLUX 3 Image","type":"image"},
    {"id":"bfl/flux-3-image-klein","name":"FLUX 3 Image Klein","type":"image"},
    {"id":"bfl/flux-3-video","name":"Flux 3","type":"video","video":{"supported_operations":["text-to-video","image-to-video","first-last-frame","extend-video"],"supported_resolutions":["hd","fhd"],"supported_aspect_ratios":["21:9","2:1","16:9","4:3","1:1","3:4","9:16"],"supported_durations_seconds":[5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],"generate_audio":true,"supported_fps":[24],"input_limits":{"image":{"max_count":10,"supported_sources":["url","base64"]},"video":{"max_count":1,"supported_formats":["mp4"],"supported_sources":["url","base64"]}}}},
    {"id":"bfl/flux-kontext-max","name":"FLUX.1 Kontext Max","type":"image"},
    {"id":"bfl/flux-kontext-pro","name":"FLUX.1 Kontext Pro","type":"image"},
    {"id":"bfl/flux-pro-1.0-fill","name":"FLUX.1 Fill [pro]","type":"image"},
    {"id":"bfl/flux-pro-1.1","name":"FLUX1.1 [pro]","type":"image"},
    {"id":"bfl/flux-pro-1.1-ultra","name":"FLUX1.1 [pro] Ultra","type":"image"},
    {"id":"bytedance/seedance-2.0","name":"Seedance 2.0","type":"video","video":{"supported_operations":["text-to-video","image-to-video","first-last-frame","reference-to-video"],"supported_resolutions":["480p","720p","1080p","4k"],"supported_aspect_ratios":["16:9","4:3","1:1","3:4","9:16","21:9"],"supported_durations_seconds":[4,5,6,7,8,9,10,11,12,13,14,15],"generate_audio":true,"supported_fps":[24],"input_limits":{"image":{"max_count":9,"max_file_size_mb":30,"supported_formats":["jpeg","png","webp","bmp","tiff","gif"],"supported_sources":["url"],"min_dimension_pixels":300,"max_dimension_pixels":6000,"min_aspect_ratio":"2:5","max_aspect_ratio":"5:2"},"video":{"max_count":3,"max_file_size_mb":50,"supported_formats":["mp4","mov"],"supported_sources":["url"],"min_duration_seconds":2,"max_duration_seconds":15,"min_dimension_pixels":300,"max_dimension_pixels":6000},"audio":{"max_file_size_mb":15,"supported_formats":["wav","mp3"],"supported_sources":["url"],"min_duration_seconds":2,"max_duration_seconds":15}}}},
    {"id":"bytedance/seedance-2.0-fast","name":"Seedance 2.0 Fast","type":"video","video":{"supported_operations":["text-to-video","image-to-video","first-last-frame","reference-to-video"],"supported_resolutions":["480p","720p"],"supported_aspect_ratios":["16:9","4:3","1:1","3:4","9:16","21:9"],"supported_durations_seconds":[4,5,6,7,8,9,10,11,12,13,14,15],"generate_audio":true,"supported_fps":[24],"input_limits":{"image":{"max_count":9,"max_file_size_mb":30,"supported_formats":["jpeg","png","webp","bmp","tiff","gif"],"supported_sources":["url"],"min_dimension_pixels":300,"max_dimension_pixels":6000,"min_aspect_ratio":"2:5","max_aspect_ratio":"5:2"},"video":{"max_count":3,"max_file_size_mb":50,"supported_formats":["mp4","mov"],"supported_sources":["url"],"min_duration_seconds":2,"max_duration_seconds":15,"min_dimension_pixels":300,"max_dimension_pixels":6000},"audio":{"max_file_size_mb":15,"supported_formats":["wav","mp3"],"supported_sources":["url"],"min_duration_seconds":2,"max_duration_seconds":15}}}},
    {"id":"bytedance/seedance-2.0-mini","name":"Seedance 2.0 Mini","type":"video","video":{"supported_operations":["text-to-video","image-to-video","first-last-frame","reference-to-video"],"supported_resolutions":["480p","720p"],"supported_aspect_ratios":["16:9","4:3","1:1","3:4","9:16","21:9"],"supported_durations_seconds":[4,5,6,7,8,9,10,11,12,13,14,15],"generate_audio":true,"supported_fps":[24],"input_limits":{"image":{"max_count":9,"max_file_size_mb":30,"supported_formats":["jpeg","png","webp","bmp","tiff","gif"],"supported_sources":["url"],"min_dimension_pixels":300,"max_dimension_pixels":6000,"min_aspect_ratio":"2:5","max_aspect_ratio":"5:2"},"video":{"max_count":3,"max_file_size_mb":50,"supported_formats":["mp4","mov"],"supported_sources":["url"],"min_duration_seconds":2,"max_duration_seconds":15,"min_dimension_pixels":300,"max_dimension_pixels":6000},"audio":{"max_file_size_mb":15,"supported_formats":["wav","mp3"],"supported_sources":["url"],"min_duration_seconds":2,"max_duration_seconds":15}}}},
    {"id":"bytedance/seedance-2.5","name":"Seedance 2.5","type":"video","video":{"supported_operations":["text-to-video","image-to-video","first-last-frame","reference-to-video","video-editing","extend-video"],"supported_resolutions":["480p","720p","1080p"],"supported_aspect_ratios":["16:9","4:3","1:1","3:4","9:16","21:9","adaptive"],"supported_durations_seconds":[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],"generate_audio":true,"supported_fps":[24],"input_limits":{"image":{"max_count":30,"max_file_size_mb":30,"supported_formats":["jpeg","png","webp","bmp","tiff","gif","heic","heif"],"supported_sources":["url"],"min_dimension_pixels":300,"max_dimension_pixels":6000,"min_aspect_ratio":"2:5","max_aspect_ratio":"5:2"},"video":{"max_count":10,"max_file_size_mb":200,"supported_formats":["mp4","mov"],"supported_sources":["url"],"min_duration_seconds":2,"max_duration_seconds":30,"min_dimension_pixels":300,"max_dimension_pixels":6000},"audio":{"max_file_size_mb":15,"supported_formats":["mp3","wav"],"supported_sources":["url"],"min_duration_seconds":2,"max_duration_seconds":30},"max_total_inputs":50}}},
    {"id":"bytedance/seedance-v1.0-pro","name":"Seedance v1.0 Pro","type":"video","video":{"supported_operations":["text-to-video","image-to-video","first-last-frame"],"supported_resolutions":["480p","720p","1080p"],"supported_aspect_ratios":["16:9","4:3","1:1","3:4","9:16","21:9"],"supported_durations_seconds":[2,3,4,5,6,7,8,9,10,11,12],"generate_audio":false,"supported_fps":[24],"input_limits":{"image":{"max_count":2,"max_file_size_mb":30,"supported_formats":["jpeg","png","webp","bmp","tiff","gif"],"supported_sources":["url"],"min_dimension_pixels":300,"max_dimension_pixels":6000,"min_aspect_ratio":"2:5","max_aspect_ratio":"5:2"}}}},
    {"id":"bytedance/seedance-v1.0-pro-fast","name":"Seedance v1.0 Pro Fast","type":"video","video":{"supported_operations":["text-to-video","image-to-video"],"supported_resolutions":["480p","720p","1080p"],"supported_aspect_ratios":["16:9","4:3","1:1","3:4","9:16","21:9"],"supported_durations_seconds":[2,3,4,5,6,7,8,9,10,11,12],"generate_audio":false,"supported_fps":[24],"input_limits":{"image":{"max_count":1,"max_file_size_mb":30,"supported_formats":["jpeg","png","webp","bmp","tiff","gif"],"supported_sources":["url"],"min_dimension_pixels":300,"max_dimension_pixels":6000,"min_aspect_ratio":"2:5","max_aspect_ratio":"5:2"}}}},
    {"id":"bytedance/seedance-v1.5-pro","name":"Seedance v1.5 Pro","type":"video","video":{"supported_operations":["text-to-video","image-to-video","first-last-frame"],"supported_resolutions":["480p","720p","1080p"],"supported_aspect_ratios":["16:9","4:3","1:1","3:4","9:16","21:9"],"supported_durations_seconds":[4,5,6,7,8,9,10,11,12],"generate_audio":true,"supported_fps":[24],"input_limits":{"image":{"max_count":2,"max_file_size_mb":30,"supported_formats":["jpeg","png","webp","bmp","tiff","gif","heic","heif"],"supported_sources":["url"],"min_dimension_pixels":300,"max_dimension_pixels":6000,"min_aspect_ratio":"2:5","max_aspect_ratio":"5:2"}}}},
    {"id":"bytedance/seedream-4.0","name":"Seedream 4.0","type":"image"},
    {"id":"bytedance/seedream-4.5","name":"Seedream 4.5","type":"image"},
    {"id":"bytedance/seedream-5.0-lite","name":"Seedream 5.0 Lite","type":"image"},
    {"id":"bytedance/seedream-5.0-pro","name":"Seedream 5.0 Pro","type":"image"},
    {"id":"google/gemini-2.5-flash-image","name":"Nano Banana (Gemini 2.5 Flash Image)","type":"language"},
    {"id":"google/gemini-3-pro-image","name":"Nano Banana Pro (Gemini 3 Pro Image)","type":"language"},
    {"id":"google/gemini-3.1-flash-image","name":"Gemini 3.1 Flash Image (Nano Banana 2)","type":"language"},
    {"id":"google/gemini-3.1-flash-image-preview","name":"Gemini 3.1 Flash Image Preview (Nano Banana 2)","type":"language"},
    {"id":"google/gemini-3.1-flash-lite-image","name":"Gemini 3.1 Flash Lite Image (Nano Banana 2 Lite)","type":"language"},
    {"id":"google/gemini-nano-banana-2.1","name":"Gemini Nano Banana 2.1","type":"language"},
    {"id":"google/veo-3.0-fast-generate-001","name":"Veo 3.0 Fast Generate","type":"video","video":{"supported_operations":["text-to-video","image-to-video"],"supported_resolutions":["720p","1080p"],"supported_aspect_ratios":["16:9","9:16"],"supported_durations_seconds":[4,6,8],"generate_audio":true,"supported_fps":[24],"max_sample_count":4,"input_limits":{"image":{"max_count":1,"max_file_size_mb":20,"supported_formats":["jpg","jpeg","png"],"supported_sources":["url","base64"]}}}},
    {"id":"google/veo-3.0-generate-001","name":"Veo 3.0","type":"video","video":{"supported_operations":["text-to-video","image-to-video"],"supported_resolutions":["720p","1080p"],"supported_aspect_ratios":["16:9","9:16"],"supported_durations_seconds":[4,6,8],"generate_audio":true,"supported_fps":[24],"max_sample_count":4,"input_limits":{"image":{"max_count":1,"max_file_size_mb":20,"supported_formats":["jpg","jpeg","png"],"supported_sources":["url","base64"]}}}},
    {"id":"google/veo-3.1-fast-generate-001","name":"Veo 3.1 Fast Generate","type":"video","video":{"supported_operations":["text-to-video","image-to-video","first-last-frame","reference-to-video","extend-video"],"supported_resolutions":["720p","1080p","4k"],"supported_aspect_ratios":["16:9","9:16"],"supported_durations_seconds":[4,6,8],"generate_audio":true,"supported_fps":[24],"max_sample_count":4,"input_limits":{"image":{"max_count":3,"max_file_size_mb":20,"supported_formats":["jpg","jpeg","png"],"supported_sources":["url","base64"]},"video":{"max_count":1,"supported_formats":["mp4"],"supported_sources":["url"]}}}},
    {"id":"google/veo-3.1-generate-001","name":"Veo 3.1","type":"video","video":{"supported_operations":["text-to-video","image-to-video","first-last-frame","reference-to-video","extend-video"],"supported_resolutions":["720p","1080p","4k"],"supported_aspect_ratios":["16:9","9:16"],"supported_durations_seconds":[4,6,8],"generate_audio":true,"supported_fps":[24],"max_sample_count":4,"input_limits":{"image":{"max_count":3,"max_file_size_mb":20,"supported_formats":["jpg","jpeg","png"],"supported_sources":["url","base64"]},"video":{"max_count":1,"supported_formats":["mp4"],"supported_sources":["url"]}}}},
    {"id":"google/veo-3.1-lite-generate-001","name":"Veo 3.1 Lite Generate","type":"video","video":{"supported_operations":["text-to-video"],"supported_resolutions":["720p","1080p"],"supported_aspect_ratios":["9:16","16:9"],"supported_durations_seconds":[4,6,8],"supported_fps":[24],"max_sample_count":4,"input_limits":{"image":{"max_count":3,"max_file_size_mb":20,"supported_formats":["jpg","jpeg","png"],"supported_sources":["url","base64"]},"video":{"max_count":1,"supported_formats":["mp4"],"supported_sources":["url"]}}}},
    {"id":"heygen/heygen-video-1","name":"HeyGen Video","type":"video","video":{"supported_operations":["text-to-video","image-to-video","reference-to-video"],"supported_resolutions":["480p","768p","1080p","2k"],"supported_aspect_ratios":["21:9","16:9","4:3","1:1","3:4","9:16"],"supported_durations_seconds":[5,6,7,8,9,10,11,12,13,14,15],"generate_audio":true,"supported_fps":[24],"max_sample_count":1,"input_limits":{"image":{"max_count":9,"supported_sources":["url","base64","buffer"]},"video":{"max_count":3,"max_file_size_mb":16,"supported_sources":["url","base64","buffer"],"max_duration_seconds":5},"audio":{"supported_sources":["url","base64","buffer"]}}}},
    {"id":"klingai/kling-v2.5-turbo-i2v","name":"Kling v2.5 Turbo Image-to-Video","type":"video","video":{"supported_operations":["image-to-video","first-last-frame"],"supported_resolutions":["720p","1080p"],"supported_aspect_ratios":["16:9","9:16","1:1"],"supported_durations_seconds":[5,10],"generate_audio":true,"supported_fps":[30],"input_limits":{"text":{"max_chars":2500},"image":{"max_count":2,"max_file_size_mb":10,"supported_formats":["jpg","jpeg","png"],"supported_sources":["url","base64","buffer"],"min_dimension_pixels":300,"min_aspect_ratio":"2:5","max_aspect_ratio":"5:2"}}}},
    {"id":"klingai/kling-v2.5-turbo-t2v","name":"Kling v2.5 Turbo Text-to-Video","type":"video","video":{"supported_operations":["text-to-video"],"supported_resolutions":["720p","1080p"],"supported_aspect_ratios":["16:9","9:16","1:1"],"supported_durations_seconds":[5,10],"generate_audio":true,"supported_fps":[30],"input_limits":{"text":{"max_chars":2500}}}},
    {"id":"klingai/kling-v2.6-i2v","name":"Kling v2.6 Image-to-Video","type":"video","video":{"supported_operations":["image-to-video","first-last-frame"],"supported_resolutions":["720p","1080p"],"supported_aspect_ratios":["16:9","9:16","1:1"],"supported_durations_seconds":[5,10],"generate_audio":true,"supported_fps":[30],"input_limits":{"text":{"max_chars":2500},"image":{"max_count":2,"max_file_size_mb":10,"supported_formats":["jpg","jpeg","png"],"supported_sources":["url","base64","buffer"],"min_dimension_pixels":300,"min_aspect_ratio":"2:5","max_aspect_ratio":"5:2"}}}},
    {"id":"klingai/kling-v2.6-motion-control","name":"Kling v2.6 Motion Control","type":"video","video":{"supported_operations":["motion-control"],"supported_resolutions":["720p","1080p"],"supported_aspect_ratios":["16:9","9:16","1:1"],"supported_durations_seconds":[3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],"generate_audio":false,"supported_fps":[30],"input_limits":{"text":{"max_chars":2500},"image":{"max_count":1,"max_file_size_mb":10,"supported_formats":["jpg","jpeg","png"],"supported_sources":["url","base64","buffer"],"min_dimension_pixels":300,"min_aspect_ratio":"2:5","max_aspect_ratio":"5:2"},"video":{"max_count":1,"max_file_size_mb":100,"supported_formats":["mp4","mov"],"supported_sources":["url"],"min_duration_seconds":3,"max_duration_seconds":30,"min_dimension_pixels":340,"max_dimension_pixels":3850}}}},
    {"id":"klingai/kling-v2.6-t2v","name":"Kling v2.6 Text-to-Video","type":"video","video":{"supported_operations":["text-to-video"],"supported_resolutions":["720p","1080p"],"supported_aspect_ratios":["16:9","9:16","1:1"],"supported_durations_seconds":[5,10],"generate_audio":true,"supported_fps":[30],"input_limits":{"text":{"max_chars":2500}}}},
    {"id":"klingai/kling-v3.0-i2v","name":"Kling v3.0 Image-to-Video","type":"video","video":{"supported_operations":["image-to-video","first-last-frame","reference-to-video"],"supported_resolutions":["720p","1080p","4k"],"supported_aspect_ratios":["16:9","9:16","1:1"],"supported_durations_seconds":[3,4,5,6,7,8,9,10,11,12,13,14,15],"generate_audio":true,"supported_fps":[30],"input_limits":{"text":{"max_chars":2500},"image":{"max_count":3,"max_file_size_mb":10,"supported_formats":["jpg","jpeg","png"],"supported_sources":["url","base64","buffer"],"min_dimension_pixels":300,"min_aspect_ratio":"2:5","max_aspect_ratio":"5:2"}}}},
    {"id":"klingai/kling-v3.0-motion-control","name":"Kling v3.0 Motion Control","type":"video","video":{"supported_operations":["motion-control"],"supported_resolutions":["720p","1080p"],"supported_aspect_ratios":["16:9","9:16","1:1"],"supported_durations_seconds":[3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30],"generate_audio":false,"supported_fps":[30],"input_limits":{"text":{"max_chars":2500},"image":{"max_count":1,"max_file_size_mb":10,"supported_formats":["jpg","jpeg","png"],"supported_sources":["url","base64","buffer"],"min_dimension_pixels":300,"min_aspect_ratio":"2:5","max_aspect_ratio":"5:2"},"video":{"max_count":1,"max_file_size_mb":100,"supported_formats":["mp4","mov"],"supported_sources":["url"],"min_duration_seconds":3,"max_duration_seconds":30,"min_dimension_pixels":340,"max_dimension_pixels":3850}}}},
    {"id":"klingai/kling-v3.0-t2v","name":"Kling v3.0 Text-to-Video","type":"video","video":{"supported_operations":["text-to-video"],"supported_resolutions":["720p","1080p","4k"],"supported_aspect_ratios":["16:9","9:16","1:1"],"supported_durations_seconds":[3,4,5,6,7,8,9,10,11,12,13,14,15],"generate_audio":true,"supported_fps":[30],"input_limits":{"text":{"max_chars":2500}}}},
    {"id":"meta/muse-image-1.0","name":"Muse Image 1.0","type":"image"},
    {"id":"microsoft/mai-image-2.6","name":"MAI-Image-2.6","type":"image"},
    {"id":"microsoft/mai-image-2.6-flash","name":"MAI-Image-2.6-Flash","type":"image"},
    {"id":"minimax/minimax-h3","name":"MiniMax H3","type":"video","video":{"supported_operations":["text-to-video","image-to-video","reference-to-video","first-last-frame"],"supported_resolutions":["2k","768p"],"supported_aspect_ratios":["21:9","16:9","4:3","1:1","3:4","9:16"],"supported_durations_seconds":[4,5,6,7,8,9,10,11,12,13,14,15],"generate_audio":true,"supported_fps":[24],"max_sample_count":1,"input_limits":{"image":{"max_count":9,"max_file_size_mb":30,"supported_formats":["jpg","jpeg","png","webp","heic","heif"],"supported_sources":["url"],"min_dimension_pixels":256,"max_dimension_pixels":5760,"min_aspect_ratio":"2:5","max_aspect_ratio":"5:2"},"video":{"max_count":3,"max_file_size_mb":50,"supported_formats":["h264","h265","mp4"],"supported_sources":["url"],"min_duration_seconds":2,"max_duration_seconds":15,"min_dimension_pixels":256,"max_dimension_pixels":5760},"audio":{"max_file_size_mb":15,"supported_formats":["wav","mp3"],"supported_sources":["url"],"min_duration_seconds":2,"max_duration_seconds":15}}}},
    {"id":"minimax/minimax-h3-max","name":"MiniMax H3 Max","type":"video","video":{"supported_operations":["text-to-video","image-to-video","first-last-frame"],"supported_resolutions":["480p","768p"],"supported_aspect_ratios":["21:9","16:9","4:3","1:1","3:4","9:16"],"supported_durations_seconds":[5,6,7,8,9,10,11,12,13,14,15],"supported_fps":[24],"max_sample_count":1,"input_limits":{"image":{"max_count":2,"max_file_size_mb":30,"supported_formats":["jpg","jpeg","png","webp","heic","heif"],"supported_sources":["url"],"min_dimension_pixels":256,"max_dimension_pixels":5760,"min_aspect_ratio":"2:5","max_aspect_ratio":"5:2"}}}},
    {"id":"openai/gpt-image-1-mini","name":"GPT Image 1 Mini","type":"image"},
    {"id":"openai/gpt-image-1.5","name":"GPT Image 1.5","type":"image"},
    {"id":"openai/gpt-image-2","name":"GPT Image 2","type":"image"},
    {"id":"openai/gpt-image-2.5-flare","name":"GPT Image 2.5 Flare","type":"image"},
    {"id":"openai/gpt-image-2.5-sunburst","name":"GPT Image 2.5 Sunburst","type":"image"},
    {"id":"prodia/flux-fast-schnell","name":"Flux Schnell","type":"image"},
    {"id":"quiverai/arrow-2","name":"Arrow 2","type":"language"},
    {"id":"quiverai/arrow-2-telos","name":"Arrow 2 Telos","type":"language"},
    {"id":"recraft/recraft-v2","name":"Recraft V2","type":"image"},
    {"id":"recraft/recraft-v3","name":"Recraft V3","type":"image"},
    {"id":"recraft/recraft-v4","name":"Recraft V4","type":"image"},
    {"id":"recraft/recraft-v4-pro","name":"Recraft V4 Pro","type":"image"},
    {"id":"recraft/recraft-v4.1","name":"Recraft V4.1","type":"image"},
    {"id":"recraft/recraft-v4.1-flash","name":"Recraft V4.1 Flash","type":"image"},
    {"id":"recraft/recraft-v4.1-pro","name":"Recraft V4.1 Pro","type":"image"},
    {"id":"recraft/recraft-v4.1-utility","name":"Recraft V4.1 Utility","type":"image"},
    {"id":"recraft/recraft-v4.1-utility-pro","name":"Recraft V4.1 Utility Pro","type":"image"},
    {"id":"topaz/proteus","name":"Proteus","type":"video"},
    {"id":"topaz/starlight-precise-2.6","name":"Starlight Precise 2.6","type":"video"},
    {"id":"topaz/wonder-3.5","name":"Wonder 3.5","type":"image"},
    {"id":"spacexai/grok-imagine-image","name":"Grok Imagine Image","type":"image"},
    {"id":"spacexai/grok-imagine-image-2.0","name":"Grok Imagine Image 2.0","type":"image"},
    {"id":"spacexai/grok-imagine-video","name":"Grok Imagine","type":"video","video":{"supported_operations":["text-to-video","image-to-video","reference-to-video","video-editing","extend-video"],"supported_resolutions":["480p","720p"],"supported_aspect_ratios":["1:1","16:9","9:16","4:3","3:4","3:2","2:3"],"supported_durations_seconds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],"generate_audio":false,"supported_fps":[24],"input_limits":{"image":{"max_count":5,"supported_formats":["jpg","jpeg","png","webp","gif","avif"],"supported_sources":["url","base64","buffer"]},"video":{"max_count":1,"supported_sources":["url"],"min_duration_seconds":2,"max_duration_seconds":8.7}}}},
    {"id":"spacexai/grok-imagine-video-1.5","name":"Grok Imagine Video 1.5","type":"video","video":{"supported_operations":["image-to-video","text-to-video","reference-to-video"],"supported_resolutions":["480p","720p","1080p"],"supported_aspect_ratios":["1:1","16:9","9:16","4:3","3:4","3:2","2:3"],"supported_durations_seconds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],"generate_audio":true,"supported_fps":[24],"input_limits":{"image":{"max_count":7,"supported_sources":["url","base64"]},"audio":{"supported_sources":["url"]}}}},
    {"id":"spacexai/grok-imagine-video-1.5-lite","name":"Grok Imagine Video 1.5 Lite","type":"video","video":{"supported_operations":["text-to-video","image-to-video"],"supported_resolutions":["480p","720p","1080p"],"supported_aspect_ratios":["1:1","16:9","9:16","4:3","3:4","3:2","2:3"],"supported_durations_seconds":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],"generate_audio":true,"supported_fps":[24],"input_limits":{"image":{"max_count":7,"supported_sources":["url","base64"]},"audio":{"supported_sources":["url"]}}}},
];
// END OFFICIAL CATALOG SNAPSHOT

const ratios = (values: string[]) => values.map(value => [value, value] as [string, string]);
const select = (id: string, options: string[], defaultValue?: string): CustomFieldCapability => ({ id, label: id, type: "select", options, ...(defaultValue === undefined ? {} : { default: defaultValue }) });
const number = (id: string, minimum?: number, maximum?: number, step = 1): CustomFieldCapability => ({ id, label: id, type: "number", minimum, maximum, step });
const boolean = (id: string): CustomFieldCapability => ({ id, label: id, type: "checkbox" });
const text = (id: string, maxLength = 10000): CustomFieldCapability => ({ id, label: id, type: "text", maxLength });
const json = (id: string, schema: ParameterSchema): CustomFieldCapability => ({ id, label: id, type: "json", schema });
const array = (items: ParameterSchema, maxItems: number): ParameterSchema => ({ type: "array", items, maxItems });
const object = (properties: Record<string, ParameterSchema>, required: string[] = []): ParameterSchema => ({ type: "object", properties, required, additionalProperties: false });
const str = (maxLength = 10000): ParameterSchema => ({ type: "string", maxLength });
const num = (minimum?: number, maximum?: number): ParameterSchema => ({ type: "number", minimum, maximum });
const e = (...values: string[]): ParameterSchema => ({ type: "string", enum: values });
const reference = (id = "reference_images", maxCount?: number, required = false): MediaSlotCapability => ({ id, label: id.replaceAll("_", " "), kind: "image", multiple: maxCount !== 1, max_count: maxCount, required });
const standardRatios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];

export function gatewayNamespace(model: string): string {
    return ({ bfl: "blackForestLabs", google: "vertex", spacexai: "xai" } as Record<string, string>)[model.split("/")[0]] ?? model.split("/")[0];
}

function base(model: CatalogModel): ModelCapabilities {
    return {
        id: `vercel-ai-gateway__${model.id.replaceAll("/", "__")}`, label: `${model.name} - AI Gateway`,
        family: model.id.split("/")[0], variant: "AI Gateway", group: "Vercel AI Gateway",
        provider: "vercel-ai-gateway", provider_model_id: model.id,
        provider_mode: model.type === "video" ? "video" : model.type === "language" ? "language-image" : "image-model",
        prompt_required: true, duration: false, aspect_ratio: false, size: false, resolution_variant: false,
        negative_prompt: false, cfg_scale: false, style: false, shot_type: false, prompt_expansion: false,
        elements: false, media_slots: [], custom_fields: [], sort_key: 2000 + CATALOG.indexOf(model),
    };
}

function image(model: CatalogModel): ImageCapability {
    const cap: ImageCapability = { ...base(model), has_edit_variant: false, category: "Generate / Edit" };
    const id = model.id;
    const fields = cap.custom_fields;
    if (id.startsWith("google/")) {
        const newer = id.includes("nano-banana-2.1");
        cap.aspect_ratio = { options: ratios([...standardRatios, "4:5", "5:4", "21:9", ...(newer ? ["1:8", "8:1", "1:4", "4:1"] : [])]), default: ["1:1", "1:1"] };
        cap.media_slots = [reference("reference_images", 14)];
        if (!id.includes("2.5-flash")) cap.resolution_variant = { options: ["1K", "2K", "4K"], default: "1K" };
        if (!id.includes("2.5-flash")) fields.push(select("thinkingLevel", ["minimal", "low", "medium", "high"]));
    } else if (id.startsWith("bfl/")) {
        cap.aspect_ratio = { options: ratios(standardRatios), default: ["1:1", "1:1"] };
        const flux3 = id.includes("flux-3"), klein = id.includes("klein");
        const edit = /flux-[23]|kontext|fill/.test(id);
        if (edit) cap.media_slots = [reference("reference_images", id.includes("fill") ? 1 : 10, id.includes("fill"))];
        if (id.includes("fill")) cap.media_slots.push(reference("mask", 1, true));
        fields.push(select("outputFormat", ["jpeg", "png"]), number("safetyTolerance", 0, flux3 ? 7 : 6));
        if (flux3) {
            cap.resolution_variant = { options: ["768sq", "1k", "1.5k", "2k", "4k"], default: "1k" };
            if (!klein) fields.push(boolean("grounding"), select("version", ["latest"]));
        }
        if (id.includes("flex") || klein || id.includes("fill")) fields.push(number("steps", 1, klein && flux3 ? 16 : undefined), number("guidance", 0, undefined, 0.1));
        if (!flux3 || klein) fields.push(number("width", flux3 ? 64 : 256, flux3 ? 6256 : 1920), number("height", flux3 ? 64 : 256, flux3 ? 6256 : 1920));
        if (/ultra|kontext/.test(id)) fields.push(boolean("raw"), boolean("promptUpsampling"), number("imagePromptStrength", 0, 1, 0.01));
    } else if (id.startsWith("openai/")) {
        cap.size = { options: ratios(["1024x1024", "1536x1024", "1024x1536"]), default: ["1024x1024", "1024x1024"] };
        cap.media_slots = [reference("reference_images", 16), reference("mask", 1)];
        fields.push(select("quality", ["auto", "low", "medium", "high", ...(id.includes("2.5") ? ["xhigh", "max"] : [])]),
            select("background", ["auto", "transparent", "opaque"]), select("outputFormat", ["png", "webp", "jpeg"]),
            number("outputCompression", 0, 100), select("moderation", ["auto", "low"]), select("inputFidelity", ["low", "high"]));
        if (id.includes("2.5")) fields.push(text("customSize", 30));
    } else if (id.startsWith("bytedance/")) {
        const pro = id.endsWith("5.0-pro"), legacy = id.includes("4.0");
        cap.media_slots = [reference("reference_images", pro ? 10 : 14)];
        cap.resolution_variant = { options: pro ? ["1K", "2K"] : legacy ? ["1K", "2K", "4K"] : id.includes("4.5") ? ["2K", "4K"] : ["2K", "3K", "4K"], default: "2K" };
        fields.push(boolean("watermark"), select("sequentialImageGeneration", ["auto", "disabled"]), number("maxImages", 1, pro ? 10 : 15), select("optimizePromptMode", legacy ? ["standard", "fast"] : ["standard"]));
        if (id.includes("5.0")) fields.push(select("outputFormat", ["png", "jpeg"]));
    } else if (id.startsWith("spacexai/")) {
        cap.aspect_ratio = { options: ratios([...standardRatios, "2:1", "1:2", "19.5:9", "9:19.5", "20:9", "9:20", ...(id.includes("2.0") ? ["21:9", "5:2"] : [])]), default: ["1:1", "1:1"] };
        cap.media_slots = [reference("reference_images")];
        cap.resolution_variant = { options: id.includes("2.0") ? ["1k", "1.5k", "2k"] : ["1k"], default: "1k" };
        if (id.includes("2.0")) fields.push(select("quality", ["auto", "low", "medium"]));
    } else if (id.startsWith("quiverai/")) {
        // Gateway catalogs Arrow as a language model; preserve that supported surface.
        cap.media_slots = [reference("reference_images", 4)];
        fields.push(select("reasoningEffort", ["low", "medium", "high", "xhigh"]), number("maxOutputTokens", 1, 65536), number("temperature", 0, 2, 0.1));
    } else if (id.startsWith("topaz/")) {
        cap.prompt_required = false; cap.prompt_supported = false; cap.category = "Enhance";
        cap.media_slots = [reference("reference_images", 1, true)];
        fields.push(select("enhancementStrength", ["low", "medium", "high"]), boolean("grain"), number("grainDensity", 0, 1, 0.01),
            select("grainModel", ["silver", "gaussian", "grey"]), number("grainSize", 1, 5), number("grainStrength", 0, 1, 0.01),
            number("inputWidth", 1), number("inputHeight", 1), number("outputWidth", 1, 32000), number("outputHeight", 1, 32000),
            select("outputFormat", ["jpeg", "jpg", "png", "tiff", "tif"]), boolean("cropToFill"));
    } else if (id.startsWith("prodia/")) {
        cap.category = "Generate";
        fields.push(number("width", 256, 1920), number("height", 256, 1920), number("steps", 1, 4),
            select("stylePreset", ["3d-model", "analog-film", "anime", "cinematic", "comic-book", "digital-art", "enhance", "fantasy-art", "isometric", "line-art", "low-poly", "neon-punk", "origami", "photographic", "pixel-art", "texture", "craft-clay"]),
            json("loras", array(str(), 3)), boolean("progressive"));
    } else if (id.startsWith("recraft/")) {
        cap.prompt_max = /recraft-v[23]$/.test(id) ? 1000 : 10000;
        cap.aspect_ratio = { options: ratios(["1:1", "2:1", "1:2", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "6:10", "14:10", "10:14", "16:9", "9:16"]) };
        // The native Recraft API has additional fields, but Gateway has no published
        // namespace/mapping contract for them. Do not silently invent passthrough.
    } else if (id.startsWith("microsoft/")) {
        cap.media_slots = [reference("reference_images", 5)];
        cap.size = { options: ratios(["1024x1024", "1536x1536"]), default: ["1024x1024", "1024x1024"] };
    } else if (id.startsWith("meta/")) {
        cap.media_slots = [reference()];
    }
    // No generic n/seed/size is advertised where the provider's contract is unknown.
    if (/^(openai|bfl|bytedance|prodia)\//.test(id)) fields.push(number("n", 1, 4));
    return cap;
}

function video(model: CatalogModel): ModelCapabilities {
    const cap = base(model), meta = model.video ?? {}, ops = meta.supported_operations ?? [];
    const id = model.id, fields = cap.custom_fields;
    if (meta.supported_durations_seconds?.length) cap.duration = { options: meta.supported_durations_seconds.map(String), default: String(meta.supported_durations_seconds[0]) };
    if (meta.supported_aspect_ratios?.length) cap.aspect_ratio = { options: ratios(meta.supported_aspect_ratios), default: [meta.supported_aspect_ratios[0], meta.supported_aspect_ratios[0]] };
    if (meta.supported_resolutions?.length) cap.resolution_variant = { options: meta.supported_resolutions, default: meta.supported_resolutions[0] };
    if (meta.generate_audio) fields.push(boolean("generate_audio"));
    if (meta.supported_fps?.length) fields.push(select("fps", meta.supported_fps.map(String), String(meta.supported_fps[0])));
    if ((meta.max_sample_count ?? 1) > 1) fields.push(number("n", 1, meta.max_sample_count));
    const imageLimit = meta.input_limits?.image;
    const referenceOps = ops.some(op => /reference/.test(op));
    if (ops.some(op => /image-to-video|first-last|motion/.test(op))) cap.media_slots.push(reference("start_image", 1, !ops.includes("text-to-video") && !referenceOps));
    if (ops.some(op => /first-last/.test(op))) cap.media_slots.push(reference("end_image", 1));
    if (referenceOps && imageLimit) cap.media_slots.push(reference("reference_images", imageLimit.max_count));
    const videoLimit = meta.input_limits?.video;
    if (videoLimit && ops.some(op => /reference|edit|extend|motion|upscale/.test(op))) cap.media_slots.push({ id: "reference_videos", label: "Video input", kind: "video", multiple: (videoLimit.max_count ?? 1) > 1, max_count: videoLimit.max_count, required: ops.every(op => /upscale|motion/.test(op)), accept: "video/*" });
    const audioLimit = meta.input_limits?.audio;
    if (audioLimit && !id.startsWith("spacexai/")) cap.media_slots.push({ id: "reference_audio", label: "Audio references", kind: "audio", multiple: true, max_count: audioLimit.max_count ?? 3, accept: "audio/*" });
    for (const slot of cap.media_slots) {
        const limit = meta.input_limits?.[slot.kind];
        if (limit?.max_file_size_mb) slot.max_bytes = limit.max_file_size_mb * 1024 * 1024;
    }
    if (id.startsWith("google/")) {
        cap.negative_prompt = true;
        fields.push(boolean("enhancePrompt"), select("personGeneration", ["dont_allow", "allow_adult", "allow_all"]), select("compressionQuality", ["optimized", "lossless"]));
    } else if (id.startsWith("klingai/")) {
        cap.prompt_max = 2500;
        fields.push(select("mode", ["std", "pro"]));
        if (id.includes("motion-control")) {
            cap.prompt_required = false;
            fields.push(select("characterOrientation", ["image", "video"]), select("keepOriginalSound", ["yes", "no"]));
            if (!cap.media_slots.some(slot => slot.kind === "video")) cap.media_slots.push({ id: "reference_videos", label: "Motion video", kind: "video", required: true, max_count: 1 });
        } else {
            cap.negative_prompt = true;
            fields.push(json("watermarkInfo", object({ enabled: { type: "boolean" } }, ["enabled"])));
            if (id.includes("v3.0")) fields.push(number("cfgScale", 0, 1, 0.01), boolean("multiShot"), select("shotType", ["customize"]),
                json("voiceList", array(object({ voiceId: str(200) }, ["voiceId"]), 2)),
                json("multiPrompt", array(object({ index: { type: "integer", minimum: 1 }, prompt: str(2500), duration: { type: "string", pattern: "^(?:[3-9]|1[0-5])$" } }, ["index", "prompt", "duration"]), 15)));
            fields.push(json("cameraControl", object({ type: e("simple", "down_back", "forward_up", "right_turn_forward", "left_turn_forward"), config: object(Object.fromEntries(["horizontal", "vertical", "pan", "tilt", "roll", "zoom"].map(key => [key, num(-10, 10)]))) }, ["type"])));
        }
    } else if (id.startsWith("alibaba/")) {
        cap.negative_prompt = true;
        fields.push(boolean("promptExtend"), boolean("watermark"));
        if (id.includes("v2.6")) fields.push(select("shotType", ["single", "multi"]));
    } else if (id.startsWith("bytedance/")) {
        fields.push(boolean("watermark"), boolean("cameraFixed"), boolean("returnLastFrame"), select("serviceTier", ["default", "flex"]));
        if (id.includes("v1.5")) fields.push(boolean("draft"));
    } else if (id.startsWith("spacexai/")) {
        const modes = ops.filter(op => /video-editing|edit-video|extend-video|reference-to-video/.test(op)).map(op => op === "video-editing" ? "edit-video" : op);
        if (modes.length) fields.push(select("operationMode", ["generate", ...modes]));
        if (id.includes("1.5") && !id.includes("lite")) fields.push(json("keyframes", array(object({ imageUrl: str(2048), timestampSeconds: num(0) }, ["imageUrl", "timestampSeconds"]), 4)));
        if (referenceOps) fields.push(json("referenceVoiceIds", array(str(200), 3)));
    } else if (id.startsWith("minimax/")) {
        fields.push(boolean("aigcWatermark"));
    } else if (id.startsWith("heygen/")) {
        fields.push(select("promptEnhancement", ["turbo", "quality", "ultraquality", "disabled"]));
        cap.prompt_max = 32000;
        // Audio is always generated by HeyGen; no toggle can disable it.
        cap.custom_fields = fields.filter(field => field.id !== "generate_audio");
    } else if (id.startsWith("bfl/")) {
        fields.push(number("safetyTolerance", 0, 4), boolean("draft"), text("draftCache", 500000), select("version", ["latest"]));
        // URL-bearing structured keyframes use uploaded image slots instead.
        cap.media_slots.push({ ...reference("keyframes", 10), description: "Ordered keyframes; mutually exclusive with video continuation" });
    } else if (id.startsWith("topaz/")) {
        cap.prompt_required = false; cap.prompt_supported = false; cap.duration = false; cap.aspect_ratio = false;
        cap.category = "Enhance";
        cap.media_slots = [{ id: "reference_videos", label: "Video to enhance", kind: "video", required: true, max_count: 1 }];
        cap.custom_fields = [json("source", object({ width: num(1), height: num(1), duration: num(0), frameRate: num(0), frameCount: num(1), container: str(20) })),
            json("output", object({ width: num(1), height: num(1), frameRate: num(1), audioTransfer: e("Copy", "Convert", "None"), audioCodec: e("AAC", "AC3", "PCM"), audioBitrate: num(1), videoEncoder: e("AV1", "H264", "H265", "ProRes", "VP9"), videoProfile: str(100), videoBitrate: num(1), dynamicCompressionLevel: e("Low", "Mid", "High"), container: e("mp4", "mov", "mkv", "avi", "webm"), cropToFit: { type: "boolean" } }))];
        // Vendor filter range pages currently return 403; do not expose an
        // unrestricted escape hatch pretending to validate their contracts.
    }
    return cap;
}

export const GATEWAY_IMAGE_CAPABILITIES: Record<string, ImageCapability> = Object.fromEntries(CATALOG.filter(model => model.type !== "video").map(model => { const cap = image(model); return [cap.id, cap]; }));
export const GATEWAY_VIDEO_CAPABILITIES: Record<string, ModelCapabilities> = Object.fromEntries(CATALOG.filter(model => model.type === "video").map(model => { const cap = video(model); return [cap.id, cap]; }));
export const GATEWAY_CATALOG = CATALOG;
export function getGatewayCapability(model: string): ModelCapabilities | undefined {
    return [...Object.values(GATEWAY_IMAGE_CAPABILITIES), ...Object.values(GATEWAY_VIDEO_CAPABILITIES)].find(cap => cap.provider_model_id === model);
}
