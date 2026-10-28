import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import packageJson from "../../package.json";
import licensesText from "../../THIRD-PARTY-LICENSES.md?raw";
import { Mascot } from "./Mascot";

const SOURCE = "github.com/eric432/the-squeasel";
const KOFI = "ko-fi.com/ericbaldoni";

export function AboutPanel({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState(packageJson.version);
  const [copiedSource, setCopiedSource] = useState(false);
  const [copiedKofi, setCopiedKofi] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (!isTauri()) return;
      try {
        const next = await getVersion();
        if (alive) setVersion(next);
      } catch {
        /* Keep the package version when the app API is unavailable. */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal about-dialog"
        id="about-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          className="about-close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
        <div className="about-panel-body">
          <div className="about-hero">
            <Mascot phase="skinny" line="" size={96} staticPose />
            <div className="about-title-block">
              <h2 id="about-title">The Squeasel</h2>
              <p className="hint">{`Version ${version}`}</p>
            </div>
          </div>
          <p className="about-line">Free software under the GNU General Public License v3.0.</p>
          <div className="about-source">
            <p className="about-source-text">
              Source code: <span className="about-source-url">{SOURCE}</span>
            </p>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(SOURCE)
                  .then(() => setCopiedSource(true))
                  .catch(() => undefined);
              }}
            >
              {copiedSource ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="about-source">
            <p className="about-source-text">
              Free and open source. If it saves you time, support it on Ko-fi.{" "}
              <span className="about-source-url">{KOFI}</span>
            </p>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(KOFI)
                  .then(() => setCopiedKofi(true))
                  .catch(() => undefined);
              }}
            >
              {copiedKofi ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="about-line">A Down To Earth app by Bitclone. No cloud, no account.</p>
          <p className="about-line">Made by Bitclone, Tucson, Arizona. www.bitclone.com</p>
          <details className="about-licenses">
            <summary>Third-party licenses</summary>
            <pre className="about-licenses-text">{licensesText}</pre>
          </details>
        </div>
        <div className="about-dialog-done">
          <button type="button" className="toolbar-button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
