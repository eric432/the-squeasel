import type { CSSProperties } from "react";
import type { MascotPhase } from "../lib/useMascot";
import "../mascot.css";

import fatArmLeft from "../assets/mascot/fat-arm-left.webp";
import fatArmRight from "../assets/mascot/fat-arm-right.webp";
import fatEyes from "../assets/mascot/fat-eyes.webp";
import fatFace from "../assets/mascot/fat-face.webp";
import fatHead from "../assets/mascot/fat-head.webp";
import fatTail from "../assets/mascot/fat-tail.webp";
import fatTorso from "../assets/mascot/fat-torso.webp";
import feet from "../assets/mascot/feet.webp";
import skinnyArmLeft from "../assets/mascot/skinny-arm-left.webp";
import skinnyArmRight from "../assets/mascot/skinny-arm-right.webp";
import skinnyEyesClosed from "../assets/mascot/skinny-eyes-closed.webp";
import skinnyEyesOpen from "../assets/mascot/skinny-eyes-open.webp";
import skinnyFace from "../assets/mascot/skinny-face.webp";
import skinnyHead from "../assets/mascot/skinny-head.webp";
import skinnyTail from "../assets/mascot/skinny-tail.webp";
import skinnyTorso from "../assets/mascot/skinny-torso.webp";

/** Back to front. pose: f = fat, d = skinny, x = always. */
const LAYERS: {
  pose: "f" | "d" | "x";
  part: string;
  animClass: string;
  src: string;
  extra?: string;
}[] = [
  { pose: "f", part: "tail", animClass: "fTail", src: fatTail },
  { pose: "d", part: "tail", animClass: "dTail", src: skinnyTail },
  { pose: "f", part: "torso", animClass: "fTorso", src: fatTorso },
  { pose: "d", part: "torso", animClass: "dTorso", src: skinnyTorso },
  { pose: "x", part: "feet", animClass: "", src: feet },
  { pose: "f", part: "armL", animClass: "fArmL", src: fatArmLeft },
  { pose: "d", part: "armL", animClass: "dArmL", src: skinnyArmLeft },
  { pose: "f", part: "armR", animClass: "fArmR", src: fatArmRight },
  { pose: "d", part: "armR", animClass: "dArmR", src: skinnyArmRight },
  { pose: "f", part: "head", animClass: "fHead", src: fatHead },
  { pose: "d", part: "head", animClass: "dHead", src: skinnyHead },
  { pose: "f", part: "feat", animClass: "fEye", src: fatEyes },
  { pose: "d", part: "feat", animClass: "dEye", src: skinnyEyesOpen, extra: "sq-eyes-open" },
  { pose: "d", part: "feat", animClass: "dClosed", src: skinnyEyesClosed, extra: "sq-eyes-closed" },
  { pose: "f", part: "feat", animClass: "fFeat", src: fatFace },
  { pose: "d", part: "feat", animClass: "dFeat", src: skinnyFace },
];

const BITS: [number, number, number, number][] = [
  [26, 55, -10, -8],
  [24, 67, -12, -1],
  [28, 61, -7, -13],
  [70, 56, 10, -8],
  [72, 66, 12, -2],
  [68, 61, 7, -13],
];

const SWEAT: [number, number, number, string][] = [
  [19, 22, -7, "0s"],
  [61, 19, 7, "0.7s"],
  [26, 8, -5, "1.4s"],
  [55, 7, 5, "2.1s"],
];

interface MascotProps {
  phase: MascotPhase;
  line: string;
  size?: number;
  /** Freeze motion — for About and other still uses. */
  staticPose?: boolean;
  large?: boolean;
}

export function Mascot({ phase, line, size, staticPose = false, large = false }: MascotProps) {
  // Only set --sq-size inline when callers pass size; sidebar uses CSS clamp for short windows.
  const style = size != null ? ({ "--sq-size": `${size}px` } as CSSProperties) : undefined;
  const rootClass = ["sq-mascot", large ? "sq-large" : "", staticPose ? "is-static" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={rootClass}
      data-phase={phase}
      style={style}
      role="img"
      aria-label="The Squeasel, a chubby weasel mascot"
    >
      <div className="sq-breathe">
        {LAYERS.map((layer) => (
          <div
            key={`${layer.pose}-${layer.part}-${layer.animClass || layer.src}`}
            className={["sq-pc", `sq-${layer.part}`, layer.animClass, `sq-${layer.pose}`, layer.extra ?? ""]
              .filter(Boolean)
              .join(" ")}
          >
            <img src={layer.src} alt="" draggable={false} />
          </div>
        ))}
      </div>
      <div className="sq-pad sq-padL" />
      <div className="sq-pad sq-padR" />
      {BITS.map(([left, top, dx, dy]) => (
        <div
          key={`bit-${left}-${top}`}
          className="sq-drop sq-bit"
          style={{ left: `${left}%`, top: `${top}%`, "--dx": dx, "--dy": dy } as CSSProperties}
        />
      ))}
      {SWEAT.map(([left, top, dx, dl]) => (
        <div
          key={`sweat-${left}-${top}`}
          className="sq-drop sq-sweat"
          style={{ left: `${left}%`, top: `${top}%`, "--dx": dx, "--dl": dl } as CSSProperties}
        />
      ))}
      <div className="sq-bubble" hidden={!line} aria-live="polite">
        {line}
      </div>
    </div>
  );
}
