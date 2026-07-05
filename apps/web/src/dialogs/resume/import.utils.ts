export type ImportType = "" | "pdf" | "docx" | "reactive-resume-json" | "reactive-resume-v4-json" | "json-resume-json";

export function detectJsonImportType(parsed: unknown): ImportType {
	if (!parsed || typeof parsed !== "object") return "";
	const data = parsed as Record<string, unknown>;

	// JSON Resume standard: top-level `basics`, without Reactive Resume's `sections`/`metadata`.
	if ("basics" in data && !("sections" in data) && !("metadata" in data)) return "json-resume-json";

	// Reactive Resume exports carry `sections` + `metadata`; the current schema's metadata has a `page` key,
	// the legacy v4 schema does not. Best-effort guess — the user can override the type below.
	if ("sections" in data || "metadata" in data) {
		const metadata = data.metadata as Record<string, unknown> | undefined;
		if (metadata && !("page" in metadata)) return "reactive-resume-v4-json";
		return "reactive-resume-json";
	}

	return "";
}
