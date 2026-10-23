import type { CSSProperties } from "react";
import type { MascotPhase } from "../lib/useMascot";
import "../mascot.css";

const PIXELS: { x: number; y: number; size: number; dx: string; dy: string }[] = [
  { x: 80, y: 150, size: 7, dx: "-46px", dy: "-30px" },
  { x: 84, y: 170, size: 5, dx: "-34px", dy: "-58px" },
  { x: 133, y: 152, size: 7, dx: "46px", dy: "-34px" },
  { x: 131, y: 172, size: 5, dx: "36px", dy: "-60px" },
  { x: 78, y: 190, size: 6, dx: "-54px", dy: "6px" },
  { x: 136, y: 192, size: 6, dx: "54px", dy: "4px" },
];

interface MascotProps {
  phase: MascotPhase;
  weightMb: number;
  line: string;
  /** No breathing or squeeze motion — for About and other still uses. */
  staticPose?: boolean;
}

export function Mascot({ phase, weightMb, line, staticPose = false }: MascotProps) {
  const fullness = weightMb > 0 ? Math.min(1, Math.max(0, Math.log10(weightMb) / Math.log10(150))) : 0;
  const sx = 0.62 + 0.46 * fullness;
  const sy = 1.04 - 0.04 * fullness;
  const style = { "--sx": String(sx), "--sy": String(sy) } as CSSProperties;
  const mouth =
    phase === "squeezing" ? "M102 106 Q110 100 118 106" : phase === "skinny" ? "M98 101 Q110 112 122 101" : "M101 103 Q110 108 119 103";

  return (
    <div className={staticPose ? "mascot is-static" : "mascot"}>
      <svg className="mascot-svg" viewBox="0 0 220 240" width="150" height="164" role="img" aria-label="The Squeasel mascot" style={style}>
        <g className={staticPose ? undefined : "w-breathe"}>
          <g className={`w-tail ${phase}`}>
            <path d="M140 206 C188 214 214 168 198 120" fill="none" stroke="#8b6744" strokeWidth="20" strokeLinecap="round" />
            <path d="M196 132 C202 126 204 120 198 113" fill="none" stroke="#3a2a1c" strokeWidth="17" strokeLinecap="round" />
          </g>
          <g className={`w-body ${phase}`}>
            <ellipse cx="110" cy="165" rx="64" ry="62" fill="#8b6744" />
            <ellipse cx="110" cy="176" rx="42" ry="44" fill="#f1e3c8" />
          </g>
          <g className={`w-foot l ${phase}`}>
            <ellipse cx="84" cy="221" rx="18" ry="10" fill="#6e5034" />
            <circle cx="73.5" cy="227" r="6" fill="#6e5034" />
            <circle cx="84" cy="229" r="6" fill="#6e5034" />
            <circle cx="94.5" cy="227" r="6" fill="#6e5034" />
            <path d="M78.8 225 L78.8 231.5 M89.2 225 L89.2 231.5" stroke="#4a3422" strokeWidth="1.6" strokeLinecap="round" />
            <ellipse cx="73.5" cy="232.6" rx="2.2" ry="1.3" fill="#efe2c8" />
            <ellipse cx="84" cy="234.6" rx="2.2" ry="1.3" fill="#efe2c8" />
            <ellipse cx="94.5" cy="232.6" rx="2.2" ry="1.3" fill="#efe2c8" />
          </g>
          <g className={`w-foot r ${phase}`}>
            <ellipse cx="136" cy="221" rx="18" ry="10" fill="#6e5034" />
            <circle cx="125.5" cy="227" r="6" fill="#6e5034" />
            <circle cx="136" cy="229" r="6" fill="#6e5034" />
            <circle cx="146.5" cy="227" r="6" fill="#6e5034" />
            <path d="M130.8 225 L130.8 231.5 M141.2 225 L141.2 231.5" stroke="#4a3422" strokeWidth="1.6" strokeLinecap="round" />
            <ellipse cx="125.5" cy="232.6" rx="2.2" ry="1.3" fill="#efe2c8" />
            <ellipse cx="136" cy="234.6" rx="2.2" ry="1.3" fill="#efe2c8" />
            <ellipse cx="146.5" cy="232.6" rx="2.2" ry="1.3" fill="#efe2c8" />
          </g>
          <g className={`w-arm l ${phase}`}>
            <path d="M76 136 Q80 158 95 166" fill="none" stroke="#7a5a3a" strokeWidth="15" strokeLinecap="round" />
            <ellipse cx="98" cy="167" rx="8.5" ry="7" fill="#7a5a3a" />
            <path d="M95.5 170 L95.5 173.5 M100.5 170 L100.5 173.5" stroke="#4a3422" strokeWidth="1.4" strokeLinecap="round" />
          </g>
          <g className={`w-arm r ${phase}`}>
            <path d="M144 136 Q140 158 125 166" fill="none" stroke="#7a5a3a" strokeWidth="15" strokeLinecap="round" />
            <ellipse cx="122" cy="167" rx="8.5" ry="7" fill="#7a5a3a" />
            <path d="M119.5 170 L119.5 173.5 M124.5 170 L124.5 173.5" stroke="#4a3422" strokeWidth="1.4" strokeLinecap="round" />
          </g>
          <g className={`w-head ${phase}`}>
            <circle cx="72" cy="52" r="15" fill="#8b6744" />
            <circle cx="72" cy="52" r="8" fill="#e8c9a8" />
            <circle cx="148" cy="52" r="15" fill="#8b6744" />
            <circle cx="148" cy="52" r="8" fill="#e8c9a8" />
            <ellipse cx="110" cy="80" rx="47" ry="40" fill="#8b6744" />
            <ellipse cx="110" cy="74" rx="41" ry="13" fill="#5a3f28" />
            <ellipse cx="110" cy="98" rx="29" ry="21" fill="#f1e3c8" />
            <ellipse cx="80" cy="98" rx="8" ry="5" fill="#e89a8a" opacity="0.55" />
            <ellipse cx="140" cy="98" rx="8" ry="5" fill="#e89a8a" opacity="0.55" />
            {phase === "squeezing" ? (
              <g fill="none" stroke="#111" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M86 69 L97 74 L86 79" />
                <path d="M134 69 L123 74 L134 79" />
              </g>
            ) : (
              <>
                <ellipse cx="92" cy="74" rx="6.5" ry="7.5" fill="#111" />
                <ellipse cx="128" cy="74" rx="6.5" ry="7.5" fill="#111" />
                <circle cx="94.5" cy="71" r="2.2" fill="#fff" />
                <circle cx="130.5" cy="71" r="2.2" fill="#fff" />
                <rect className="w-lid" x="84.5" y="66" width="15" height="16" rx="7" fill="#5a3f28" />
                <rect className="w-lid" x="120.5" y="66" width="15" height="16" rx="7" fill="#5a3f28" />
                <path d="M83 63 L100 67" stroke="#2a1d14" strokeWidth="3" strokeLinecap="round" />
                <path d="M137 63 L120 67" stroke="#2a1d14" strokeWidth="3" strokeLinecap="round" />
              </>
            )}
            <ellipse cx="110" cy="89" rx="7.5" ry="5" fill="#2a1d14" />
            <path d={mouth} fill="none" stroke="#2a1d14" strokeWidth="2.4" strokeLinecap="round" />
            <g opacity="0.45" stroke="#2a1d14" strokeWidth="1.4" strokeLinecap="round">
              <path d="M88 93 L60 88" />
              <path d="M88 98 L61 100" />
              <path d="M132 93 L160 88" />
              <path d="M132 98 L159 100" />
            </g>
            <g className={`w-collar ${phase}`}>
              <rect x="80" y="114" width="60" height="10" rx="5" fill="#1f6fa6" />
            </g>
            <circle cx="110" cy="127" r="8.5" fill="#5fb0e3" stroke="#1f6fa6" strokeWidth="2" />
            <text x="110" y="131" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="10" fontWeight="700" fill="#fff">
              S
            </text>
          </g>
        </g>
        <rect className={`w-pad l ${phase}`} x="30" y="138" width="14" height="74" rx="7" fill="#5fb0e3" stroke="#1f6fa6" strokeWidth="2" />
        <rect className={`w-pad r ${phase}`} x="176" y="138" width="14" height="74" rx="7" fill="#5fb0e3" stroke="#1f6fa6" strokeWidth="2" />
        {PIXELS.map((pixel) => (
          <rect
            key={`${pixel.x}-${pixel.y}`}
            className={`w-px ${phase}`}
            x={pixel.x}
            y={pixel.y}
            width={pixel.size}
            height={pixel.size}
            fill="#5fb0e3"
            style={{ "--dx": pixel.dx, "--dy": pixel.dy } as CSSProperties}
          />
        ))}
      </svg>
      <p className={line ? "w-bubble" : "w-bubble is-empty"} aria-live="polite">
        {line}
      </p>
    </div>
  );
}
