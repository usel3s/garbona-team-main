import clsx from "clsx";
import "./switch.css";

/**
 * 21st.dev / shadcn Switch — iOS-style track + thumb, no Tailwind.
 * https://21st.dev/@shadcn/components/switch
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  label,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  id?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={clsx("gsw", checked && "is-on", disabled && "is-disabled")}
      onClick={() => {
        if (disabled) return;
        onCheckedChange(!checked);
      }}
    >
      <span className="gsw__thumb" />
    </button>
  );
}
