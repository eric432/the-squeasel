import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  id: string;
  label: string;
  title?: string;
  disabled?: boolean;
  onSelect: () => void;
}

interface MenuButtonProps {
  label: string;
  /** Visible label. The ⋯ menus omit this. */
  text?: string;
  items: MenuItem[];
  disabled?: boolean;
  /** Shown above the items. Not a choice. */
  note?: string;
}

export function MenuButton({ label, text, items, disabled = false, note }: MenuButtonProps) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);

  const enabledIndexes = items.flatMap((item, index) => (item.disabled ? [] : [index]));

  function moveTo(index: number) {
    setActive(index);
    itemRefs.current[index]?.focus();
  }

  function measure() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { top: rect.bottom + 4, right: window.innerWidth - rect.right };
  }

  function openMenu(index: number) {
    const next = enabledIndexes.includes(index) ? index : (enabledIndexes[0] ?? 0);
    setActive(next);
    setPlace(measure());
    setOpen(true);
  }

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function closeMenu(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    itemRefs.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    function placeMenu() {
      const next = measure();
      if (!next) return;
      setPlace((current) => (current && current.top === next.top && current.right === next.right ? current : next));
    }
    function onPointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (document.getElementById(menuId)?.contains(target)) return;
      setOpen(false);
    }
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, menuId]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (enabledIndexes.length === 0) return;
    const current = enabledIndexes.indexOf(active);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = enabledIndexes[(current + 1 + enabledIndexes.length) % enabledIndexes.length];
      if (next !== undefined) moveTo(next);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = enabledIndexes[(current - 1 + enabledIndexes.length) % enabledIndexes.length];
      if (next !== undefined) moveTo(next);
    } else if (event.key === "Home") {
      event.preventDefault();
      if (enabledIndexes[0] !== undefined) moveTo(enabledIndexes[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      const last = enabledIndexes[enabledIndexes.length - 1];
      if (last !== undefined) moveTo(last);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={text ? "menu-button menu-text" : "menu-button"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={text ? undefined : label}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          if (open) closeMenu(false);
          else openMenu(0);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu(event.key === "ArrowUp" ? (enabledIndexes[enabledIndexes.length - 1] ?? 0) : 0);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            closeMenu(true);
          }
        }}
      >
        {text ? (
          <>
            <span className="menu-text-label">{text}</span>
            <span aria-hidden="true">▾</span>
          </>
        ) : (
          <span aria-hidden="true">⋯</span>
        )}
      </button>
      {open && place
        ? createPortal(
            <div
              id={menuId}
              className="menu-panel"
              role="menu"
              aria-label={label}
              style={{ top: place.top, right: place.right }}
              onKeyDown={onMenuKeyDown}
            >
              {note ? <p className="menu-note">{note}</p> : null}
              {items.map((item, index) => (
                <button
                  key={item.id}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  title={item.title}
                  disabled={item.disabled}
                  tabIndex={index === active ? 0 : -1}
                  onClick={() => {
                    if (item.disabled) return;
                    setOpen(false);
                    item.onSelect();
                  }}
                  onFocus={() => setActive(index)}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
