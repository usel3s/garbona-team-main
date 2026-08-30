import { Check, ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

interface SelectMenuProps<T extends string = string> {
  value: T;
  options: SelectOption<T>[];
  onChange(value: T): void;
  ariaLabel: string;
  className?: string;
  leadingIcon?: ReactNode;
  align?: "left" | "right";
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  openUp: boolean;
}

export function SelectMenu<T extends string = string>({
  value,
  options,
  onChange,
  ariaLabel,
  className = "",
  leadingIcon,
  align = "left",
}: SelectMenuProps<T>) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const selected =
    options.find((option) => option.value === value) || options[0];
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight || options.length * 36 + 10;
    const gap = 6;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    const openUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;
    const width = Math.max(rect.width, 148);
    let left = align === "right" ? rect.right - width : rect.left;
    left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
    setPosition({
      top: openUp
        ? Math.max(8, rect.top - gap - menuHeight)
        : rect.bottom + gap,
      left,
      width,
      openUp,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    setActiveIndex(selectedIndex);
    updatePosition();
    const frame = window.requestAnimationFrame(() => updatePosition());
    return () => window.cancelAnimationFrame(frame);
  }, [open, selectedIndex, options.length, align]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    const onReposition = () => updatePosition();

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  const choose = (next: T) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % options.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + options.length) % options.length);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option.value);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div
      className={`gbd-select ${open ? "is-open" : ""} ${className}`.trim()}
      ref={rootRef}
    >
      <button
        type="button"
        className="gbd-select__trigger"
        ref={triggerRef}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
      >
        {leadingIcon ? (
          <span className="gbd-select__icon" aria-hidden="true">
            {leadingIcon}
          </span>
        ) : null}
        <span className="gbd-select__label">{selected?.label || "—"}</span>
        <ChevronDown className="gbd-select__chevron" size={14} aria-hidden="true" />
      </button>

      {open &&
        createPortal(
          <div
            className={`gbd-select__menu ${position?.openUp ? "is-up" : ""}`}
            id={listId}
            role="listbox"
            tabIndex={-1}
            ref={menuRef}
            aria-label={ariaLabel}
            style={
              position
                ? {
                    top: position.top,
                    left: position.left,
                    width: position.width,
                  }
                : undefined
            }
            onKeyDown={onMenuKeyDown}
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              return (
                <button
                  type="button"
                  role="option"
                  key={option.value}
                  className={`gbd-select__option${isSelected ? " is-selected" : ""}${
                    isActive ? " is-active" : ""
                  }`}
                  aria-selected={isSelected}
                  tabIndex={isActive ? 0 : -1}
                  ref={(node) => {
                    if (isActive && node) node.focus({ preventScroll: true });
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(option.value)}
                >
                  <span>{option.label}</span>
                  {isSelected ? <Check size={14} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
