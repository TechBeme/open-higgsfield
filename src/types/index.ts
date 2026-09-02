export type MediaType = "video" | "image";

export interface SizeUiAspectRatio {
    id: string;
    w: number;
    h: number;
}

export interface SizeUiResolution {
    id: string;
    base: number;
}

export interface SizeUi {
    width_field: string;
    height_field: string;
    aspect_ratios: SizeUiAspectRatio[];
    resolutions: SizeUiResolution[];
    default_aspect: string;
    default_resolution: string;
}

// Task types
export type TaskStatus = "CREATED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "ERROR" | "CANCELLED";

export interface TaskEvent {
    type: "status" | "completed" | "failed" | "timeout" | "error";
    status?: string;
    elapsed?: number;
    video_urls?: string[];
    has_download?: boolean;
    media_type?: MediaType;
    result_urls?: string[];
    result_count?: number;
    message?: string;
}

export interface VideoTask {
    task_id: string;
    status?: string;
    provider_id?: "freepik" | "google-ai-studio" | "google-vertex" | "vercel-ai-gateway";
    provider_model_id?: string;
    provider_task_id?: string;
    provider_operation?: unknown;
    freepik_task_id?: string;
    freepik_status?: string;
    prompt?: string;
    image_url?: string;
    params?: Record<string, unknown>;
    model_id: string;
    poll_url?: string;
    created_at: string;
    video_path?: string;
    video_urls?: string[];
    media_type: "video";
    response_style?: string;
    result_paths?: string[];
    result_urls?: string[];
    reuse_state?: Record<string, unknown>;
    error_message?: string;
    events?: TaskEvent[];
    _done?: boolean;
}

export interface ImageTask {
    task_id: string;
    status?: string;
    provider_id?: "freepik" | "google-ai-studio" | "google-vertex" | "vercel-ai-gateway";
    provider_model_id?: string;
    provider_task_id?: string;
    provider_operation?: unknown;
    freepik_task_id?: string | null;
    freepik_status?: string;
    prompt?: string;
    params?: Record<string, unknown>;
    model_id: string;
    poll_url?: string | null;
    created_at: string;
    media_type: "image";
    response_style?: string;
    result_paths?: string[];
    result_urls?: string[];
    image_urls?: string[];
    reuse_state?: Record<string, unknown>;
    error_message?: string;
    events?: TaskEvent[];
    _done?: boolean;
}

export type AnyTask = VideoTask | ImageTask;
