import type { SingleComboboxProps } from "@/components/ui/combobox";
import { useLingui } from "@lingui/react";
import { Combobox } from "@/components/ui/combobox";
import { isLocale, loadLocale, setLocaleCookie } from "@/libs/locale";
import { getLocaleOptions } from "./locale-options";

type Props = Omit<SingleComboboxProps, "options" | "value" | "onValueChange">;

const onLocaleChange = async (value: string | null) => {
	if (!value || !isLocale(value)) return;
	setLocaleCookie(value);
	await loadLocale(value);
	window.location.reload();
};

export function LocaleCombobox(props: Props) {
	const { i18n } = useLingui();

	return (
		<Combobox
			showClear={false}
			defaultValue={i18n.locale}
			options={getLocaleOptions()}
			onValueChange={onLocaleChange}
			{...props}
		/>
	);
}
