interface ToolbarProps {
  onAddImages: () => void;
  onAddFolder: () => void;
  disabled?: boolean;
}

export function Toolbar({ onAddImages, onAddFolder, disabled = false }: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar-actions">
        <button type="button" className="toolbar-button" onClick={onAddImages} disabled={disabled}>
          <PlusIcon />
          Add images
        </button>
        <button type="button" className="toolbar-button" onClick={onAddFolder} disabled={disabled}>
          <FolderIcon />
          Add folder
        </button>
      </div>
    </header>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}
