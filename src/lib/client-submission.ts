export type SubmissionOutcome = {
    taskId?: string;
    accepted: boolean;
    needsReview: boolean;
    error?: string;
};

export function unknownSubmission(taskId?: string): SubmissionOutcome {
    return { taskId, accepted: false, needsReview: true, error: "ERR_SUBMISSION_OUTCOME_UNKNOWN" };
}

export async function parseSubmissionResponse(response: Response): Promise<SubmissionOutcome> {
    let body: Record<string, unknown>;
    try {
        const parsed = await response.json();
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return unknownSubmission();
        body = parsed;
    } catch { return unknownSubmission(); }
    const taskId = typeof body.task_id === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(body.task_id) ? body.task_id : undefined;
    const error = typeof body.error === "string" && /^ERR_[A-Z0-9_]{1,100}$/.test(body.error) ? body.error : "ERR_GENERIC";
    if (body.recovery_required === true) {
        return { ...unknownSubmission(taskId), error: error === "ERR_ASSET_STORAGE_INCOMPLETE" ? error : "ERR_SUBMISSION_OUTCOME_UNKNOWN" };
    }
    if (taskId && [200, 202].includes(response.status) && body.accepted === true && body.recovery_required === false) {
        return { taskId, accepted: true, needsReview: false };
    }
    if ([400, 401, 403, 408, 413, 415, 422, 429, 503].includes(response.status) &&
        body.accepted === false && body.recovery_required === false && (response.status !== 422 || taskId)) {
        return { taskId, accepted: false, needsReview: false, error };
    }
    return unknownSubmission(taskId);
}
