import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import type { ResumeRenderOptions } from "./context";
import type { SectionTitleResolver } from "./section-title";
import { createElement } from "react";
import { pdf } from "#react-pdf-renderer";
import { ResumeDocument } from "./document";

type CreateResumePdfBlobOptions = {
	data: ResumeData;
	template?: Template | undefined;
	renderOptions?: ResumeRenderOptions | undefined;
	resolveSectionTitle?: SectionTitleResolver | undefined;
};

export const createResumePdfBlob = async ({
	data,
	template,
	renderOptions,
	resolveSectionTitle,
}: CreateResumePdfBlobOptions) => {
	const document = createElement(ResumeDocument, {
		data,
		template: template ?? data.metadata.template,
		...(renderOptions ? { renderOptions } : {}),
		resolveSectionTitle,
	}) as Parameters<typeof pdf>[0];

	return pdf(document).toBlob();
};
