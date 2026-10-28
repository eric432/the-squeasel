import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import packageJson from "../../package.json";
import licensesText from "../../THIRD-PARTY-LICENSES.md?raw";
import { Mascot } from "./Mascot";

const SOURCE = "github.com/eric432/the-squeasel";
const KOFI = "ko-fi.com/ericbaldoni";

export function AboutPanel({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState(packageJson.version);
  const [copied, setCopied] = useState(false);

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
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <section className="batch-panel about-panel" id="about-panel" aria-label="About">
      <div className="about-panel-body">
        <div className="about-hero">
          <Mascot phase="skinny" line="" size={96} staticPose />
          <div className="about-title-block">
            <h2>The Squeasel</h2>
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
                .then(() => setCopied(true))
                .catch(() => undefined);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="about-line">
          Free and open source. If it saves you time, support it on Ko-fi.{" "}
          <span className="about-source-url">{KOFI}</span>
        </p>
        <p className="about-line">Made by Bitclone, Tucson, Arizona. www.bitclone.com</p>
        <details className="about-licenses">
          <summary>Third-party licenses</summary>
          <pre className="about-licenses-text">{licensesText}</pre>
        </details>
      </div>
      <div className="batch-panel-done">
        <button type="button" className="toolbar-button" onClick={onClose}>
          Done
        </button>
      </div>
    </section>
  );
}
