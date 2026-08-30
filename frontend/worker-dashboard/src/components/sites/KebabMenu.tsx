import { MoreVertical } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface KebabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  hidden?: boolean;
  separatorBefore?: boolean;
  onSelect(): void;
}

let closeActive: (() => void) | null = null;

export function closeExclusiveMenus() {
  closeActive?.();
  closeActive = null;
}

interface MenuPosition {
  top: number;
  left: number;
  openUp: boolean;
}

export function KebabMenu({
  items,
  label,
  align = "right",
  className = "",
}: {
  items: KebabItem[];
  label: string;
  align?: "left" | "right";
  className?: string;
}) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const visible = items.filter((item) => !item.hidden);

  const close = () => setOpen(false);

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = 220;
    const height = menuRef.current?.offsetHeight || visible.length * 36 + 12;
    const gap = 6;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const openUp = spaceBelow < height && rect.top > spaceBelow;
    let left = align === "right" ? rect.right - width : rect.left;
    left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
    const top = openUp ? Math.max(8, rect.top - gap - height) : rect.bottom + gap;
    setPosition((current) => {
      if (current && current.top === top && current.left === left && current.openUp === openUp) {
        return current;
      }
      return { top, left, openUp };
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      if (closeActive === close) closeActive = null;
      setPosition(null);
      return;
    }
    closeActive = close;
    updatePosition();
    const frame = window.requestAnimationFrame(() => updatePosition());
    return () => window.cancelAnimationFrame(frame);
  }, [open, visible.length, align]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  if (!visible.length) return null;

  return (
    <div className={`gbs-kebab ${className}`.trim()}>
      <button
        type="button"
        className="gbd-icon-btn gbs-kebab__trigger"
        ref={triggerRef}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={(event) => {
          event.stopPropagation();
          if (open) {
            close();
            return;
          }
          closeExclusiveMenus();
          setOpen(true);
        }}
      >
        <MoreVertical size={15} />
      </button>
      {open
        ? createPortal(
            <div
              className={`gbs-kebab__menu${position?.openUp ? " is-up" : ""}`}
              id={menuId}
              role="menu"
              ref={menuRef}
              style={
                position
                  ? { top: position.top, left: position.left }
                  : undefined
              }
              onClick={(event) => event.stopPropagation()}
            >
              {visible.map((item) => (
                <div key={item.id}>
                  {item.separatorBefore ? <hr className="gbs-kebab__sep" /> : null}
                  <button
                    type="button"
                    role="menuitem"
                    className={`gbs-kebab__item${item.danger ? " is-danger" : ""}`}
                    onClick={() => {
                      close();
                      item.onSelect();
                    }}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
