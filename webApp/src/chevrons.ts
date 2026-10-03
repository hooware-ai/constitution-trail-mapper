import L from "leaflet";
import type { MapCuePiece } from "./types";
import { chevronsAlong } from "./chevronGeometry";
export { chevronsAlong, CHEVRON_SPACING_PX } from "./chevronGeometry";
export type { Chevron } from "./chevronGeometry";

/** One chevron, pointing along +x, centred on the origin: single for a first pass, double for a second pass. */
function drawOne(ctx: CanvasRenderingContext2D, doubled: boolean) {
  const offsets = doubled ? [-5, 4] : [0];
  for (const [color, width] of [
    ["rgba(0,0,0,0.8)", 5.5],
    ["#ffffff", 2.6],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const x of offsets) {
      ctx.beginPath();
      ctx.moveTo(x - 4, -6);
      ctx.lineTo(x + 3, 0);
      ctx.lineTo(x - 4, 6);
      ctx.stroke();
    }
  }
}

/**
 * Direction chevrons over the route, drawn on one canvas that follows the map. They carry no information that is not also
 * in the text (turn instructions and the legend sentence), so the canvas is hidden from assistive technology.
 */
export class ChevronLayer extends L.Layer {
  private canvas: HTMLCanvasElement | null = null;
  private pieces: MapCuePiece[] = [];
  private frame = 0;

  setPieces(pieces: MapCuePiece[]): void {
    this.pieces = pieces.filter(
      (piece) => piece.isRouted && piece.points.length >= 2,
    );
    this.schedule();
  }

  onAdd(map: L.Map): this {
    const canvas = L.DomUtil.create(
      "canvas",
      "chevron-layer",
    ) as HTMLCanvasElement;
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.position = "absolute";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "450";
    map.getPanes().overlayPane.appendChild(canvas);
    this.canvas = canvas;
    map.on("moveend zoomend viewreset resize", this.schedule, this);
    this.schedule();
    return this;
  }

  onRemove(map: L.Map): this {
    map.off("moveend zoomend viewreset resize", this.schedule, this);
    cancelAnimationFrame(this.frame);
    this.canvas?.remove();
    this.canvas = null;
    return this;
  }

  private schedule = () => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  };

  private draw() {
    const map = this._map as L.Map | undefined;
    const canvas = this.canvas;
    if (!map || !canvas) return;
    const size = map.getSize();
    const ratio = window.devicePixelRatio || 1;
    // Keep the canvas on the visible map: it is positioned at the map's top-left in the overlay pane.
    const origin = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(canvas, origin);
    canvas.width = Math.round(size.x * ratio);
    canvas.height = Math.round(size.y * ratio);
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    for (const piece of this.pieces) {
      const projected = piece.points.map((point) => {
        const p = map.latLngToContainerPoint([point.latitude, point.longitude]);
        return { x: p.x, y: p.y };
      });
      for (const chevron of chevronsAlong(projected)) {
        if (
          chevron.x < -12 ||
          chevron.y < -12 ||
          chevron.x > size.x + 12 ||
          chevron.y > size.y + 12
        )
          continue;
        ctx.save();
        ctx.translate(chevron.x, chevron.y);
        ctx.rotate(chevron.angle);
        drawOne(ctx, piece.repeatsEarlierTravel);
        ctx.restore();
      }
    }
  }
}
