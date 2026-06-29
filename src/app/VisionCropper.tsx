import { useRef, useState, type PointerEvent } from "react";
import type { ScreenCapture } from "../platform/screenCapture";

type Point = { x: number; y: number };

export function VisionCropper({
  capture,
  onConfirm,
  onCancel,
}: {
  capture: ScreenCapture;
  onConfirm: (selection: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  onCancel: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<Point | null>(null);
  const [end, setEnd] = useState<Point | null>(null);

  function point(event: PointerEvent<HTMLDivElement>): Point {
    const rect = stageRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  const left = Math.min(start?.x ?? 0, end?.x ?? 1);
  const top = Math.min(start?.y ?? 0, end?.y ?? 1);
  const width = Math.abs((end?.x ?? 1) - (start?.x ?? 0));
  const height = Math.abs((end?.y ?? 1) - (start?.y ?? 0));
  const valid = Boolean(start && end && width > 0.04 && height > 0.04);

  return (
    <div className="vision-cropper">
      <strong>Выбери область для анализа</strong>
      <div className="vision-crop-stage">
        <div
          className="vision-crop-image"
          ref={stageRef}
          style={{ aspectRatio: `${capture.width} / ${capture.height}` }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            const next = point(event);
            setStart(next);
            setEnd(next);
          }}
          onPointerMove={(event) => {
            if (
              start &&
              event.currentTarget.hasPointerCapture(event.pointerId)
            ) {
              setEnd(point(event));
            }
          }}
          onPointerUp={(event) => {
            setEnd(point(event));
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
        >
          <img
            src={`data:image/png;base64,${capture.imageBase64}`}
            alt="Снимок для выбора области"
            draggable={false}
          />
          {start && end && (
            <span
              className="vision-crop-selection"
              style={{
                left: `${left * 100}%`,
                top: `${top * 100}%`,
                width: `${width * 100}%`,
                height: `${height * 100}%`,
              }}
            />
          )}
        </div>
      </div>
      <div className="vision-crop-actions">
        <button type="button" onClick={onCancel}>Отмена</button>
        <button
          type="button"
          disabled={!valid}
          onClick={() => onConfirm({ x: left, y: top, width, height })}
        >
          Анализировать область
        </button>
      </div>
    </div>
  );
}
