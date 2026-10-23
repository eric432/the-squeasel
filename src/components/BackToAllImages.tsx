/** Same control and label on every screen that isn't the grid. */
export function BackToAllImages({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="toolbar-button back-to-all" aria-label="Back to all images" onClick={onClick}>
      <span aria-hidden="true">←</span>
      All images
    </button>
  );
}
