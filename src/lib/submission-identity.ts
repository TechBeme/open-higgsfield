/** Correlation only: never used as a provider task ID or an authorization decision. */
export function submissionIdentity(form: FormData): { clientSubmissionId?: string } {
    const id = form.get("client_submission_id");
    return typeof id === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)
        ? { clientSubmissionId: id } : {};
}
