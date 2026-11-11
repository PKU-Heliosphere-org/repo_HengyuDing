import type { Layer } from "./types";
import { DEFAULT_GLOW_SIZE, DEFAULT_LINE_WIDTH } from "./types";

export function LayerAppearance({
  layer,
  patch,
}: {
  layer: Layer;
  patch: (value: Partial<Layer>) => void;
}) {
  return (
    <div className="appearance-controls">
      <label>
        <span>光点大小</span>
        <input
          aria-label={layer.kind === "planet" ? "行星光点大小" : "对象光点大小"}
          type="range"
          min="2"
          max="48"
          step="1"
          value={layer.glowSize ?? DEFAULT_GLOW_SIZE}
          onChange={(e) => patch({ glowSize: Number(e.target.value) })}
        />
        <output>{layer.glowSize ?? DEFAULT_GLOW_SIZE} px</output>
      </label>
      <label>
        <span>轨道线宽</span>
        <input
          aria-label="轨道线宽"
          type="range"
          min="0.5"
          max="8"
          step="0.5"
          value={layer.lineWidth ?? DEFAULT_LINE_WIDTH}
          onChange={(e) => patch({ lineWidth: Number(e.target.value) })}
        />
        <output>{layer.lineWidth ?? DEFAULT_LINE_WIDTH} px</output>
      </label>
    </div>
  );
}
